import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrgDoc, LogoCorner } from '../types/org';
import { buildCleanSvg, exportPdf, type PdfOptions } from '../export/pdf';
import { useT, useLang, dateLocale } from '../i18n/langStore';

interface Props {
  doc: OrgDoc;
  onClose: () => void;
}

export function PdfPreview({ doc, onClose }: Props) {
  const t = useT();
  const lang = useLang();
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [format, setFormat] = useState<'a3' | 'a4'>('a3');
  const [showLogo, setShowLogo] = useState<boolean>(doc.meta.showLogo ?? true);
  const [logoCorner, setLogoCorner] = useState<LogoCorner>(doc.meta.logoCorner ?? 'tr');
  const [logoUrl, setLogoUrl] = useState<string>(doc.meta.logoUrl ?? './logo.png');
  const [logoWidthPct, setLogoWidthPct] = useState<number>(doc.meta.logoWidthPct ?? 0.13);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Page dimensions in pt (1pt = 1/72 inch). A3: 842x1191, A4: 595x842.
  const pw = format === 'a3' ? (orientation === 'landscape' ? 1191 : 842) : (orientation === 'landscape' ? 842 : 595);
  const ph = format === 'a3' ? (orientation === 'landscape' ? 842 : 1191) : (orientation === 'landscape' ? 595 : 842);

  const svgString = useMemo(() => {
    const svg = buildCleanSvg(doc);
    return new XMLSerializer().serializeToString(svg);
  }, [doc]);

  const svgSize = useMemo(() => {
    const m = svgString.match(/width="(\d+(\.\d+)?)"\s+height="(\d+(\.\d+)?)"/);
    return { w: m ? parseFloat(m[1]) : 800, h: m ? parseFloat(m[3]) : 600 };
  }, [svgString]);

  // Preview scale — fit page to 640px wide preview area
  const previewMaxW = 720, previewMaxH = 480;
  const pageScale = Math.min(previewMaxW / pw, previewMaxH / ph);
  const pageW = pw * pageScale;
  const pageH = ph * pageScale;

  const marginX = 32, marginTop = 68, marginBottom = 42;
  const contentW = pw - marginX * 2;
  const contentH = ph - marginTop - marginBottom;
  const bodyScale = Math.min(contentW / svgSize.w, contentH / svgSize.h);
  const bodyW = svgSize.w * bodyScale;
  const bodyH = svgSize.h * bodyScale;
  const bodyX = (pw - bodyW) / 2;
  const bodyY = marginTop + (contentH - bodyH) / 2;

  const logoW = pw * logoWidthPct;
  const logoMargin = 24;

  const [logoRatio, setLogoRatio] = useState(1);
  useEffect(() => {
    if (!showLogo || !logoUrl) return;
    const im = new Image();
    im.onload = () => setLogoRatio(im.naturalHeight / im.naturalWidth || 1);
    im.onerror = () => setLogoRatio(1);
    im.src = logoUrl;
  }, [logoUrl, showLogo]);

  const logoH = logoW * logoRatio;
  const lx = logoCorner.includes('l') ? logoMargin : pw - logoMargin - logoW;
  const ly = logoCorner.startsWith('t') ? logoMargin : ph - logoMargin - logoH;

  const onDownload = async () => {
    setBusy(true);
    try {
      const opts: PdfOptions = { orientation, format, showLogo, logoCorner, logoUrl, logoWidthPct };
      await exportPdf(doc, opts);
      onClose();
    } catch (e: any) {
      alert(t('error.pdfPrefix', { msg: e?.message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const onPickLogo = (f: File) => {
    if (!f.type.startsWith('image/')) { alert(t('common.onlyImageFiles')); return; }
    if (f.size > 3 * 1024 * 1024) { alert(t('common.max3mb')); return; }
    const r = new FileReader();
    r.onload = () => setLogoUrl(r.result as string);
    r.readAsDataURL(f);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="pdf-preview" onClick={e => e.stopPropagation()}>
        <div className="pdf-preview__head">
          <h2>{t('pdf.previewTitle')}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="pdf-preview__body">
          <div className="pdf-preview__stage">
            <div
              className="pdf-page"
              style={{ width: pageW, height: pageH, background: doc.meta.theme.canvasBg }}
            >
              {/* Header text (visual mock) */}
              <div className="pdf-page__title" style={{
                left: marginX * pageScale,
                top: 36 * pageScale,
                fontSize: 14 * pageScale,
                color: doc.meta.theme.primary,
              }}>{doc.meta.title}</div>
              <div className="pdf-page__meta" style={{
                left: marginX * pageScale,
                top: 52 * pageScale,
                fontSize: 10 * pageScale,
              }}>{doc.meta.orgName} · {new Date(doc.meta.updatedAt).toLocaleDateString(dateLocale(lang))}</div>

              {/* Logo */}
              {showLogo && logoUrl && logoW > 0 && (
                <img
                  src={logoUrl}
                  alt=""
                  style={{
                    position: 'absolute',
                    left: lx * pageScale,
                    top: ly * pageScale,
                    width: logoW * pageScale,
                    height: logoH * pageScale,
                    objectFit: 'contain',
                  }}
                />
              )}

              {/* Tree body */}
              <div
                className="pdf-page__body"
                style={{
                  position: 'absolute',
                  left: bodyX * pageScale,
                  top: bodyY * pageScale,
                  width: bodyW * pageScale,
                  height: bodyH * pageScale,
                }}
                dangerouslySetInnerHTML={{ __html: svgString.replace(/width="[^"]*"/, `width="${bodyW * pageScale}"`).replace(/height="[^"]*"/, `height="${bodyH * pageScale}"`) }}
              />

              {/* Footer */}
              <div className="pdf-page__footer-l" style={{ left: marginX * pageScale, bottom: 18 * pageScale, fontSize: 9 * pageScale }}>{t('pdf.footerConfidential')}</div>
              <div className="pdf-page__footer-r" style={{ right: marginX * pageScale, bottom: 18 * pageScale, fontSize: 9 * pageScale }}>CompanyTree</div>
            </div>
          </div>

          <div className="pdf-preview__controls">
            <div className="field">
              <label>{t('pdf.paperLabel')}</label>
              <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {(['a3', 'a4'] as const).map(f => (
                  <button key={f} className={f === format ? 'active' : ''} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('pdf.orientationLabel')}</label>
              <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button className={orientation === 'landscape' ? 'active' : ''} onClick={() => setOrientation('landscape')}>{t('pdf.landscape')}</button>
                <button className={orientation === 'portrait' ? 'active' : ''} onClick={() => setOrientation('portrait')}>{t('pdf.portrait')}</button>
              </div>
            </div>

            <div className="field">
              <label>{t('common.logo')}</label>
              <label className="check">
                <input type="checkbox" checked={showLogo} onChange={e => setShowLogo(e.target.checked)} />
                {t('pdf.showLogoCheckbox')}
              </label>
            </div>

            {showLogo && (
              <>
                <div className="field">
                  <label>{t('inspector.logoPosition')}</label>
                  <div className="corner-grid">
                    {(['tl','tr','bl','br'] as const).map(c => (
                      <button key={c}
                        className={c === logoCorner ? 'active' : ''}
                        title={cornerLabel(c, t)}
                        onClick={() => setLogoCorner(c)}
                      >
                        <span className={`corner-icon corner-${c}`} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>{t('inspector.logoWidthLabel', { pct: (logoWidthPct * 100).toFixed(0) })}</label>
                  <input type="range" min={5} max={30} value={Math.round(logoWidthPct * 100)}
                    onChange={e => setLogoWidthPct(parseInt(e.target.value) / 100)} />
                </div>
                <div className="field">
                  <label>{t('pdf.logoImageLabel')}</label>
                  <div className="btn-row">
                    <button onClick={() => fileRef.current?.click()}>{t('common.change')}</button>
                    <button onClick={() => setLogoUrl('./logo.png')}>{t('common.default')}</button>
                    <input ref={fileRef} type="file" accept="image/*" hidden
                      onChange={e => { const f = e.target.files?.[0]; if (f) onPickLogo(f); e.currentTarget.value = ''; }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pdf-preview__actions">
          <button onClick={onClose}>{t('pdf.cancel')}</button>
          <button className="primary" onClick={onDownload} disabled={busy}>
            {busy ? t('pdf.generating') : t('pdf.downloadButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

function cornerLabel(c: LogoCorner, t: ReturnType<typeof useT>) {
  return c === 'tl' ? t('corner.topLeft') : c === 'tr' ? t('corner.topRight') : c === 'bl' ? t('corner.bottomLeft') : t('corner.bottomRight');
}
