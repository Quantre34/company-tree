import { useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import { useT } from '../i18n/langStore';

/**
 * Spreadsheet-style tab strip — one tab per workspace (e.g. Türkiye, Avrupa,
 * ABD), all sharing the same company vault/password. Switching tabs swaps
 * which `OrgDoc` the rest of the app (`Canvas`, `Inspector`, exports, …)
 * reads via `useOrgStore(s => s.doc)` — see `orgStore.ts`'s `switchWorkspace`.
 */
export function WorkspaceTabs({ onDeleteRequest }: { onDeleteRequest: (id: string) => void }) {
  const t = useT();
  const workspaces = useOrgStore(s => s.workspaces);
  const activeId = useOrgStore(s => s.activeWorkspaceId);
  const switchWorkspace = useOrgStore(s => s.switchWorkspace);
  const renameWorkspace = useOrgStore(s => s.renameWorkspace);
  const addWorkspace = useOrgStore(s => s.addWorkspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingValue(currentName);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitRename = () => {
    if (editingId && editingValue.trim()) renameWorkspace(editingId, editingValue.trim());
    setEditingId(null);
  };

  const onAdd = () => {
    const name = prompt(t('workspace.addPrompt'));
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed) addWorkspace(trimmed);
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label={t('workspace.ariaLabel')}>
      {workspaces.map(w => (
        <div
          key={w.id}
          role="tab"
          aria-selected={w.id === activeId}
          className={'workspace-tab' + (w.id === activeId ? ' active' : '')}
          onClick={() => switchWorkspace(w.id)}
          onDoubleClick={() => startRename(w.id, w.name)}
        >
          {editingId === w.id ? (
            <input
              ref={inputRef}
              className="workspace-tab-input"
              value={editingValue}
              autoFocus
              onClick={e => e.stopPropagation()}
              onChange={e => setEditingValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditingId(null);
              }}
            />
          ) : (
            <span className="workspace-tab-label" title={t('workspace.renameHint')}>{w.name}</span>
          )}
          {workspaces.length > 1 && (
            <button
              className="workspace-tab-close"
              title={t('workspace.deleteTitle')}
              aria-label={t('workspace.deleteTitle')}
              onClick={e => { e.stopPropagation(); onDeleteRequest(w.id); }}
            >×</button>
          )}
        </div>
      ))}
      <button className="workspace-tab-add" title={t('workspace.addTitle')} aria-label={t('workspace.addTitle')} onClick={onAdd}>+</button>
    </div>
  );
}
