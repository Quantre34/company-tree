import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles/theme.css';
import { useOrgStore } from './store/orgStore';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { LockScreen, type OnboardingData } from './components/LockScreen';
import { ConfirmDialog, DeleteDialog, ReparentDialog } from './components/Dialogs';
import {
  hasServerVault,
  loadServerVault,
  createServerVault,
  saveServerVault,
  changeServerPassword,
  fetchServerBlob,
} from './persistence/serverVault';
import { decryptBlob, type VaultSession } from './crypto/vault';
import { hasWebCrypto, isSecureContextOk } from './crypto/vault';
import { exportEncryptedFile, importEncryptedFile, downloadAs } from './persistence/fileVault';
import { normalizeVault } from './persistence/vaultMigration';
import { useT } from './i18n/langStore';
import { AdminPasswordPanel } from './components/AdminPasswordPanel';
import { WorkspaceTabs } from './components/WorkspaceTabs';
// Lazy-loaded: exceljs (~450 KB) + jspdf/svg2pdf (~500 KB gzip). Deferring
// these off the initial-load path cuts first-paint bundle by ~60%.
const PdfPreview = lazy(() =>
  import('./components/PdfPreview').then(m => ({ default: m.PdfPreview })));
import type { VaultDoc } from './types/org';

/**
 * Vault lives on the server (encrypted, zero-knowledge). Cookies /
 * localStorage on the device don't hold the tree — clearing them just
 * signs you out. The company is created ONCE (whoever first hits the
 * domain), then every device just enters the password to unlock.
 */
type VaultMode =
  | 'checking'     // probing the server
  | 'create'       // no vault on server yet — first-time setup
  | 'unlock'       // vault exists — enter password
  | 'unlocked'     // in the app
  | 'fatal';       // hard error (no HTTPS, no crypto, server unreachable)

const AUTO_LOCK_MS = 15 * 60 * 1000;
const AUTOSAVE_MS = 2000;
const SYNC_POLL_MS = 20 * 1000;

export default function App() {
  const t = useT();
  const doc = useOrgStore(s => s.doc);
  const dirty = useOrgStore(s => s.dirty);
  const loadDoc = useOrgStore(s => s.loadDoc);
  const applyRemote = useOrgStore(s => s.applyRemote);
  const markSaved = useOrgStore(s => s.markSaved);
  const undo = useOrgStore(s => s.undo);
  const redo = useOrgStore(s => s.redo);
  const addChild = useOrgStore(s => s.addChild);
  const addFloating = useOrgStore(s => s.addFloating);

  const [vaultMode, setVaultMode] = useState<VaultMode>('checking');
  const [fatalMsg, setFatalMsg] = useState<string | null>(null);
  const passwordRef = useRef<string | null>(null);
  // Derived once at unlock/create (one PBKDF2 pass) and reused for every
  // save in the session — see crypto/vault.ts's VaultSession. Ordinary
  // autosaves never touch PBKDF2 again after this is set.
  const sessionRef = useRef<VaultSession | null>(null);
  const versionRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [remoteUpdate, setRemoteUpdate] = useState<{ doc: VaultDoc; version: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<
    | { type: 'delete'; id: string }
    | { type: 'deleteWorkspace'; id: string }
    | { type: 'reparent'; id: string }
    | { type: 'importPassword'; file: File }
    | { type: 'error'; message: string }
    | { type: 'info'; message: string }
    | { type: 'pdfPreview' }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Vault-check on mount — the ONLY place we probe the server.
  useEffect(() => {
    (async () => {
      if (!hasWebCrypto() || !isSecureContextOk()) {
        setFatalMsg(t('fatal.httpsRequired'));
        setVaultMode('fatal');
        return;
      }
      try {
        const exists = await hasServerVault();
        setVaultMode(exists ? 'unlock' : 'create');
      } catch (e: any) {
        setFatalMsg(t('fatal.serverUnreachable', { msg: e?.message ?? String(e) }));
        setVaultMode('fatal');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave when dirty
  useEffect(() => {
    if (!dirty || vaultMode !== 'unlocked') return;
    const t = setTimeout(() => { void doSave(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, doc, vaultMode]);

  // Auto-lock on inactivity
  useEffect(() => {
    if (vaultMode !== 'unlocked') return;
    let timer: number | undefined;
    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => lock(), AUTO_LOCK_MS);
    };
    const events = ['mousemove', 'keydown', 'pointerdown'];
    events.forEach(e => window.addEventListener(e, reset));
    reset();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultMode]);

  // Cross-device sync — poll the server for a newer blob.
  // Pauses on: hidden tab, unsaved edits, in-flight save, active drag.
  // Exponential backoff on failure (20 s → 40 s → 80 s → 300 s cap).
  // On visibility restore: cancels any pending timer and ticks immediately.
  // Race-safe: after the async decrypt lands, we re-check dirty/saving so a
  // save that raced with the fetch doesn't get silently overwritten.
  useEffect(() => {
    if (vaultMode !== 'unlocked') return;
    let timer: number | undefined;
    let stopped = false;
    let inFlight = false;
    let backoffMs = SYNC_POLL_MS;

    const cancelTimer = () => {
      if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
    };
    const schedule = (ms: number) => {
      cancelTimer();
      if (stopped) return;
      timer = window.setTimeout(tick, ms);
    };

    const shouldSkip = () => document.hidden
      || savingRef.current
      || useOrgStore.getState().isDragging
      || useOrgStore.getState().dirty     // don't even HEAD while dirty — avoids the race window
      || !passwordRef.current;

    const tick = async () => {
      if (stopped || inFlight) return;
      if (shouldSkip()) { schedule(backoffMs); return; }
      inFlight = true;
      try {
        const r = await fetch('./api/tree.php', { method: 'HEAD', cache: 'no-store' });
        if (!r.ok) throw new Error('HEAD ' + r.status);
        backoffMs = SYNC_POLL_MS; // reset on success
        const ver = r.headers.get('X-Vault-Version') ?? '';
        if (ver && ver !== versionRef.current) {
          const got = await fetchServerBlob();
          if (got && passwordRef.current) {
            const parsed = await decryptBlob<unknown>(got.blob, passwordRef.current).catch(() => null);
            const vault = parsed ? normalizeVault(parsed) : null;
            if (vault) {
              // Race guard: a save may have completed while we were decrypting.
              // Never apply if the user is now dirty or a save just finished —
              // downgrade to the banner so the user chooses.
              if (useOrgStore.getState().dirty || savingRef.current) {
                setRemoteUpdate({ doc: vault, version: got.version });
              } else {
                versionRef.current = got.version;
                applyRemote(vault);
              }
            }
          }
        }
      } catch { /* network / server hiccup — back off */
        backoffMs = Math.min(backoffMs * 2, 300_000);
      } finally {
        inFlight = false;
        schedule(backoffMs);
      }
    };

    const onVis = () => {
      if (!document.hidden) {
        backoffMs = SYNC_POLL_MS;   // reset backoff on foreground
        cancelTimer();              // prevent parallel loop accumulation
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    schedule(SYNC_POLL_MS);

    return () => {
      stopped = true;
      cancelTimer();
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave(); }
      else if (!inField && e.key === 'Escape') { useOrgStore.getState().select(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSave = useCallback(async () => {
    // Capture session locally: an auto-lock during an in-flight save must
    // not turn sessionRef.current into null underneath us.
    const session = sessionRef.current;
    const pw = passwordRef.current;
    if (vaultMode !== 'unlocked' || !session || !pw) return;
    savingRef.current = true;
    setSaveState('saving');

    // Retry transient 5xx / network hiccups a couple of times so a flaky
    // wifi doesn't pop an error dialog for every autosave.
    const attempt = async (n: number): Promise<string> => {
      try {
        return await saveServerVault(
          useOrgStore.getState().exportVault(),
          session,
          versionRef.current,
        );
      } catch (e: any) {
        if (e?.code === 'CONFLICT') throw e;
        const msg = String(e?.message ?? '');
        const transient = e?.code === 'RATE_LIMITED' || /\(5\d\d\)|network|fetch|abort|timeout/i.test(msg);
        if (transient && n < 2) {
          await new Promise(r => setTimeout(r, 500 * (n + 1)));
          return attempt(n + 1);
        }
        throw e;
      }
    };

    try {
      const newVer = await attempt(0);
      versionRef.current = newVer;
      markSaved();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1200);
    } catch (e: any) {
      setSaveState('error');
      if (e?.code === 'CONFLICT') {
        try {
          const fresh = await loadServerVault(pw);
          versionRef.current = fresh.version;
          sessionRef.current = fresh.session;
          applyRemote(normalizeVault(fresh.doc));
          setDialog({
            type: 'error',
            message: t('error.conflictResolved'),
          });
        } catch (e2: any) {
          setDialog({ type: 'error', message: t('error.conflictUnresolved', { msg: e2?.message ?? String(e2) }) });
        }
      } else {
        setDialog({ type: 'error', message: t('error.savePrefix', { msg: e?.message ?? String(e) }) });
      }
    } finally {
      savingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultMode]);

  const onCreateVault = async (data: OnboardingData) => {
    // Apply onboarding data (company name + optional logo) BEFORE the first save.
    const setMeta = useOrgStore.getState().updateMeta;
    const patch: any = {};
    if (data.orgName) patch.orgName = data.orgName;
    if (data.logoDataUrl) { patch.logoUrl = data.logoDataUrl; patch.showLogo = true; }
    if (Object.keys(patch).length) setMeta(patch);

    const { version, session } = await createServerVault(useOrgStore.getState().exportVault(), data.password);
    passwordRef.current = data.password;
    sessionRef.current = session;
    versionRef.current = version;
    setVaultMode('unlocked');
    markSaved();
  };

  const onUnlockVault = async (data: OnboardingData) => {
    const { doc: d, version, session } = await loadServerVault(data.password);
    passwordRef.current = data.password;
    sessionRef.current = session;
    versionRef.current = version;
    loadDoc(normalizeVault(d));
    setVaultMode('unlocked');
  };

  // Admin-only: rotate the company password. Requires a valid 2FA-minted
  // admin token (see AdminPasswordPanel) — the server rejects the write
  // otherwise, regardless of how this function is reached.
  const onChangePassword = async (newPassword: string, adminToken: string) => {
    const { version, session } = await changeServerPassword(
      useOrgStore.getState().exportVault(),
      newPassword,
      versionRef.current ?? '',
      adminToken,
    );
    passwordRef.current = newPassword;
    sessionRef.current = session;
    versionRef.current = version;
  };

  const lock = () => {
    passwordRef.current = null;
    sessionRef.current = null;
    versionRef.current = null;
    setVaultMode('unlock');
  };

  const onExportBackup = async () => {
    let pw = passwordRef.current;
    if (!pw) {
      const val = prompt(t('prompt.backupPassword'));
      if (val === null) return;
      pw = val;
    }
    if (pw) {
      const blob = await exportEncryptedFile(useOrgStore.getState().exportVault(), pw);
      downloadAs(blob, `company-tree-${new Date().toISOString().slice(0, 10)}.rigitree`);
    } else {
      const json = JSON.stringify(useOrgStore.getState().exportVault(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      downloadAs(blob, `company-tree-${new Date().toISOString().slice(0, 10)}.json`);
    }
  };

  const onImportBackup = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.rigitree,.json,application/json,application/octet-stream';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const name = f.name.toLowerCase();
      if (name.endsWith('.json')) {
        try {
          const text = await f.text();
          loadDoc(normalizeVault(JSON.parse(text)));
        } catch (e: any) {
          setDialog({ type: 'error', message: t('error.jsonReadFailed', { msg: e?.message ?? String(e) }) });
        }
      } else {
        setDialog({ type: 'importPassword', file: f });
      }
    };
    input.click();
  };

  const onImportPasswordSubmit = async (file: File, password: string) => {
    try {
      const d = await importEncryptedFile(file, password);
      loadDoc(d);
      setDialog(null);
    } catch (e: any) {
      setDialog({ type: 'error', message: e?.message ?? t('error.backupOpenFailed') });
    }
  };

  const onExportPdfClick = () => setDialog({ type: 'pdfPreview' });

  const onExportXlsxClick = async () => {
    try {
      const { exportXlsx } = await import('./export/xlsx');
      await exportXlsx(useOrgStore.getState().doc);
    }
    catch (e: any) { setDialog({ type: 'error', message: t('error.xlsxPrefix', { msg: e?.message ?? String(e) }) }); }
  };

  const rootId = useMemo(() => doc.nodes.find(n => n.parentId === null)?.id ?? null, [doc]);

  if (vaultMode === 'checking') {
    return <div style={{ padding: 40 }}>{t('common.loading')}</div>;
  }

  if (vaultMode === 'fatal') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: 32, fontFamily: 'Roboto, sans-serif' }}>
        <h2 style={{ color: '#C8102E' }}>{t('fatal.title')}</h2>
        <p style={{ color: '#374151', lineHeight: 1.5 }}>{fatalMsg}</p>
        <button
          onClick={() => location.reload()}
          style={{ padding: '8px 14px', background: '#1F3B73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >{t('common.reloadPage')}</button>
      </div>
    );
  }

  if (vaultMode === 'create' || vaultMode === 'unlock') {
    return (
      <LockScreen
        mode={vaultMode}
        onSubmit={vaultMode === 'create' ? onCreateVault : onUnlockVault}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        vaultUnlocked={vaultMode === 'unlocked'}
        onLock={lock}
        onSave={() => void doSave()}
        onExportPdf={onExportPdfClick}
        onExportXlsx={onExportXlsxClick}
        onExportBackup={onExportBackup}
        onImportBackup={onImportBackup}
        onAddRootChild={() => rootId && addChild(rootId)}
        onAddFloating={() => addFloating({ x: 60, y: 60 })}
        onToggleInspector={() => setInspectorOpen(v => !v)}
        onOpenAdminPanel={() => setAdminPanelOpen(true)}
        saveState={saveState}
      />
      <WorkspaceTabs onDeleteRequest={(id) => setDialog({ type: 'deleteWorkspace', id })} />
      <div className={'main-split' + (inspectorOpen ? ' inspector-open' : '')}>
        <Canvas
          svgRef={svgRef}
          onAddChild={(parentId) => addChild(parentId)}
        />
        <Inspector
          onDeleteRequest={(id) => setDialog({ type: 'delete', id })}
          onReparentRequest={(id) => setDialog({ type: 'reparent', id })}
        />
      </div>

      {remoteUpdate && (
        <div className="sync-banner" role="status">
          <span>{t('syncBanner.text')}</span>
          <button className="primary" onClick={() => {
            versionRef.current = remoteUpdate.version;
            applyRemote(remoteUpdate.doc);
            setRemoteUpdate(null);
          }}>{t('syncBanner.load')}</button>
          <button className="ghost" onClick={() => setRemoteUpdate(null)}>{t('syncBanner.later')}</button>
        </div>
      )}

      {dialog?.type === 'delete' && (
        <DeleteDialog nodeId={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'deleteWorkspace' && (
        <ConfirmDialog
          title={t('workspace.deleteTitle')}
          message={t('workspace.deleteConfirm', {
            name: useOrgStore.getState().workspaces.find(w => w.id === dialog.id)?.name ?? '',
          })}
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => { useOrgStore.getState().removeWorkspace(dialog.id); setDialog(null); }}
        />
      )}
      {dialog?.type === 'reparent' && (
        <ReparentDialog nodeId={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'pdfPreview' && (
        <Suspense fallback={<div className="dialog-backdrop"><div className="dialog"><h2>{t('pdf.preparing')}</h2></div></div>}>
          <PdfPreview doc={doc} onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {dialog?.type === 'importPassword' && (
        <ImportPasswordDialog file={dialog.file} onCancel={() => setDialog(null)} onSubmit={onImportPasswordSubmit} />
      )}
      {dialog?.type === 'error' && (
        <ConfirmDialog
          title={t('common.errorTitle')}
          message={dialog.message}
          onCancel={() => setDialog(null)}
          onConfirm={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'info' && (
        <ConfirmDialog
          title={t('common.infoTitle')}
          message={dialog.message}
          onCancel={() => setDialog(null)}
          onConfirm={() => setDialog(null)}
        />
      )}
      {adminPanelOpen && (
        <AdminPasswordPanel
          onClose={() => setAdminPanelOpen(false)}
          onChangePassword={async (newPassword, adminToken) => {
            await onChangePassword(newPassword, adminToken);
            setDialog({ type: 'info', message: t('admin.changeSuccess') });
          }}
        />
      )}
    </div>
  );
}

function ImportPasswordDialog({ file, onCancel, onSubmit }: { file: File; onCancel: () => void; onSubmit: (f: File, pw: string) => void }) {
  const t = useT();
  const [pw, setPw] = useState('');
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>{t('dialog.backupPasswordTitle')}</h2>
        <p>{file.name}</p>
        <input type="password" placeholder={t('common.passwordPlaceholder')} autoFocus value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSubmit(file, pw); }} />
        <div className="actions">
          <button onClick={onCancel}>{t('common.cancel')}</button>
          <button className="primary" onClick={() => onSubmit(file, pw)}>{t('common.open')}</button>
        </div>
      </div>
    </div>
  );
}
