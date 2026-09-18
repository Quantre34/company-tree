import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import type { OrgDoc, LogoCorner } from '../types/org';
import { layout } from '../layout/layout';
import { TITLE_LINE_H, SUBTITLE_LINE_H, PEOPLE_LINE_H } from '../layout/constants';
import { loadPdfFonts } from './fonts';

export interface PdfOptions {
  orientation?: 'landscape' | 'portrait';
  format?: 'a3' | 'a4';
  logoUrl?: string | null;
  logoCorner?: LogoCorner;
  logoWidthPct?: number;    // 0..1
  showLogo?: boolean;
}

/**
 * Build the clean SVG mirror of the on-screen canvas. Used both for preview
 * and for PDF conversion.
 */
export function buildCleanSvg(doc: OrgDoc): SVGSVGElement {
  const res = layout(doc);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(res.bounds.w));
  svg.setAttribute('height', String(res.bounds.h));
  svg.setAttribute('viewBox', `0 0 ${res.bounds.w} ${res.bounds.h}`);
  svg.setAttribute('xmlns', NS);
  const theme = doc.meta.theme;

  svg.appendChild(el('rect', { x: 0, y: 0, width: res.bounds.w, height: res.bounds.h, fill: theme.canvasBg }));

  // Edges
  const edgeG = el('g');
  for (const e of res.edges) {
    edgeG.appendChild(el('path', {
      d: e.d, stroke: theme.linkColor, fill: 'none',
      'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }
  svg.appendChild(edgeG);

  // Nodes
  for (const box of res.boxes) {
    const g = el('g', { transform: `translate(${box.x}, ${box.y})` });
    const style = box.node.style ?? {};
    const rx = style.shape === 'sharp' ? 0 : style.shape === 'pill' ? Math.min(box.h / 2, 20) : 10;
    const fill = style.fill ?? theme.nodeBg;
    const stroke = '#DDE1E8';

    g.appendChild(el('rect', {
      width: box.w, height: box.h, rx, ry: rx, fill, stroke, 'stroke-width': 1,
    }));

    if (box.inner.hasBanner) {
      const headerFill = style.headerFill ?? theme.primary;
      const totalTitleH = box.inner.titleLines.length * TITLE_LINE_H;
      const firstBaseline = (box.inner.bannerH - totalTitleH) / 2 + TITLE_LINE_H - 4;
      g.appendChild(el('path', {
        d: roundedTopPath(box.w, box.inner.bannerH, rx), fill: headerFill,
      }));
      box.inner.titleLines.forEach((line, i) => {
        g.appendChild(text(line, box.w / 2, firstBaseline + i * TITLE_LINE_H, {
          fill: theme.headerText, fontSize: 12.5, fontWeight: 700, anchor: 'middle',
        }));
      });
    } else {
      const s = box.inner.sections.find(s => s.type === 'title');
      if (s) box.inner.titleLines.forEach((line, i) => {
        g.appendChild(text(line, box.w / 2, s.y + 18 * (i + 1) - 4, {
          fill: style.textColor ?? theme.nodeText, fontSize: 12.5, fontWeight: 700, anchor: 'middle',
        }));
      });
    }

    const sub = box.inner.sections.find(s => s.type === 'subtitle');
    if (sub) box.inner.subtitleLines.forEach((line, i) => {
      // svg2pdf.js normalises font-weight ONLY at 400/normal or 700/bold.
      // Any other numeric weight (e.g. 500) causes it to look up a style like
      // "500normal" which we have not registered → silent fallback to Helvetica
      // → Turkish characters (İ, ğ, ç…) get corrupted. Stick to 400.
      g.appendChild(text(line, box.w / 2, sub.y + SUBTITLE_LINE_H * (i + 1) - 3, {
        fill: style.textColor ?? theme.nodeText, fontSize: 10.5, fontWeight: 400,
        opacity: 0.8, anchor: 'middle',
      }));
    });

    if (style.image && box.inner.imageBox) {
      const img = el('image', {
        x: box.inner.imageBox.x, y: box.inner.imageBox.y,
        width: box.inner.imageBox.w, height: box.inner.imageBox.h,
        preserveAspectRatio: style.imageMode === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice',
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', style.image);
      img.setAttribute('href', style.image);
      g.appendChild(img);
    }

    const ppl = box.inner.sections.find(s => s.type === 'people');
    if (ppl) box.inner.peopleLines.forEach((p, i) => {
      g.appendChild(text(p.text, box.w / 2, ppl.y + PEOPLE_LINE_H * (i + 1) - 3, {
        fill: style.textColor ?? theme.nodeText, fontSize: 11, fontWeight: 400, anchor: 'middle',
      }));
    });
    svg.appendChild(g);
  }

  return svg;
}

export async function renderPdf(doc: OrgDoc, opts: PdfOptions = {}): Promise<jsPDF> {
  const orientation = opts.orientation ?? 'landscape';
  const format = opts.format ?? 'a3';
  const showLogo = opts.showLogo ?? doc.meta.showLogo ?? true;
  const logoUrl = opts.logoUrl ?? doc.meta.logoUrl ?? null;
  const logoCorner: LogoCorner = opts.logoCorner ?? doc.meta.logoCorner ?? 'tr';
  const logoWidthPct = opts.logoWidthPct ?? doc.meta.logoWidthPct ?? 0.13;

  // Load Roboto (Unicode) so Turkish characters survive.
  const fonts = await loadPdfFonts();

  const svg = buildCleanSvg(doc);
  // svg2pdf reads fontFamily on text elements — set them to Roboto everywhere.
  svg.querySelectorAll('text').forEach(t => t.setAttribute('font-family', 'Roboto'));
  document.body.appendChild(svg);
  svg.style.position = 'absolute';
  svg.style.left = '-99999px';

  const pdf = new jsPDF({ orientation, unit: 'pt', format });
  pdf.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
  pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  pdf.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
  pdf.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  pdf.setFont('Roboto', 'normal');

  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const marginX = 32, marginTop = 68, marginBottom = 42;
  const contentW = pw - marginX * 2;
  const contentH = ph - marginTop - marginBottom;

  const svgW = parseFloat(svg.getAttribute('width') || '0');
  const svgH = parseFloat(svg.getAttribute('height') || '0');
  const scale = Math.min(contentW / svgW, contentH / svgH);
  const drawW = svgW * scale;
  const drawH = svgH * scale;
  const drawX = (pw - drawW) / 2;
  const drawY = marginTop + (contentH - drawH) / 2;

  // Header text
  pdf.setFont('Roboto', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(doc.meta.theme.primary);
  pdf.text(doc.meta.title, marginX, 36);
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(80);
  const parsedDate = doc.meta.updatedAt ? new Date(doc.meta.updatedAt) : null;
  const dateStr = parsedDate && !isNaN(parsedDate.getTime())
    ? parsedDate.toLocaleDateString('tr-TR') : '';
  pdf.text(`${doc.meta.orgName}${dateStr ? ' · ' + dateStr : ''}`, marginX, 52);

  // Logo at corner (loaded async). Guard against SVG logos that report 0×0
  // in Safari — they'd divide-by-zero into a NaN target height.
  if (showLogo && logoUrl) {
    try {
      const img = await loadImage(logoUrl);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const targetW = pw * logoWidthPct;
        const targetH = targetW * (img.naturalHeight / img.naturalWidth);
        const margin = 24;
        const x = logoCorner.includes('l') ? margin : pw - margin - targetW;
        const y = logoCorner.startsWith('t') ? margin : ph - margin - targetH;
        pdf.addImage(img.dataUrl, 'PNG', x, y, targetW, targetH);
      }
    } catch (e) {
      console.warn('Logo yüklenemedi:', e);
    }
  }

  // SVG body
  await (pdf as unknown as { svg: (el: SVGElement, opts: object) => Promise<jsPDF> })
    .svg(svg, { x: drawX, y: drawY, width: drawW, height: drawH });

  // Footer
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text('Gizli — Şirket İçi', marginX, ph - 18);
  pdf.text(`CompanyTree · ${new Date().toLocaleString('tr-TR')}`, pw - marginX, ph - 18, { align: 'right' });

  document.body.removeChild(svg);
  return pdf;
}

function slug(input: string): string {
  return (input || 'organizasyon')
    .toLocaleLowerCase('tr')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organizasyon';
}

export async function exportPdf(doc: OrgDoc, opts: PdfOptions = {}) {
  const pdf = await renderPdf(doc, opts);
  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`${slug(doc.meta.orgName)}-organizasyon-${stamp}.pdf`);
}

interface LoadedImage { dataUrl: string; naturalWidth: number; naturalHeight: number; }

export function loadImage(src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    // If it's already a data URL, use directly.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        if (!g) return reject(new Error('canvas 2d yok'));
        g.drawImage(img, 0, 0);
        resolve({
          dataUrl: c.toDataURL('image/png'),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Görsel yüklenemedi: ' + src));
    img.src = src;
  });
}

function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
function text(t: string, x: number, y: number, opts: { fill: string; fontSize: number; fontWeight?: number; anchor?: string; opacity?: number }) {
  const e = el('text', {
    x, y,
    'text-anchor': opts.anchor ?? 'start',
    'font-family': 'Roboto',
    'font-size': opts.fontSize,
    fill: opts.fill,
  });
  if (opts.fontWeight) e.setAttribute('font-weight', String(opts.fontWeight));
  if (opts.opacity != null) e.setAttribute('opacity', String(opts.opacity));
  e.textContent = t;
  return e;
}
function roundedTopPath(w: number, h: number, r: number): string {
  if (r <= 0) return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h} L 0 ${h} L 0 ${r} Q 0 0 ${r} 0 Z`;
}
