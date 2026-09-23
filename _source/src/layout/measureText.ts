import { FONT_STACK } from './constants';

let sharedCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (sharedCtx) return sharedCtx;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D context not available');
  sharedCtx = g;
  return g;
}

export function measure(text: string, size: number, weight: number = 400): number {
  const g = ctx();
  g.font = `${weight} ${size}px ${FONT_STACK}`;
  return g.measureText(text).width;
}

/**
 * Word-wrap text to fit within maxWidth. Returns an array of lines.
 * Long unbreakable strings are broken at character boundaries.
 */
export function wrap(text: string, maxWidth: number, size: number, weight = 400): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const g = ctx();
  g.font = `${weight} ${size}px ${FONT_STACK}`;
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (g.measureText(trial).width <= maxWidth) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      // Word too long — hard-break
      if (g.measureText(w).width > maxWidth) {
        let acc = '';
        for (const ch of w) {
          const t2 = acc + ch;
          if (g.measureText(t2).width > maxWidth) {
            if (acc) lines.push(acc);
            acc = ch;
          } else {
            acc = t2;
          }
        }
        cur = acc;
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
