import { useEffect, useMemo, useState } from 'react';
import { useOrgStore } from '../store/orgStore';

export function ConfirmDialog({
  title, message, danger, onConfirm, onCancel,
  extraChoice,
}: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: (choice?: string) => void;
  onCancel: () => void;
  extraChoice?: { label: string; value: string };
}) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{message}</p>
        <div className="actions">
          <button onClick={onCancel}>Vazgeç</button>
          {extraChoice && (
            <button onClick={() => onConfirm(extraChoice.value)}>{extraChoice.label}</button>
          )}
          <button className={danger ? 'danger' : 'primary'} onClick={() => onConfirm()}>Tamam</button>
        </div>
      </div>
    </div>
  );
}

export function ReparentDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const doc = useOrgStore(s => s.doc);
  const reparent = useOrgStore(s => s.reparent);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const forbidden = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of doc.nodes) {
        if (!forbidden.has(n.id) && n.parentId && forbidden.has(n.parentId)) {
          forbidden.add(n.id);
          changed = true;
        }
      }
    }
    const list = doc.nodes
      .filter(n => !forbidden.has(n.id))
      .filter(n => !query || (n.title.toLowerCase().includes(query.toLowerCase()) || (n.subtitle ?? '').toLowerCase().includes(query.toLowerCase())));
    return list;
  }, [doc, nodeId, query]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ minWidth: 420 }} onClick={e => e.stopPropagation()}>
        <h2>Üst Birimi Seç</h2>
        <input placeholder="Ara..." value={query} onChange={e => setQuery(e.target.value)} autoFocus />
        <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
          {options.map(o => (
            <button
              key={o.id}
              style={{ width: '100%', justifyContent: 'flex-start', border: 'none', borderRadius: 0, padding: '8px 10px' }}
              onClick={() => { reparent(nodeId, o.id); onClose(); }}
            >
              <strong>{o.title}</strong>
              {o.subtitle && <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>{o.subtitle}</span>}
            </button>
          ))}
          {options.length === 0 && <div style={{ padding: 12, color: 'var(--muted)' }}>Sonuç yok.</div>}
        </div>
        <div className="actions">
          <button onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>
  );
}

export function DeleteDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const doc = useOrgStore(s => s.doc);
  const deleteNode = useOrgStore(s => s.deleteNode);
  const [promote, setPromote] = useState(false);
  const target = doc.nodes.find(n => n.id === nodeId);
  if (!target) return null;

  const descendantCount = countDescendants(doc.nodes, nodeId);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>Birimi Sil</h2>
        <p>"{target.title}" silinecek.</p>
        {descendantCount > 0 && (
          <>
            <p>Bu birimin altında <b>{descendantCount}</b> alt birim var.</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, textTransform: 'none', color: 'var(--node-text)' }}>
              <input type="checkbox" checked={promote} onChange={e => setPromote(e.target.checked)} style={{ width: 'auto' }} />
              Alt birimleri bir üste bağla (yoksa hepsi silinir)
            </label>
          </>
        )}
        <div className="actions">
          <button onClick={onClose}>Vazgeç</button>
          <button className="danger" onClick={() => { deleteNode(nodeId, promote); onClose(); }}>Sil</button>
        </div>
      </div>
    </div>
  );
}

function countDescendants(nodes: { id: string; parentId: string | null }[], id: string): number {
  const kids = nodes.filter(n => n.parentId === id).map(n => n.id);
  let count = kids.length;
  for (const k of kids) count += countDescendants(nodes, k);
  return count;
}
