import { create } from 'zustand';
import { produce } from 'immer';
import { nanoid } from 'nanoid';
import type { OrgDoc, OrgNode, NodeType, Person, NodeStyle, VaultDoc, Workspace } from '../types/org';
import { wrapAsWorkspace, createBlankWorkspace } from '../persistence/vaultMigration';
import { translate as t } from '../i18n/langStore';
import seedDefault from '../data/seed.json';

// If a `seed.local.json` sits next to `seed.json`, use it. That file is
// gitignored so an operator can drop in their own backfilled data (company
// name, logo, employees) for a specific deployment without touching the
// public codebase. Public checkouts fall back to the empty template.
const seedLocalModules = import.meta.glob(
  '../data/seed.local.json',
  { eager: true, import: 'default' },
) as Record<string, unknown>;
const seedLocal = Object.values(seedLocalModules)[0] as OrgDoc | undefined;

const SEED = (seedLocal ?? (seedDefault as unknown as OrgDoc));
const HISTORY_LIMIT = 50;

function cloneDoc<T>(d: T): T {
  return JSON.parse(JSON.stringify(d));
}

interface HistoryBucket { past: OrgDoc[]; future: OrgDoc[]; }

interface OrgState {
  /** The ACTIVE workspace's doc. Every mutator below reads/writes this,
   * exactly as when the store only ever held one doc — switching workspaces
   * swaps this field's contents with `inactiveDocs`, see `switchWorkspace`. */
  doc: OrgDoc;
  /** Tab order + names. Doc content for the active one lives in `doc`; for
   * every other workspace it lives in `inactiveDocs[id]`. */
  workspaces: { id: string; name: string }[];
  activeWorkspaceId: string;
  inactiveDocs: Record<string, OrgDoc>;
  /** Undo/redo history, scoped per workspace so switching tabs never mixes
   * one region's edit history with another's. */
  historyByWorkspace: Record<string, HistoryBucket>;

  selectedId: string | null;
  dirty: boolean;
  /** True while the user is actively dragging a node — polling should pause. */
  isDragging: boolean;
  setDragging: (v: boolean) => void;

  select: (id: string | null) => void;
  /** Replace the whole vault (all workspaces) — used on unlock/import. */
  loadDoc: (vault: VaultDoc) => void;
  /**
   * Apply a vault pulled from the server sync loop. Unlike `loadDoc`, this
   * pushes the previous active doc onto that workspace's undo stack so the
   * user can Ctrl-Z back after an unexpected remote update; selection is
   * cleared if the selected node no longer exists in the incoming doc.
   */
  applyRemote: (vault: VaultDoc) => void;
  markSaved: () => void;
  /** Assemble the current in-memory state back into a `VaultDoc` for saving. */
  exportVault: () => VaultDoc;

  addWorkspace: (name: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  /** No-op if `id` is the only remaining workspace. */
  removeWorkspace: (id: string) => void;
  switchWorkspace: (id: string) => void;

  updateNode: (id: string, patch: Partial<OrgNode>, snapshot?: boolean) => void;
  updateStyle: (id: string, patch: Partial<NodeStyle>, snapshot?: boolean) => void;

  addChild: (parentId: string, type?: NodeType) => string;
  addSibling: (nodeId: string, type?: NodeType) => string | null;
  addFloating: (at: { x: number; y: number }, type?: NodeType) => string;
  /** Mid-drag ephemeral position update — no history snapshot, no dirty flag. */
  setUnattachedPosition: (id: string, x: number, y: number) => void;
  /** Snapshot + mark dirty for the current floating position (drag ended without a target). */
  commitFloatingPosition: (id: string) => void;
  attachFloatingAsChild: (id: string, parentId: string) => void;
  /** Detach a tree node into floating state at (x,y). No-op for root. */
  detachToFloating: (id: string, at: { x: number; y: number }) => void;
  deleteNode: (id: string, promoteChildren: boolean) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  reparent: (id: string, newParentId: string) => void;
  toggleCollapse: (id: string) => void;

  addPerson: (nodeId: string, name?: string) => void;
  removePerson: (nodeId: string, personId: string) => void;
  updatePerson: (nodeId: string, personId: string, patch: Partial<Person>) => void;
  movePerson: (nodeId: string, personId: string, dir: -1 | 1) => void;

  updateTheme: (patch: Partial<OrgDoc['meta']['theme']>, snapshot?: boolean) => void;
  updateMeta: (patch: Partial<OrgDoc['meta']>, snapshot?: boolean) => void;

  undo: () => void;
  redo: () => void;
}

function canReparent(doc: OrgDoc, id: string, newParent: string | null): boolean {
  if (newParent === null) return false;
  if (id === newParent) return false;
  const parents = new Map(doc.nodes.map(n => [n.id, n.parentId]));
  let cur: string | null = newParent;
  while (cur) {
    if (cur === id) return false;
    cur = parents.get(cur) ?? null;
  }
  return true;
}

function vaultFromWorkspaces(list: Workspace[]): VaultDoc {
  return { schemaVersion: 2, workspaces: cloneDoc(list) };
}

const initialWorkspace = wrapAsWorkspace(t('workspace.defaultName'), SEED);

export const useOrgStore = create<OrgState>((set, get) => {
  function mutate(recipe: (draft: OrgState) => void, snapshot: boolean) {
    const state = get();
    const bucket = state.historyByWorkspace[state.activeWorkspaceId] ?? { past: [], future: [] };
    const past = snapshot ? [...bucket.past, cloneDoc(state.doc)].slice(-HISTORY_LIMIT) : bucket.past;
    const future = snapshot ? [] : bucket.future;
    set(produce(state, draft => {
      recipe(draft);
      draft.doc.meta.updatedAt = new Date().toISOString();
      draft.historyByWorkspace[draft.activeWorkspaceId] = { past, future };
      draft.dirty = true;
    }));
  }

  return {
    doc: cloneDoc(initialWorkspace.doc),
    workspaces: [{ id: initialWorkspace.id, name: initialWorkspace.name }],
    activeWorkspaceId: initialWorkspace.id,
    inactiveDocs: {},
    historyByWorkspace: { [initialWorkspace.id]: { past: [], future: [] } },

    selectedId: null,
    dirty: false,
    isDragging: false,

    setDragging: (v) => set({ isDragging: v }),

    select: (id) => set({ selectedId: id }),

    loadDoc: (vault) => {
      const workspaces = vault.workspaces.map(w => ({ id: w.id, name: w.name }));
      const activeWorkspaceId = workspaces[0].id;
      const inactiveDocs: Record<string, OrgDoc> = {};
      for (const w of vault.workspaces.slice(1)) inactiveDocs[w.id] = cloneDoc(w.doc);
      const historyByWorkspace: Record<string, HistoryBucket> = {};
      for (const w of workspaces) historyByWorkspace[w.id] = { past: [], future: [] };
      set({
        doc: cloneDoc(vault.workspaces[0].doc),
        workspaces, activeWorkspaceId, inactiveDocs, historyByWorkspace,
        selectedId: null, dirty: false,
      });
    },

    applyRemote: (vault) => {
      const state = get();
      const keepActive = vault.workspaces.some(w => w.id === state.activeWorkspaceId);
      const activeWorkspaceId = keepActive ? state.activeWorkspaceId : vault.workspaces[0].id;
      const activeIncoming = vault.workspaces.find(w => w.id === activeWorkspaceId)!;

      const bucket = state.historyByWorkspace[activeWorkspaceId] ?? { past: [], future: [] };
      const past = [...bucket.past, cloneDoc(state.doc)].slice(-HISTORY_LIMIT);

      const workspaces = vault.workspaces.map(w => ({ id: w.id, name: w.name }));
      const inactiveDocs: Record<string, OrgDoc> = {};
      for (const w of vault.workspaces) {
        if (w.id !== activeWorkspaceId) inactiveDocs[w.id] = cloneDoc(w.doc);
      }
      // Other workspaces' history buckets don't survive a remote apply — their
      // content just changed under them from another device, so their old
      // undo stacks no longer line up with what's on screen if the user
      // switches to them. Only the active tab's history carries forward.
      const historyByWorkspace: Record<string, HistoryBucket> = { [activeWorkspaceId]: { past, future: [] } };
      for (const w of workspaces) if (!historyByWorkspace[w.id]) historyByWorkspace[w.id] = { past: [], future: [] };

      const stillSelectable = state.selectedId && activeIncoming.doc.nodes.some(n => n.id === state.selectedId);
      set({
        doc: cloneDoc(activeIncoming.doc),
        workspaces, activeWorkspaceId, inactiveDocs, historyByWorkspace,
        selectedId: stillSelectable ? state.selectedId : null,
        dirty: false,
        // If a remote apply raced with a drag, clear isDragging — the dragged
        // node's local unattached position no longer exists in the incoming doc.
        isDragging: false,
      });
    },

    markSaved: () => set({ dirty: false }),

    exportVault: () => {
      const state = get();
      const workspaces: Workspace[] = state.workspaces.map(w => ({
        id: w.id,
        name: w.name,
        doc: w.id === state.activeWorkspaceId ? state.doc : state.inactiveDocs[w.id],
      }));
      return vaultFromWorkspaces(workspaces);
    },

    addWorkspace: (name) => {
      const state = get();
      const ws = createBlankWorkspace(name, state.doc);
      set(produce(state, draft => {
        // Stash the currently active doc before switching to the new tab.
        draft.inactiveDocs[draft.activeWorkspaceId] = cloneDoc(draft.doc);
        draft.workspaces.push({ id: ws.id, name: ws.name });
        draft.doc = cloneDoc(ws.doc);
        draft.activeWorkspaceId = ws.id;
        draft.historyByWorkspace[ws.id] = { past: [], future: [] };
        draft.selectedId = null;
        draft.dirty = true;
      }));
      return ws.id;
    },

    renameWorkspace: (id, name) => set(produce(get(), draft => {
      const w = draft.workspaces.find(x => x.id === id);
      if (!w) return;
      w.name = name;
      draft.dirty = true;
    })),

    removeWorkspace: (id) => {
      const state = get();
      if (state.workspaces.length <= 1) return;
      set(produce(state, draft => {
        const idx = draft.workspaces.findIndex(w => w.id === id);
        if (idx === -1) return;
        if (id === draft.activeWorkspaceId) {
          const fallback = draft.workspaces[idx === 0 ? 1 : idx - 1];
          draft.doc = cloneDoc(draft.inactiveDocs[fallback.id]);
          draft.activeWorkspaceId = fallback.id;
          delete draft.inactiveDocs[fallback.id];
          draft.selectedId = null;
        } else {
          delete draft.inactiveDocs[id];
        }
        draft.workspaces.splice(idx, 1);
        delete draft.historyByWorkspace[id];
        draft.dirty = true;
      }));
    },

    switchWorkspace: (id) => {
      const state = get();
      if (id === state.activeWorkspaceId) return;
      if (!state.workspaces.some(w => w.id === id)) return;
      set(produce(state, draft => {
        draft.inactiveDocs[draft.activeWorkspaceId] = cloneDoc(draft.doc);
        draft.doc = cloneDoc(draft.inactiveDocs[id]);
        delete draft.inactiveDocs[id];
        draft.activeWorkspaceId = id;
        draft.selectedId = null;
      }));
    },

    updateNode: (id, patch, snapshot = true) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === id);
      if (!n) return;
      Object.assign(n, patch);
    }, snapshot),

    updateStyle: (id, patch, snapshot = true) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === id);
      if (!n) return;
      n.style = { ...(n.style ?? {}), ...patch };
    }, snapshot),

    addChild: (parentId, type = 'department') => {
      const id = 'n_' + nanoid(6);
      mutate(s => {
        const siblings = s.doc.nodes.filter(n => n.parentId === parentId);
        const order = siblings.length ? Math.max(...siblings.map(n => n.order)) + 1 : 0;
        const newNode: OrgNode = {
          id, parentId, order, type,
          title: 'YENİ BİRİM',
          subtitle: type === 'department' ? 'YÖNETİCİ' : undefined,
          people: [],
          layoutMode: 'stacked',
        };
        s.doc.nodes.push(newNode);
        s.selectedId = id;
      }, true);
      return id;
    },

    addSibling: (nodeId, type = 'department') => {
      const state = get();
      const target = state.doc.nodes.find(n => n.id === nodeId);
      if (!target || target.parentId === null) return null;
      return get().addChild(target.parentId, type);
    },

    addFloating: (at, type = 'department') => {
      const id = 'n_' + nanoid(6);
      mutate(s => {
        const newNode: OrgNode = {
          id, parentId: null, order: 0, type,
          title: 'YENİ BİRİM',
          subtitle: type === 'department' ? 'YÖNETİCİ' : undefined,
          people: [],
          layoutMode: 'stacked',
          unattached: { x: Math.round(at.x), y: Math.round(at.y) },
        };
        s.doc.nodes.push(newNode);
        s.selectedId = id;
      }, true);
      return id;
    },

    setUnattachedPosition: (id, x, y) => {
      // Frequent (per-pointermove) updates. Bypasses `mutate()` because that
      // also flips `dirty=true`, which would re-arm the 2-second autosave
      // timer on every pointermove — PBKDF2(SHA-256, 250k) runs on the whole
      // doc, so the tab would lock for seconds the moment the user pauses.
      // We keep the update local to the doc; `commitFloatingPosition` or the
      // attach action snapshots the final state for undo + autosave.
      const state = get();
      set(produce(state, s => {
        const n = s.doc.nodes.find(nn => nn.id === id);
        if (!n || !n.unattached) return;
        n.unattached.x = Math.round(x);
        n.unattached.y = Math.round(y);
      }));
    },

    commitFloatingPosition: (id) => {
      // Snapshot the current floating position for undo + trigger autosave.
      // Body is a no-op edit; mutate(_, true) records history + sets dirty.
      const state = get();
      const n = state.doc.nodes.find(nn => nn.id === id);
      if (!n || !n.unattached) return;
      mutate(_ => { /* no content change; snapshot only */ }, true);
    },

    detachToFloating: (id, at) => {
      const state = get();
      const n = state.doc.nodes.find(x => x.id === id);
      if (!n) return;
      // Root (parentId=null, not already floating) cannot be detached.
      if (n.parentId === null && !n.unattached) return;
      if (n.unattached) return; // already floating; just move it via setUnattachedPosition
      mutate(s => {
        const nn = s.doc.nodes.find(x => x.id === id);
        if (!nn) return;
        nn.unattached = { x: Math.round(at.x), y: Math.round(at.y) };
      }, true);
    },

    attachFloatingAsChild: (id, parentId) => {
      const state = get();
      const node = state.doc.nodes.find(n => n.id === id);
      const parent = state.doc.nodes.find(n => n.id === parentId);
      if (!node || !parent || id === parentId) return;
      // Cycle guard (should not happen for a floating node, but keep it safe).
      let cur: string | null = parent.parentId;
      const seen = new Set<string>();
      while (cur) {
        if (seen.has(cur)) return;
        seen.add(cur);
        if (cur === id) return;
        const p = state.doc.nodes.find(x => x.id === cur);
        cur = p?.parentId ?? null;
      }
      mutate(s => {
        const n = s.doc.nodes.find(x => x.id === id);
        if (!n) return;
        n.parentId = parentId;
        delete n.unattached;
        const siblings = s.doc.nodes.filter(x => x.parentId === parentId && x.id !== id);
        n.order = siblings.length ? Math.max(...siblings.map(x => x.order)) + 1 : 0;
        s.selectedId = id;
      }, true);
    },

    deleteNode: (id, promoteChildren) => {
      const state = get();
      const target = state.doc.nodes.find(n => n.id === id);
      if (!target || target.parentId === null) return;
      mutate(s => {
        if (promoteChildren) {
          for (const k of s.doc.nodes) {
            if (k.parentId === id) k.parentId = target.parentId;
          }
          s.doc.nodes = s.doc.nodes.filter(n => n.id !== id);
        } else {
          const toRemove = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const n of s.doc.nodes) {
              if (!toRemove.has(n.id) && n.parentId && toRemove.has(n.parentId)) {
                toRemove.add(n.id);
                changed = true;
              }
            }
          }
          s.doc.nodes = s.doc.nodes.filter(n => !toRemove.has(n.id));
        }
        s.selectedId = null;
      }, true);
    },

    moveUp: (id) => {
      const target = get().doc.nodes.find(n => n.id === id);
      if (!target) return;
      mutate(s => {
        const sib = s.doc.nodes
          .filter(n => n.parentId === target.parentId)
          .sort((a, b) => a.order - b.order);
        const idx = sib.findIndex(n => n.id === id);
        if (idx <= 0) return;
        const a = sib[idx - 1], b = sib[idx];
        const t = a.order; a.order = b.order; b.order = t;
      }, true);
    },

    moveDown: (id) => {
      const target = get().doc.nodes.find(n => n.id === id);
      if (!target) return;
      mutate(s => {
        const sib = s.doc.nodes
          .filter(n => n.parentId === target.parentId)
          .sort((a, b) => a.order - b.order);
        const idx = sib.findIndex(n => n.id === id);
        if (idx < 0 || idx >= sib.length - 1) return;
        const a = sib[idx], b = sib[idx + 1];
        const t = a.order; a.order = b.order; b.order = t;
      }, true);
    },

    reparent: (id, newParentId) => {
      const state = get();
      if (!canReparent(state.doc, id, newParentId)) return;
      mutate(s => {
        const n = s.doc.nodes.find(x => x.id === id);
        if (!n) return;
        n.parentId = newParentId;
        const siblings = s.doc.nodes.filter(x => x.parentId === newParentId && x.id !== id);
        n.order = siblings.length ? Math.max(...siblings.map(x => x.order)) + 1 : 0;
      }, true);
    },

    toggleCollapse: (id) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === id);
      if (!n) return;
      n.collapsed = !n.collapsed;
    }, true),

    addPerson: (nodeId, name = 'YENİ KİŞİ') => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === nodeId);
      if (!n) return;
      n.people.push({ id: 'p_' + nanoid(6), name });
    }, true),

    removePerson: (nodeId, personId) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === nodeId);
      if (!n) return;
      n.people = n.people.filter(p => p.id !== personId);
    }, true),

    updatePerson: (nodeId, personId, patch) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === nodeId);
      const p = n?.people.find(x => x.id === personId);
      if (!p) return;
      Object.assign(p, patch);
    }, true),

    movePerson: (nodeId, personId, dir) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === nodeId);
      if (!n) return;
      const idx = n.people.findIndex(p => p.id === personId);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= n.people.length) return;
      const t = n.people[idx]; n.people[idx] = n.people[j]; n.people[j] = t;
    }, true),

    updateTheme: (patch, snapshot = true) => mutate(s => {
      s.doc.meta.theme = { ...s.doc.meta.theme, ...patch };
    }, snapshot),

    updateMeta: (patch, snapshot = true) => mutate(s => {
      s.doc.meta = { ...s.doc.meta, ...patch };
    }, snapshot),

    undo: () => {
      const s = get();
      const bucket = s.historyByWorkspace[s.activeWorkspaceId];
      if (!bucket || !bucket.past.length) return;
      const prev = bucket.past[bucket.past.length - 1];
      set({
        doc: prev,
        historyByWorkspace: {
          ...s.historyByWorkspace,
          [s.activeWorkspaceId]: {
            past: bucket.past.slice(0, -1),
            future: [cloneDoc(s.doc), ...bucket.future].slice(0, HISTORY_LIMIT),
          },
        },
        dirty: true,
      });
    },

    redo: () => {
      const s = get();
      const bucket = s.historyByWorkspace[s.activeWorkspaceId];
      if (!bucket || !bucket.future.length) return;
      const nxt = bucket.future[0];
      set({
        doc: nxt,
        historyByWorkspace: {
          ...s.historyByWorkspace,
          [s.activeWorkspaceId]: {
            past: [...bucket.past, cloneDoc(s.doc)].slice(-HISTORY_LIMIT),
            future: bucket.future.slice(1),
          },
        },
        dirty: true,
      });
    },
  };
});
