import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import { layout } from '../layout/layout';
import { NodeBox } from './NodeBox';

interface Props {
  onAddChild?: (parentId: string) => void;
  onSelectionEmpty?: () => void;
  svgRef?: React.RefObject<SVGSVGElement>;
}

interface DragState {
  id: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  scaleAtStart: number;
  hoverTargetId: string | null;
}

interface PendingDrag {
  id: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  pointerId: number;
}

const DRAG_THRESHOLD_PX = 4;

export function Canvas({ onAddChild, onSelectionEmpty, svgRef }: Props) {
  const doc = useOrgStore(s => s.doc);
  const selectedId = useOrgStore(s => s.selectedId);
  const select = useOrgStore(s => s.select);
  const setUnattachedPosition = useOrgStore(s => s.setUnattachedPosition);
  const attachFloatingAsChild = useOrgStore(s => s.attachFloatingAsChild);
  const detachToFloating = useOrgStore(s => s.detachToFloating);

  const result = useMemo(() => layout(doc), [doc]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const internalSvgRef = useRef<SVGSVGElement>(null);
  const svgUseRef = svgRef ?? internalSvgRef;
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const pendingDrag = useRef<PendingDrag | null>(null);

  const fitToView = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    if (result.bounds.w < 20 || result.bounds.h < 20) return;
    const padding = 40;
    const scaleX = (rect.width - padding * 2) / result.bounds.w;
    const scaleY = (rect.height - padding * 2) / result.bounds.h;
    const scale = Math.max(0.15, Math.min(scaleX, scaleY, 1));
    if (!Number.isFinite(scale)) return;
    const cx = (rect.width - result.bounds.w * scale) / 2;
    const cy = (rect.height - result.bounds.h * scale) / 2;
    setView({ scale, tx: cx, ty: cy });
  };

  useEffect(() => {
    setTimeout(fitToView, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.bounds.w, result.bounds.h]);

  // Descendants of the currently-dragged node — excluded from drop targets so
  // you can't drop a subtree onto its own child (which would create a cycle).
  const draggedDescendants = useMemo(() => {
    if (!dragState) return new Set<string>();
    const set = new Set<string>();
    const stack = [dragState.id];
    while (stack.length) {
      const cur = stack.pop()!;
      set.add(cur);
      for (const n of doc.nodes) {
        if (n.parentId === cur) stack.push(n.id);
      }
    }
    return set;
  }, [dragState, doc.nodes]);

  // ---- Pan (empty canvas) ----
  const panState = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (dragState || pendingDrag.current) return;
    const tgt = e.target as Element;
    const isEmpty = tgt.tagName.toLowerCase() === 'svg' || !!tgt.closest('.canvas-bg');
    if (!isEmpty) return;
    panState.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {/* ignore */}
    select(null);
    onSelectionEmpty?.();
  };

  // ---- Node pointer-down (any draggable node) ----
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    const box = result.boxById.get(id);
    if (!box) return;
    // Root (parentId=null AND not floating) cannot be dragged.
    if (box.node.parentId === null && !box.node.unattached) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {/* ignore */}
    pendingDrag.current = {
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: box.node.unattached?.x ?? box.x,
      origY: box.node.unattached?.y ?? box.y,
      pointerId: e.pointerId,
    };
  };

  const findDropTarget = (svgX: number, svgY: number, excluded: Set<string>): string | null => {
    for (let i = result.boxes.length - 1; i >= 0; i--) {
      const b = result.boxes[i];
      if (excluded.has(b.id)) continue;
      if (b.node.unattached) continue; // can only attach to tree nodes
      if (svgX >= b.x && svgX <= b.x + b.w && svgY >= b.y && svgY <= b.y + b.h) {
        return b.id;
      }
    }
    return null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Active drag path
    if (dragState) {
      const dx = (e.clientX - dragState.startClientX) / dragState.scaleAtStart;
      const dy = (e.clientY - dragState.startClientY) / dragState.scaleAtStart;
      setUnattachedPosition(dragState.id, dragState.origX + dx, dragState.origY + dy);

      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const svgX = (localX - view.tx) / view.scale;
        const svgY = (localY - view.ty) / view.scale;
        const target = findDropTarget(svgX, svgY, draggedDescendants);
        if (target !== dragState.hoverTargetId) {
          setDragState({ ...dragState, hoverTargetId: target });
        }
      }
      return;
    }

    // Pending → threshold check
    const pd = pendingDrag.current;
    if (pd) {
      const dx = e.clientX - pd.startClientX;
      const dy = e.clientY - pd.startClientY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        const box = result.boxById.get(pd.id);
        if (!box) { pendingDrag.current = null; return; }
        // Detach tree node into floating state so layout renders it (and its
        // subtree) at its current position. Already-floating nodes skip this.
        if (!box.node.unattached) {
          detachToFloating(pd.id, { x: pd.origX, y: pd.origY });
        }
        setDragState({
          id: pd.id,
          startClientX: pd.startClientX,
          startClientY: pd.startClientY,
          origX: pd.origX,
          origY: pd.origY,
          scaleAtStart: view.scale,
          hoverTargetId: null,
        });
        pendingDrag.current = null;
      }
      return;
    }

    // Pan path
    const ps = panState.current;
    if (!ps) return;
    const ddx = e.clientX - ps.x;
    const ddy = e.clientY - ps.y;
    setView(v => ({ ...v, tx: ps.tx + ddx, ty: ps.ty + ddy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragState) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* ignore */}
      if (dragState.hoverTargetId) {
        attachFloatingAsChild(dragState.id, dragState.hoverTargetId);
      }
      setDragState(null);
      return;
    }
    // Pure click on a node without drag → select it
    if (pendingDrag.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* ignore */}
      select(pendingDrag.current.id);
      pendingDrag.current = null;
      return;
    }
    if (panState.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* ignore */}
      panState.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dragState) {
      // Cancel drag — leave node in whatever floating position it's in.
      setDragState(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (dragState) return;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      const delta = -e.deltaY;
      const factor = Math.exp(delta * 0.0015);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView(v => {
        const newScale = Math.max(0.2, Math.min(2.5, v.scale * factor));
        const k = newScale / v.scale;
        return {
          scale: newScale,
          tx: px - (px - v.tx) * k,
          ty: py - (py - v.ty) * k,
        };
      });
    }
  };

  const zoomBy = (factor: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const px = rect.width / 2, py = rect.height / 2;
    setView(v => {
      const newScale = Math.max(0.2, Math.min(2.5, v.scale * factor));
      const k = newScale / v.scale;
      return {
        scale: newScale,
        tx: px - (px - v.tx) * k,
        ty: py - (py - v.ty) * k,
      };
    });
  };

  const theme = doc.meta.theme;
  const dropTargetId = dragState?.hoverTargetId ?? null;

  return (
    <div className="canvas-wrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      tabIndex={-1}
      style={{ background: theme.canvasBg }}
    >
      <svg
        ref={svgUseRef}
        width="100%"
        height="100%"
        style={{ userSelect: 'none' }}
      >
        <rect className="canvas-bg" width="100%" height="100%" fill={theme.canvasBg} />
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <g>
            {result.edges.map(e => (
              <path key={e.from + '->' + e.to} className="edge" d={e.d} stroke={theme.linkColor} />
            ))}
          </g>
          <g>
            {result.boxes.map(b => (
              <NodeBox
                key={b.id}
                box={b}
                theme={theme}
                selected={b.id === selectedId}
                onSelect={select}
                onAddChild={onAddChild}
                onFloatingPointerDown={onNodePointerDown}
                dropTarget={dropTargetId === b.id}
                ghosting={false}
              />
            ))}
          </g>
        </g>
      </svg>

      <div className="canvas-controls">
        <button onClick={() => zoomBy(1 / 1.2)} title="Uzaklaştır">−</button>
        <button onClick={fitToView} title="Ekrana sığdır">⟲ Sığdır</button>
        <button onClick={() => zoomBy(1.2)} title="Yakınlaştır">+</button>
        <button onClick={() => setView({ scale: 1, tx: 40, ty: 40 })} title="Gerçek boy">100%</button>
      </div>
    </div>
  );
}
