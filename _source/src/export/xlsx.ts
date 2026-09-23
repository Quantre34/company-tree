import ExcelJS from 'exceljs';
import type { OrgDoc, OrgNode } from '../types/org';
import { buildCleanSvg, loadImage } from './pdf';
import { translate as t, useLangStore, dateLocale } from '../i18n/langStore';

interface Row {
  level: number;
  parent: string;
  unit: string;
  subtitle: string;
  person: string;
  personRole: string;
  description: string;
  path: string;
}

export async function exportXlsx(doc: OrgDoc) {
  const lang = useLangStore.getState().lang;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CompanyTree';
  wb.created = new Date();

  // ---- Sheet 1: chart image ----
  const wsTree = wb.addWorksheet(t('xlsx.sheetSchema'), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    views: [{ showGridLines: false }],
  });
  try {
    const treePng = await renderTreeToPng(doc, 2);   // 2x DPI
    const imgId = wb.addImage({ base64: treePng.dataUrl, extension: 'png' });
    // Place image starting at row 3 (leave space for header) and give it a wide range.
    const colWidths = Math.min(24, Math.max(12, Math.round(treePng.width / 90)));
    for (let i = 1; i <= colWidths; i++) wsTree.getColumn(i).width = 14;

    // Title row
    wsTree.mergeCells(1, 1, 1, colWidths);
    const titleCell = wsTree.getCell(1, 1);
    titleCell.value = doc.meta.title;
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1F3B73' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    wsTree.getRow(1).height = 26;

    wsTree.mergeCells(2, 1, 2, colWidths);
    const metaCell = wsTree.getCell(2, 1);
    metaCell.value = `${doc.meta.orgName} · ${new Date(doc.meta.updatedAt).toLocaleDateString(dateLocale(lang))}`;
    metaCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' } };
    wsTree.getRow(2).height = 18;

    // Add tree image below title/meta. Excel uses row/col measurements.
    // 1 Excel column ≈ 64px, 1 row ≈ 20px. We compute how many pixels the image is
    // and stretch it accordingly.
    const px = treePng.width;
    const py = treePng.height;
    // Fit image into ~1200px wide box (Excel visual sense).
    const maxW = 1600;
    const scale = Math.min(1, maxW / px);
    const drawW = Math.round(px * scale);
    const drawH = Math.round(py * scale);

    wsTree.addImage(imgId, {
      tl: { col: 0.4, row: 3.5 },
      ext: { width: drawW, height: drawH },
      editAs: 'oneCell',
    });
  } catch (e) {
    console.warn('Excel tree image üretilemedi:', e);
    wsTree.getCell(1, 1).value = t('xlsx.schemaImageFailed');
  }

  // ---- Sheet 2: flat list ----
  const ws = wb.addWorksheet(t('xlsx.sheetOrganization'));
  ws.columns = [
    { header: t('xlsx.colLevel'), key: 'level', width: 8 },
    { header: t('xlsx.colParent'), key: 'parent', width: 30 },
    { header: t('xlsx.colUnit'), key: 'unit', width: 34 },
    { header: t('xlsx.colSubtitle'), key: 'subtitle', width: 26 },
    { header: t('xlsx.colPerson'), key: 'person', width: 26 },
    { header: t('xlsx.colPersonRole'), key: 'personRole', width: 22 },
    { header: t('xlsx.colDescription'), key: 'description', width: 38 },
    { header: t('xlsx.colPath'), key: 'path', width: 60 },
  ];
  ws.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Calibri' };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B73' } };
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };

  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const rows: Row[] = [];
  const root = doc.nodes.find(n => n.parentId === null);
  if (root) walk(root, [], 0, byId, rows);
  for (const r of rows) ws.addRow(r);

  // Zebra stripes for readability
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return;
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8FB' } };
      });
    }
  });

  // ---- Sheet 3: summary ----
  const ws2 = wb.addWorksheet(t('xlsx.sheetSummary'));
  const totalUnits = doc.nodes.length;
  const totalPeople = doc.nodes.reduce((a, n) => a + n.people.length, 0);
  const maxDepth = Math.max(...rows.map(r => r.level), 0);
  ws2.addRow([t('xlsx.summaryUnitCount'), totalUnits]);
  ws2.addRow([t('xlsx.summaryPeopleCount'), totalPeople]);
  ws2.addRow([t('xlsx.summaryMaxDepth'), maxDepth]);
  ws2.addRow([]);
  ws2.addRow([t('xlsx.summaryUnitCol'), t('xlsx.summaryPeopleCol')]);
  ws2.getRow(5).font = { bold: true };
  const perUnit = doc.nodes
    .filter(n => n.people.length > 0)
    .sort((a, b) => b.people.length - a.people.length);
  for (const n of perUnit) ws2.addRow([n.title, n.people.length]);
  ws2.getColumn(1).width = 40;
  ws2.getColumn(2).width = 16;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  const slug = (doc.meta.orgName || 'organizasyon')
    .toLocaleLowerCase('tr')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organizasyon';
  a.download = `${slug}-organizasyon-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Render the tree SVG to a PNG data URL by drawing it to a canvas.
 * @param dpiScale multiplier for resolution (2 = ~150dpi feel)
 */
async function renderTreeToPng(doc: OrgDoc, dpiScale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const svg = buildCleanSvg(doc);
  // Inline any external images (e.g. node-level images that are already data URLs work as-is;
  // relative URLs would need to be preloaded — for now we trust data-URL usage).
  const svgString = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('SVG image load failed'));
      im.src = url;
    });
    const w = parseFloat(svg.getAttribute('width') || '800');
    const h = parseFloat(svg.getAttribute('height') || '600');
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpiScale);
    c.height = Math.round(h * dpiScale);
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas 2d yok');
    g.fillStyle = doc.meta.theme.canvasBg;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    // Also blend the logo overlay if user wants it (skip — Excel sheet has its own layout)
    return {
      dataUrl: c.toDataURL('image/png'),
      width: c.width,
      height: c.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function walk(n: OrgNode, path: string[], level: number, byId: Map<string, OrgNode>, rows: Row[]) {
  const parent = n.parentId ? byId.get(n.parentId) : null;
  const parentTitle = parent?.title ?? '';
  const pathText = path.concat(n.title).join(' > ');
  if (n.people.length === 0) {
    rows.push({
      level, parent: parentTitle, unit: n.title, subtitle: n.subtitle ?? '',
      person: '', personRole: '', description: n.description ?? '', path: pathText,
    });
  } else {
    for (const p of n.people) {
      rows.push({
        level, parent: parentTitle, unit: n.title, subtitle: n.subtitle ?? '',
        person: p.name, personRole: p.role ?? '', description: n.description ?? '', path: pathText,
      });
    }
  }
  const children = [...byId.values()].filter(x => x.parentId === n.id).sort((a, b) => a.order - b.order);
  for (const c of children) walk(c, [...path, n.title], level + 1, byId, rows);
}

// loadImage is exported from pdf.ts; not directly used here but re-exported for future extensions
void loadImage;
