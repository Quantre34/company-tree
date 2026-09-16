import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import { layout } from '../layout/layout';
import { NodeBox } from './NodeBox';

interface Props {
  onAddChild?: (parentId: string) => void;
  onSelectionEmpty?: () => void;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export function Canvas({ onAddChild, onSelectionEmpty, svgRef }: Props) {
  const doc = useOrgStore(s => s.doc);
  const selectedId = useOrgStore(s => s.selectedId);
  const select = useOrgStore(s => s.select);

  const result = useMemo(() => layout(doc), [doc]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const internalSvgRef = useRef<SVGSVGElement>(null);
  const svgUseRef = svgRef ?? internalSvgRef;
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });

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

  const panState = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const tgt = e.target as Element;
    const isEmpty = tgt.tagName.toLowerCase() === 'svg' || !!tgt.closest('.canvas-bg');
    if (!isEmpty) return;
    panState.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {/* ignore */}
    select(null);
    onSelectionEmpty?.();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ps = panState.current;
    if (!ps) return;
    const dx = e.clientX - ps.x;
    const dy = e.clientY - ps.y;
    setView(v => ({ ...v, tx: ps.tx + dx, ty: ps.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (panState.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* ignore */}
      panState.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
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

  return (
    <div className="canvas-wrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
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
