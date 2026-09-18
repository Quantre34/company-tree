import { create } from 'zustand';
import { produce } from 'immer';
import { nanoid } from 'nanoid';
import type { OrgDoc, OrgNode, NodeType, Person, NodeStyle } from '../types/org';
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

function cloneDoc(d: OrgDoc): OrgDoc {
  return JSON.parse(JSON.stringify(d));
}

interface OrgState {
  doc: OrgDoc;
  selectedId: string | null;
  dirty: boolean;
  past: OrgDoc[];
  future: OrgDoc[];

  select: (id: string | null) => void;
  loadDoc: (doc: OrgDoc) => void;
  markSaved: () => void;

  updateNode: (id: string, patch: Partial<OrgNode>, snapshot?: boolean) => void;
  updateStyle: (id: string, patch: Partial<NodeStyle>) => void;

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

  updateTheme: (patch: Partial<OrgDoc['meta']['theme']>) => void;
  updateMeta: (patch: Partial<OrgDoc['meta']>) => void;

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

export const useOrgStore = create<OrgState>((set, get) => {
  function mutate(recipe: (draft: OrgState) => void, snapshot: boolean) {
    const state = get();
    const past = snapshot ? [...state.past, cloneDoc(state.doc)].slice(-HISTORY_LIMIT) : state.past;
    const future = snapshot ? [] : state.future;
    set(produce(state, draft => {
      recipe(draft);
      draft.doc.meta.updatedAt = new Date().toISOString();
      draft.past = past;
      draft.future = future;
      draft.dirty = true;
    }));
  }

  return {
    doc: cloneDoc(SEED),
    selectedId: null,
    dirty: false,
    past: [],
    future: [],

    select: (id) => set({ selectedId: id }),

    loadDoc: (doc) => set({
      doc: cloneDoc(doc), selectedId: null, past: [], future: [], dirty: false,
    }),

    markSaved: () => set({ dirty: false }),

    updateNode: (id, patch, snapshot = true) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === id);
      if (!n) return;
      Object.assign(n, patch);
    }, snapshot),

    updateStyle: (id, patch) => mutate(s => {
      const n = s.doc.nodes.find(x => x.id === id);
      if (!n) return;
      n.style = { ...(n.style ?? {}), ...patch };
    }, true),

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

    updateTheme: (patch) => mutate(s => {
      s.doc.meta.theme = { ...s.doc.meta.theme, ...patch };
    }, true),

    updateMeta: (patch) => mutate(s => {
      s.doc.meta = { ...s.doc.meta, ...patch };
    }, true),

    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({
        doc: prev,
        past: s.past.slice(0, -1),
        future: [cloneDoc(s.doc), ...s.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const nxt = s.future[0];
      set({
        doc: nxt,
        past: [...s.past, cloneDoc(s.doc)].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        dirty: true,
      });
    },
  };
});
