import type { OrgDoc, OrgNode } from '../types/org';
import {
  NODE_W, NODE_MIN_H, H_GAP, V_GAP, PAD_X, PAD_Y,
  HEADER_H, TITLE_LINE_H, SUBTITLE_LINE_H, PEOPLE_LINE_H,
  FONT_SIZE_TITLE, FONT_SIZE_SUBTITLE,
  STACKED_VGAP,
} from './constants';
import { wrap } from './measureText';

export interface NodeSection {
  type: 'banner' | 'title' | 'subtitle' | 'image' | 'people' | 'description';
  y: number;
  h: number;
}

export interface NodeInner {
  hasBanner: boolean;
  bannerH: number;
  titleLines: string[];
  subtitleLines: string[];
  peopleLines: { id: string; text: string }[];
  descriptionLines: string[];
  imageBox: { x: number; y: number; w: number; h: number } | null;
  sections: NodeSection[];
}

export interface PositionedBox {
  id: string;
  x: number; y: number; w: number; h: number;
  node: OrgNode;
  inner: NodeInner;
}

export interface Edge {
  from: string; to: string;
  d: string;
  mode: 'horizontal' | 'stacked';
}

export interface LayoutResult {
  boxes: PositionedBox[];
  edges: Edge[];
  boxById: Map<string, PositionedBox>;
  bounds: { w: number; h: number };
}

const STACKED_INDENT = 30;

export function layout(doc: OrgDoc): LayoutResult {
  const nodes = doc.nodes;
  const byId = new Map<string, OrgNode>();
  for (const n of nodes) byId.set(n.id, n);

  const childrenMap = new Map<string | null, OrgNode[]>();
  for (const n of nodes) {
    // Floating (unattached) nodes are placed absolutely — do not enrol them as
    // children of anyone, and do not treat them as root candidates.
    if (n.unattached) continue;
    const arr = childrenMap.get(n.parentId) ?? [];
    arr.push(n);
    childrenMap.set(n.parentId, arr);
  }
  for (const arr of childrenMap.values()) arr.sort((a, b) => a.order - b.order);

  const defaultMode = doc.meta.defaults.layoutMode;

  const size = new Map<string, { w: number; h: number; inner: NodeInner }>();
  for (const n of nodes) size.set(n.id, computeNodeSize(n, doc));

  interface Extent { w: number; h: number; }
  const extent = new Map<string, Extent>();

  function computeExtent(id: string): Extent {
    const cached = extent.get(id);
    if (cached) return cached;
    const n = byId.get(id)!;
    const s = size.get(id)!;
    const kids = n.collapsed ? [] : (childrenMap.get(id) ?? []);
    if (kids.length === 0) {
      const e = { w: s.w, h: s.h };
      extent.set(id, e);
      return e;
    }
    const mode = n.layoutMode ?? defaultMode;
    let e: Extent;
    if (mode === 'horizontal') {
      const kidExts = kids.map(k => computeExtent(k.id));
      const totalW = kidExts.reduce((a, x) => a + x.w, 0) + (kids.length - 1) * H_GAP;
      const maxKidH = Math.max(...kidExts.map(x => x.h));
      e = { w: Math.max(s.w, totalW), h: s.h + V_GAP + maxKidH };
    } else {
      const kidExts = kids.map(k => computeExtent(k.id));
      const maxKidW = Math.max(...kidExts.map(x => x.w));
      const totalH = kidExts.reduce((a, x) => a + x.h, 0) + (kids.length - 1) * STACKED_VGAP;
      e = { w: Math.max(s.w, STACKED_INDENT + maxKidW), h: s.h + STACKED_VGAP + totalH };
    }
    extent.set(id, e);
    return e;
  }

  const boxes: PositionedBox[] = [];
  const edges: Edge[] = [];
  const boxById = new Map<string, PositionedBox>();

  function place(id: string, x: number, y: number) {
    const n = byId.get(id)!;
    const s = size.get(id)!;
    const ext = computeExtent(id);
    const kids = n.collapsed ? [] : (childrenMap.get(id) ?? []);
    const hasKids = kids.length > 0;
    const mode = hasKids ? (n.layoutMode ?? defaultMode) : 'horizontal';

    const nodeX = hasKids && mode === 'horizontal'
      ? x + Math.round((ext.w - s.w) / 2)
      : x;
    const nodeY = y;

    const box: PositionedBox = {
      id,
      x: Math.round(nodeX), y: Math.round(nodeY),
      w: s.w, h: s.h, node: n, inner: s.inner,
    };
    boxes.push(box);
    boxById.set(id, box);

    if (!hasKids) return;

    if (mode === 'horizontal') {
      const kidExts = kids.map(k => computeExtent(k.id));
      const totalW = kidExts.reduce((a, x) => a + x.w, 0) + (kids.length - 1) * H_GAP;
      let cx = x + Math.round((ext.w - totalW) / 2);
      const cy = nodeY + s.h + V_GAP;
      for (let i = 0; i < kids.length; i++) {
        place(kids[i].id, cx, cy);
        const childBox = boxById.get(kids[i].id)!;
        const parentBottomX = box.x + Math.round(box.w / 2);
        const parentBottomY = box.y + box.h;
        const cX = childBox.x + Math.round(childBox.w / 2);
        const cY = childBox.y;
        const midY = Math.round(parentBottomY + (cY - parentBottomY) / 2);
        const d = `M ${parentBottomX} ${parentBottomY} L ${parentBottomX} ${midY} L ${cX} ${midY} L ${cX} ${cY}`;
        edges.push({ from: id, to: kids[i].id, d, mode: 'horizontal' });
        cx += kidExts[i].w + H_GAP;
      }
    } else {
      let cy = nodeY + s.h + STACKED_VGAP;
      const cx = x + STACKED_INDENT;
      for (const k of kids) {
        place(k.id, cx, cy);
        const childBox = boxById.get(k.id)!;
        const spineX = box.x + 12;
        const spineTopY = box.y + box.h;
        const childLeftX = childBox.x;
        const childCenterY = childBox.y + Math.round(childBox.h / 2);
        const d = `M ${spineX} ${spineTopY} L ${spineX} ${childCenterY} L ${childLeftX} ${childCenterY}`;
        edges.push({ from: id, to: k.id, d, mode: 'stacked' });
        cy += computeExtent(k.id).h + STACKED_VGAP;
      }
    }
  }

  const root = nodes.find(n => n.parentId === null && !n.unattached);
  if (root) place(root.id, 40, 40);

  // Floating nodes: run a sub-tree layout starting at each unattached node's
  // own coordinates. Descendants come along so a whole detached subtree stays
  // visually cohesive during / after a drag.
  for (const n of nodes) {
    if (!n.unattached) continue;
    place(n.id, n.unattached.x, n.unattached.y);
  }

  let maxX = 0, maxY = 0;
  for (const b of boxes) {
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }

  return { boxes, edges, boxById, bounds: { w: maxX + 40, h: maxY + 40 } };
}

export function computeNodeSize(n: OrgNode, doc: OrgDoc): { w: number; h: number; inner: NodeInner } {
  const w = n.style?.width ?? doc.meta.defaults.nodeWidth ?? NODE_W;
  const innerW = w - PAD_X * 2;
  // Wrap conservatively (-8px) so text stays inside the box even when the
  // browser measures with a slightly narrower fallback font before Roboto loads.
  const wrapW = Math.max(40, innerW - 8);

  const titleLines = wrap((n.title || '').toUpperCase(), wrapW, FONT_SIZE_TITLE, 700);
  const subtitleLines = n.subtitle ? wrap(n.subtitle.toUpperCase(), wrapW, FONT_SIZE_SUBTITLE, 400) : [];
  const peopleLines = (n.people ?? []).map(p => ({
    id: p.id,
    text: p.role ? `${p.name} — ${p.role}` : p.name,
  }));
  const descriptionLines: string[] = [];

  const bannerDefault: 'banner' | 'plain' = n.type === 'department' ? 'banner' : 'plain';
  const hasBanner = (n.style?.headerStyle ?? bannerDefault) === 'banner';
  const bannerH = hasBanner ? Math.max(HEADER_H, titleLines.length * TITLE_LINE_H + 10) : 0;
  const imgH = n.style?.image ? (n.style.imageHeight ?? 88) : 0;

  const sections: NodeSection[] = [];
  let y = PAD_Y;

  if (hasBanner) {
    sections.push({ type: 'banner', y, h: bannerH });
    y += bannerH + 6;
  } else if (titleLines.length) {
    const h = titleLines.length * TITLE_LINE_H;
    sections.push({ type: 'title', y, h });
    y += h + 2;
  }
  if (subtitleLines.length) {
    const h = subtitleLines.length * SUBTITLE_LINE_H;
    sections.push({ type: 'subtitle', y, h });
    y += h + 4;
  }

  let imageBox: NodeInner['imageBox'] = null;
  if (imgH) {
    imageBox = { x: PAD_X, y, w: innerW, h: imgH };
    sections.push({ type: 'image', y, h: imgH });
    y += imgH + 6;
  }

  if (peopleLines.length) {
    const h = peopleLines.length * PEOPLE_LINE_H;
    sections.push({ type: 'people', y, h });
    y += h;
  }

  y += PAD_Y;
  const h = Math.max(NODE_MIN_H, y);

  return {
    w, h,
    inner: {
      hasBanner, bannerH, titleLines, subtitleLines, peopleLines, descriptionLines,
      imageBox, sections,
    },
  };
}
