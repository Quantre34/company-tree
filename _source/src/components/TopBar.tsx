import { useEffect, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import { useT, useLang, useLangStore } from '../i18n/langStore';

interface Props {
  vaultUnlocked: boolean;
  onLock: () => void;
  onSave: () => void;
  onExportPdf: () => void;
  onExportXlsx: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onAddRootChild: () => void;
  onAddFloating: () => void;
  onToggleInspector?: () => void;
  onOpenAdminPanel?: () => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export function TopBar(p: Props) {
  const t = useT();
  const lang = useLang();
  const setLang = useLangStore(s => s.setLang);
  const dirty = useOrgStore(s => s.dirty);
  const undo = useOrgStore(s => s.undo);
  const redo = useOrgStore(s => s.redo);
  const canUndo = useOrgStore(s => (s.historyByWorkspace[s.activeWorkspaceId]?.past.length ?? 0) > 0);
  const canRedo = useOrgStore(s => (s.historyByWorkspace[s.activeWorkspaceId]?.future.length ?? 0) > 0);
  const doc = useOrgStore(s => s.doc);

  // Collapse-into-overflow-menu below ~820px viewport width.
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 820);
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 820);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick as any);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick as any);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const saveLabel = p.saveState === 'saving' ? t('topbar.saving')
    : p.saveState === 'saved' ? t('topbar.saved')
    : p.saveState === 'error' ? t('topbar.retry')
    : t('topbar.save');
  const saveClass = p.saveState === 'error' ? 'danger' : '';

  const langToggle = (
    <div className="lang-toggle" role="group" aria-label={t('topbar.langToggleLabel')}>
      <button
        className={lang === 'tr' ? 'active' : ''}
        onClick={() => setLang('tr')}
        aria-pressed={lang === 'tr'}
      >TR</button>
      <button
        className={lang === 'en' ? 'active' : ''}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >EN</button>
    </div>
  );

  return (
    <div className="top-bar">
      <div className="brand">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="15" fill={doc.meta.theme.primary} />
          <path d="M10 22 V10 H16 A4 4 0 0 1 16 18 H10 M16 18 L22 22"
                stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="brand-label">CompanyTree</span>
      </div>
      {!narrow && (
        <div className="meta-title">
          {dirty && <span className="dirty-dot" title={t('topbar.unsavedChange')} />}
          {doc.meta.title}
        </div>
      )}
      <div className="spacer" />

      {!narrow && langToggle}

      <button className="ghost tb-btn" onClick={undo} disabled={!canUndo} title={t('topbar.undoTitle')} aria-label={t('topbar.undoLabel')}>↶</button>
      <button className="ghost tb-btn" onClick={redo} disabled={!canRedo} title={t('topbar.redoTitle')} aria-label={t('topbar.redoLabel')}>↷</button>
      <button onClick={p.onAddRootChild} title={t('topbar.addRootChildTitle')}>
        <span className="hide-narrow">{t('topbar.addRootChildShort')}</span><span className="show-narrow" aria-hidden>＋</span>
      </button>
      <button onClick={p.onAddFloating} title={t('topbar.addFloatingTitle')}>
        <span className="hide-narrow">{t('topbar.addFloatingShort')}</span><span className="show-narrow" aria-hidden>◇</span>
      </button>
      <button
        className={saveClass}
        onClick={p.onSave}
        title={p.saveState === 'error' ? t('topbar.saveErrorTitle') : t('topbar.saveTitle')}
      >
        {p.saveState === 'error' ? '⚠' : '💾'} <span className="hide-narrow">{saveLabel}</span>
      </button>

      {!narrow ? (
        <>
          <button onClick={p.onExportPdf}>{t('topbar.exportPdf')}</button>
          <button onClick={p.onExportXlsx}>{t('topbar.exportXlsxShort')}</button>
          <button onClick={p.onExportBackup}>{t('topbar.backupShort')}</button>
          <button onClick={p.onImportBackup}>{t('topbar.restoreBackup')}</button>
        </>
      ) : (
        <div className="tb-menu-wrap" ref={menuRef}>
          <button className="tb-btn" onClick={() => setMenuOpen(v => !v)} aria-label={t('topbar.menuLabel')} aria-expanded={menuOpen}>⋯</button>
          {menuOpen && (
            <div className="tb-menu" role="menu">
              <button onClick={() => { setMenuOpen(false); p.onExportPdf(); }}>{t('topbar.exportPdf')}</button>
              <button onClick={() => { setMenuOpen(false); p.onExportXlsx(); }}>{t('topbar.exportXlsxLong')}</button>
              <button onClick={() => { setMenuOpen(false); p.onExportBackup(); }}>{t('topbar.backupLong')}</button>
              <button onClick={() => { setMenuOpen(false); p.onImportBackup(); }}>{t('topbar.restoreBackup')}</button>
              {p.onOpenAdminPanel && (
                <button className="tb-menu-admin" onClick={() => { setMenuOpen(false); p.onOpenAdminPanel!(); }}>
                  {t('admin.triggerLabel')}
                </button>
              )}
              <div className="tb-menu-lang">{langToggle}</div>
            </div>
          )}
        </div>
      )}
      {!narrow && p.onOpenAdminPanel && (
        <button
          className="ghost tb-btn tb-admin-btn"
          onClick={p.onOpenAdminPanel}
          title={t('admin.triggerLabel')}
          aria-label={t('admin.triggerLabel')}
        >🔑</button>
      )}

      {p.onToggleInspector && narrow && (
        <button className="tb-btn" onClick={p.onToggleInspector} title={t('topbar.panelTitle')} aria-label={t('topbar.panelLabel')}>
          ☰
        </button>
      )}

      {p.vaultUnlocked && (
        <button className="danger tb-btn" onClick={p.onLock} title={t('topbar.lockLabel')} aria-label={t('topbar.lockLabel')}>🔒</button>
      )}
    </div>
  );
}
