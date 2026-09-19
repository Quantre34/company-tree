import { useEffect, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';

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
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export function TopBar(p: Props) {
  const dirty = useOrgStore(s => s.dirty);
  const undo = useOrgStore(s => s.undo);
  const redo = useOrgStore(s => s.redo);
  const canUndo = useOrgStore(s => s.past.length > 0);
  const canRedo = useOrgStore(s => s.future.length > 0);
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
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const saveLabel = p.saveState === 'saving' ? 'Kaydediliyor…'
    : p.saveState === 'saved' ? 'Kaydedildi'
    : 'Kaydet';

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
          {dirty && <span className="dirty-dot" title="Kaydedilmemiş değişiklik" />}
          {doc.meta.title}
        </div>
      )}
      <div className="spacer" />

      <button className="ghost tb-btn" onClick={undo} disabled={!canUndo} title="Geri al (Ctrl+Z)" aria-label="Geri al">↶</button>
      <button className="ghost tb-btn" onClick={redo} disabled={!canRedo} title="Yinele (Ctrl+Shift+Z)" aria-label="Yinele">↷</button>
      <button onClick={p.onAddRootChild} title="Köke alt birim ekle">
        <span className="hide-narrow">+ Kök Alt</span><span className="show-narrow" aria-hidden>＋</span>
      </button>
      <button onClick={p.onAddFloating} title="Serbest (bağlı olmayan) kutu ekle — sonradan sürükleyip başka kutuya bağlarsın">
        <span className="hide-narrow">+ Serbest Kutu</span><span className="show-narrow" aria-hidden>◇</span>
      </button>
      <button onClick={p.onSave} title="Kaydet (Ctrl+S)">
        💾 <span className="hide-narrow">{saveLabel}</span>
      </button>

      {!narrow ? (
        <>
          <button onClick={p.onExportPdf}>⤓ PDF</button>
          <button onClick={p.onExportXlsx}>⤓ XLSX</button>
          <button onClick={p.onExportBackup}>⤓ Yedek</button>
          <button onClick={p.onImportBackup}>⤒ Yedekten Dön</button>
        </>
      ) : (
        <div className="tb-menu-wrap" ref={menuRef}>
          <button className="tb-btn" onClick={() => setMenuOpen(v => !v)} aria-label="Menü" aria-expanded={menuOpen}>⋯</button>
          {menuOpen && (
            <div className="tb-menu" role="menu">
              <button onClick={() => { setMenuOpen(false); p.onExportPdf(); }}>⤓ PDF</button>
              <button onClick={() => { setMenuOpen(false); p.onExportXlsx(); }}>⤓ Excel</button>
              <button onClick={() => { setMenuOpen(false); p.onExportBackup(); }}>⤓ Yedek Al</button>
              <button onClick={() => { setMenuOpen(false); p.onImportBackup(); }}>⤒ Yedekten Dön</button>
            </div>
          )}
        </div>
      )}

      {p.onToggleInspector && narrow && (
        <button className="tb-btn" onClick={p.onToggleInspector} title="Ayarlar / seçili kutu" aria-label="Panel">
          ☰
        </button>
      )}

      {p.vaultUnlocked && (
        <button className="danger tb-btn" onClick={p.onLock} title="Kilitle" aria-label="Kilitle">🔒</button>
      )}
    </div>
  );
}
