import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  saveServerVault,
} from './persistence/serverVault';
import { hasWebCrypto, isSecureContextOk } from './crypto/vault';
import { exportEncryptedFile, importEncryptedFile, downloadAs } from './persistence/fileVault';
import { exportXlsx } from './export/xlsx';
import { PdfPreview } from './components/PdfPreview';
import type { OrgDoc } from './types/org';

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

export default function App() {
  const doc = useOrgStore(s => s.doc);
  const dirty = useOrgStore(s => s.dirty);
  const loadDoc = useOrgStore(s => s.loadDoc);
  const markSaved = useOrgStore(s => s.markSaved);
  const undo = useOrgStore(s => s.undo);
  const redo = useOrgStore(s => s.redo);
  const addChild = useOrgStore(s => s.addChild);

  const [vaultMode, setVaultMode] = useState<VaultMode>('checking');
  const [fatalMsg, setFatalMsg] = useState<string | null>(null);
  const passwordRef = useRef<string | null>(null);
  const versionRef = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dialog, setDialog] = useState<
    | { type: 'delete'; id: string }
    | { type: 'reparent'; id: string }
    | { type: 'importPassword'; file: File }
    | { type: 'error'; message: string }
    | { type: 'pdfPreview' }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Vault-check on mount — the ONLY place we probe the server.
  useEffect(() => {
    (async () => {
      if (!hasWebCrypto() || !isSecureContextOk()) {
        setFatalMsg('Bu uygulama HTTPS gerektirir (parola şifreleme için).');
        setVaultMode('fatal');
        return;
      }
      try {
        const exists = await hasServerVault();
        setVaultMode(exists ? 'unlock' : 'create');
      } catch (e: any) {
        setFatalMsg('Sunucuya erişilemedi: ' + (e?.message ?? String(e)));
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
    if (vaultMode !== 'unlocked' || !passwordRef.current) return;
    setSaveState('saving');
    try {
      const newVer = await saveServerVault(
        useOrgStore.getState().doc,
        passwordRef.current,
        versionRef.current,
      );
      versionRef.current = newVer;
      markSaved();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1200);
    } catch (e: any) {
      setSaveState('error');
      if (e?.code === 'CONFLICT') {
        // Another device saved after us — reload authoritative blob so we
        // don't overwrite it.
        try {
          const fresh = await loadServerVault(passwordRef.current!);
          versionRef.current = fresh.version;
          loadDoc(fresh.doc);
          setDialog({
            type: 'error',
            message: 'Başka bir cihazdan daha yeni bir kayıt gelmişti — ' +
              'sunucudaki son sürümü yükledik. Değişikliklerini tekrar uygulaman gerekebilir.',
          });
        } catch (e2: any) {
          setDialog({ type: 'error', message: 'Çakışma çözümlenemedi: ' + (e2?.message ?? String(e2)) });
        }
      } else {
        setDialog({ type: 'error', message: 'Kayıt hatası: ' + (e?.message ?? String(e)) });
      }
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

    const newVer = await saveServerVault(
      useOrgStore.getState().doc,
      data.password,
      null,   // no version yet — first PUT
    );
    passwordRef.current = data.password;
    versionRef.current = newVer;
    setVaultMode('unlocked');
    markSaved();
  };

  const onUnlockVault = async (data: OnboardingData) => {
    const { doc: d, version } = await loadServerVault(data.password);
    passwordRef.current = data.password;
    versionRef.current = version;
    loadDoc(d);
    setVaultMode('unlocked');
  };

  const lock = () => {
    passwordRef.current = null;
    versionRef.current = null;
    setVaultMode('unlock');
  };

  const onExportBackup = async () => {
    let pw = passwordRef.current;
    if (!pw) {
      const val = prompt('Yedek dosyası için parola girin (boş bırakırsanız düz JSON dışa aktarılır):');
      if (val === null) return;
      pw = val;
    }
    if (pw) {
      const blob = await exportEncryptedFile(useOrgStore.getState().doc, pw);
      downloadAs(blob, `company-tree-${new Date().toISOString().slice(0, 10)}.rigitree`);
    } else {
      const json = JSON.stringify(useOrgStore.getState().doc, null, 2);
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
          const d = JSON.parse(text) as OrgDoc;
          loadDoc(d);
        } catch (e: any) {
          setDialog({ type: 'error', message: 'JSON okunamadı: ' + (e?.message ?? String(e)) });
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
      setDialog({ type: 'error', message: e?.message ?? 'Yedek açılamadı.' });
    }
  };

  const onExportPdfClick = () => setDialog({ type: 'pdfPreview' });

  const onExportXlsxClick = async () => {
    try { await exportXlsx(useOrgStore.getState().doc); }
    catch (e: any) { setDialog({ type: 'error', message: 'Excel hatası: ' + (e?.message ?? String(e)) }); }
  };

  const rootId = useMemo(() => doc.nodes.find(n => n.parentId === null)?.id ?? null, [doc]);

  if (vaultMode === 'checking') {
    return <div style={{ padding: 40 }}>Yükleniyor…</div>;
  }

  if (vaultMode === 'fatal') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: 32, fontFamily: 'Roboto, sans-serif' }}>
        <h2 style={{ color: '#C8102E' }}>Uygulama başlatılamadı</h2>
        <p style={{ color: '#374151', lineHeight: 1.5 }}>{fatalMsg}</p>
        <button
          onClick={() => location.reload()}
          style={{ padding: '8px 14px', background: '#1F3B73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >Sayfayı Yenile</button>
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
        saveState={saveState}
      />
      <div className="main-split">
        <Canvas
          svgRef={svgRef}
          onAddChild={(parentId) => addChild(parentId)}
        />
        <Inspector
          onDeleteRequest={(id) => setDialog({ type: 'delete', id })}
          onReparentRequest={(id) => setDialog({ type: 'reparent', id })}
        />
      </div>

      {dialog?.type === 'delete' && (
        <DeleteDialog nodeId={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'reparent' && (
        <ReparentDialog nodeId={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'pdfPreview' && (
        <PdfPreview doc={doc} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'importPassword' && (
        <ImportPasswordDialog file={dialog.file} onCancel={() => setDialog(null)} onSubmit={onImportPasswordSubmit} />
      )}
      {dialog?.type === 'error' && (
        <ConfirmDialog
          title="Hata"
          message={dialog.message}
          onCancel={() => setDialog(null)}
          onConfirm={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ImportPasswordDialog({ file, onCancel, onSubmit }: { file: File; onCancel: () => void; onSubmit: (f: File, pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>Yedek Parolası</h2>
        <p>{file.name}</p>
        <input type="password" placeholder="Parola" autoFocus value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSubmit(file, pw); }} />
        <div className="actions">
          <button onClick={onCancel}>Vazgeç</button>
          <button className="primary" onClick={() => onSubmit(file, pw)}>Aç</button>
        </div>
      </div>
    </div>
  );
}
