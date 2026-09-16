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
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export function TopBar(p: Props) {
  const dirty = useOrgStore(s => s.dirty);
  const undo = useOrgStore(s => s.undo);
  const redo = useOrgStore(s => s.redo);
  const canUndo = useOrgStore(s => s.past.length > 0);
  const canRedo = useOrgStore(s => s.future.length > 0);
  const doc = useOrgStore(s => s.doc);

  return (
    <div className="top-bar">
      <div className="brand">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="15" fill={doc.meta.theme.primary} />
          <path d="M10 22 V10 H16 A4 4 0 0 1 16 18 H10 M16 18 L22 22"
                stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        CompanyTree
      </div>
      <div className="meta-title">
        {dirty && <span className="dirty-dot" title="Kaydedilmemiş değişiklik" />}
        {doc.meta.title}
      </div>
      <div className="spacer" />
      <button className="ghost" onClick={undo} disabled={!canUndo} title="Geri al (Ctrl+Z)">↶</button>
      <button className="ghost" onClick={redo} disabled={!canRedo} title="Yinele (Ctrl+Shift+Z)">↷</button>
      <button onClick={p.onAddRootChild} title="Köke alt birim ekle">+ Kök Alt</button>
      <button onClick={p.onAddFloating} title="Serbest (bağlı olmayan) kutu ekle — sonradan sürükleyip başka kutuya bağlarsın">
        + Serbest Kutu
      </button>
      <button onClick={p.onSave} title="Kaydet (Ctrl+S)">
        💾 {p.saveState === 'saving' ? 'Kaydediliyor…' : p.saveState === 'saved' ? 'Kaydedildi' : 'Kaydet'}
      </button>
      <button onClick={p.onExportPdf}>⤓ PDF</button>
      <button onClick={p.onExportXlsx}>⤓ XLSX</button>
      <button onClick={p.onExportBackup}>⤓ Yedek</button>
      <button onClick={p.onImportBackup}>⤒ Yedekten Dön</button>
      {p.vaultUnlocked && (
        <button className="danger" onClick={p.onLock}>🔒 Kilitle</button>
      )}
    </div>
  );
}
