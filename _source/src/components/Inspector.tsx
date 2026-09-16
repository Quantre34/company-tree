import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import type { OrgNode } from '../types/org';

interface Props {
  onDeleteRequest: (id: string) => void;
  onReparentRequest: (id: string) => void;
}

export function Inspector({ onDeleteRequest, onReparentRequest }: Props) {
  const selectedId = useOrgStore(s => s.selectedId);
  const doc = useOrgStore(s => s.doc);
  const node = useMemo(() => doc.nodes.find(n => n.id === selectedId) ?? null, [doc, selectedId]);
  const updateNode = useOrgStore(s => s.updateNode);
  const updateStyle = useOrgStore(s => s.updateStyle);
  const addChild = useOrgStore(s => s.addChild);
  const addSibling = useOrgStore(s => s.addSibling);
  const moveUp = useOrgStore(s => s.moveUp);
  const moveDown = useOrgStore(s => s.moveDown);
  const addPerson = useOrgStore(s => s.addPerson);
  const removePerson = useOrgStore(s => s.removePerson);
  const updatePerson = useOrgStore(s => s.updatePerson);
  const movePerson = useOrgStore(s => s.movePerson);

  if (!node) {
    return (
      <div className="inspector">
        <div className="empty-state">
          <strong>Bir kutu seç</strong>
          Boşluğa tıklayarak seçimi kaldırabilirsin.<br/>
          <span style={{ fontSize: 11.5, opacity: 0.75 }}>
            Kutular fare ile taşınamaz — yerleşim otomatik.
          </span>
        </div>
        <div className="section">
          <h3>Global Ayarlar</h3>
          <ThemeControls />
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="section identity">
        <div className="type-badge">{typeLabel(node.type)}</div>
        <h2 className="hero-title">{node.title || 'Başlıksız'}</h2>
        {node.subtitle && <div className="hero-subtitle">{node.subtitle}</div>}
      </div>

      <div className="section">
        <h3>İçerik</h3>
        <div className="field">
          <label>Başlık</label>
          <DebouncedText
            key={node.id + ':title'}
            value={node.title}
            onCommit={(v) => updateNode(node.id, { title: v })}
          />
        </div>
        <div className="field">
          <label>Alt Başlık</label>
          <DebouncedText
            key={node.id + ':subtitle'}
            value={node.subtitle ?? ''}
            onCommit={(v) => updateNode(node.id, { subtitle: v || undefined })}
          />
        </div>
        <div className="field">
          <label>Tip</label>
          <div className="type-row">
            {(['role', 'department', 'group'] as const).map(t => (
              <button
                key={t}
                className={t === node.type ? 'active' : ''}
                onClick={() => updateNode(node.id, { type: t })}
              >{typeLabel(t)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Diziliş (çocuklar için)</label>
          <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(['horizontal', 'stacked'] as const).map(m => (
              <button
                key={m}
                className={m === (node.layoutMode ?? doc.meta.defaults.layoutMode) ? 'active' : ''}
                onClick={() => updateNode(node.id, { layoutMode: m })}
              >{m === 'horizontal' ? 'Yan yana' : 'Alt alta'}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Açıklama</label>
          <textarea
            rows={2}
            value={node.description ?? ''}
            onChange={e => updateNode(node.id, { description: e.target.value || undefined }, false)}
          />
        </div>
      </div>

      <div className="section">
        <h3>Kişiler</h3>
        <ul className="people-list">
          {node.people.map((p, i) => (
            <li key={p.id}>
              <input
                value={p.name}
                onChange={e => updatePerson(node.id, p.id, { name: e.target.value })}
              />
              <button className="ghost" title="Yukarı" onClick={() => movePerson(node.id, p.id, -1)} disabled={i === 0}>↑</button>
              <button className="ghost" title="Aşağı" onClick={() => movePerson(node.id, p.id, 1)} disabled={i === node.people.length - 1}>↓</button>
              <button className="ghost danger" title="Sil" onClick={() => removePerson(node.id, p.id)}>✕</button>
            </li>
          ))}
        </ul>
        <button style={{ marginTop: 8 }} onClick={() => addPerson(node.id)}>+ Çalışan Ekle</button>
      </div>

      <div className="section">
        <h3>Görsel</h3>
        <ImageField node={node} />
      </div>

      <div className="section">
        <h3>Görünüm</h3>
        <div className="field">
          <label style={{ fontSize: 10.5 }}>Başlık şeridi</label>
          <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(['banner', 'plain'] as const).map(v => (
              <button
                key={v}
                className={v === (node.style?.headerStyle ?? (node.type === 'department' ? 'banner' : 'plain')) ? 'active' : ''}
                onClick={() => updateStyle(node.id, { headerStyle: v })}
              >{v === 'banner' ? 'Şeritli' : 'Düz'}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label style={{ fontSize: 10.5 }}>Kutu şekli</label>
          <div className="type-row">
            {(['rounded', 'sharp', 'pill'] as const).map(v => (
              <button
                key={v}
                className={v === (node.style?.shape ?? doc.meta.defaults.shape) ? 'active' : ''}
                onClick={() => updateStyle(node.id, { shape: v })}
              >{v === 'rounded' ? '⌐ Yuvarlak' : v === 'sharp' ? '□ Köşeli' : '⬭ Kapsül'}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Şerit rengi</label>
          <input type="color" value={node.style?.headerFill ?? doc.meta.theme.primary} onChange={e => updateStyle(node.id, { headerFill: e.target.value })} />
        </div>
        <div className="field">
          <label>Kutu rengi</label>
          <input type="color" value={node.style?.fill ?? doc.meta.theme.nodeBg} onChange={e => updateStyle(node.id, { fill: e.target.value })} />
        </div>
      </div>

      <div className="section">
        <h3>Yapı</h3>
        <div className="btn-row">
          <button onClick={() => addChild(node.id)}>+ Alt Birim</button>
          <button onClick={() => addSibling(node.id)} disabled={node.parentId === null}>+ Yan Birim</button>
          <button onClick={() => moveUp(node.id)}>↑ Yukarı</button>
          <button onClick={() => moveDown(node.id)}>↓ Aşağı</button>
          <button onClick={() => onReparentRequest(node.id)} disabled={node.parentId === null}>⇄ Üstünü Değiştir</button>
          <button className="danger" onClick={() => onDeleteRequest(node.id)} disabled={node.parentId === null}>🗑 Sil</button>
        </div>
      </div>
    </div>
  );
}

function typeLabel(t: 'role' | 'department' | 'group') {
  return t === 'role' ? 'Pozisyon' : t === 'department' ? 'Birim' : 'Grup';
}

function DebouncedText({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setLocal(value); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

function ImageField({ node }: { node: OrgNode }) {
  const updateStyle = useOrgStore(s => s.updateStyle);
  const fileRef = useRef<HTMLInputElement>(null);
  const image = node.style?.image;
  const mode = node.style?.imageMode ?? 'cover';
  const heightV = node.style?.imageHeight ?? 88;

  const onPick = (f: File) => {
    if (!f.type.startsWith('image/')) { alert('Yalnızca resim dosyaları.'); return; }
    if (f.size > 3 * 1024 * 1024) { alert('En fazla 3 MB.'); return; }
    const r = new FileReader();
    r.onload = () => updateStyle(node.id, { image: r.result as string });
    r.readAsDataURL(f);
  };

  return (
    <>
      {image ? (
        <div className="image-preview">
          <img src={image} alt="" style={{ objectFit: mode }} />
        </div>
      ) : (
        <div className="image-preview" style={{ color: 'var(--muted)', fontSize: 12 }}>Görsel yok</div>
      )}
      <div className="btn-row">
        <button onClick={() => fileRef.current?.click()}>{image ? 'Değiştir' : 'Yükle'}</button>
        {image && <button className="danger" onClick={() => updateStyle(node.id, { image: undefined })}>Kaldır</button>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
      </div>
      {image && (
        <>
          <div className="field row" style={{ marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 10.5 }}>Yükseklik: {heightV}px</label>
              <input type="range" min={40} max={220} value={heightV} onChange={e => updateStyle(node.id, { imageHeight: parseInt(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: 10.5 }}>Ölçek</label>
              <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button className={mode === 'cover' ? 'active' : ''} onClick={() => updateStyle(node.id, { imageMode: 'cover' })}>Doldur</button>
                <button className={mode === 'contain' ? 'active' : ''} onClick={() => updateStyle(node.id, { imageMode: 'contain' })}>Sığdır</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ThemeControls() {
  const theme = useOrgStore(s => s.doc.meta.theme);
  const meta = useOrgStore(s => s.doc.meta);
  const updateTheme = useOrgStore(s => s.updateTheme);
  const updateMeta = useOrgStore(s => s.updateMeta);
  const fileRef = useRef<HTMLInputElement>(null);
  const showLogo = meta.showLogo ?? true;
  const logoCorner = meta.logoCorner ?? 'tr';
  const logoUrl = meta.logoUrl ?? './logo.png';
  const logoWidthPct = meta.logoWidthPct ?? 0.13;

  const onPickLogo = (f: File) => {
    if (!f.type.startsWith('image/')) { alert('Yalnızca resim.'); return; }
    if (f.size > 3 * 1024 * 1024) { alert('En fazla 3 MB.'); return; }
    const r = new FileReader();
    r.onload = () => updateMeta({ logoUrl: r.result as string });
    r.readAsDataURL(f);
  };

  return (
    <>
      <div className="field">
        <label>Kuruluş Adı</label>
        <input value={meta.orgName} onChange={e => updateMeta({ orgName: e.target.value })} />
      </div>
      <div className="field">
        <label>Şema Başlığı</label>
        <input value={meta.title} onChange={e => updateMeta({ title: e.target.value })} />
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Çıktı Logosu</label>
        <div className="image-preview" style={{ height: 82 }}>
          {showLogo && logoUrl
            ? <img src={logoUrl} alt="" style={{ objectFit: 'contain' }} />
            : <span style={{ fontSize: 12 }}>Logo gösterilmiyor</span>}
        </div>
        <div className="btn-row">
          <button onClick={() => fileRef.current?.click()}>Değiştir</button>
          <button onClick={() => updateMeta({ logoUrl: './logo.png' })}>Varsayılan</button>
          <button onClick={() => updateMeta({ showLogo: !showLogo })}>
            {showLogo ? 'Gizle' : 'Göster'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) onPickLogo(f); e.currentTarget.value = ''; }} />
        </div>
      </div>

      {showLogo && (
        <>
          <div className="field">
            <label>Logo Konumu</label>
            <div className="corner-grid">
              {(['tl','tr','bl','br'] as const).map(c => (
                <button key={c}
                  className={c === logoCorner ? 'active' : ''}
                  title={c === 'tl' ? 'Sol üst' : c === 'tr' ? 'Sağ üst' : c === 'bl' ? 'Sol alt' : 'Sağ alt'}
                  onClick={() => updateMeta({ logoCorner: c })}
                >
                  <span className={`corner-icon corner-${c}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Logo Genişliği: {Math.round(logoWidthPct * 100)}%</label>
            <input type="range" min={5} max={30} value={Math.round(logoWidthPct * 100)}
              onChange={e => updateMeta({ logoWidthPct: parseInt(e.target.value) / 100 })} />
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Ana Renk</label>
        <input type="color" value={theme.primary} onChange={e => updateTheme({ primary: e.target.value })} />
      </div>
      <div className="field">
        <label>Vurgu Rengi</label>
        <input type="color" value={theme.accent} onChange={e => updateTheme({ accent: e.target.value })} />
      </div>
      <div className="field">
        <label>Kanvas Arka</label>
        <input type="color" value={theme.canvasBg} onChange={e => updateTheme({ canvasBg: e.target.value })} />
      </div>
      <div className="field">
        <label>Bağlantı</label>
        <input type="color" value={theme.linkColor} onChange={e => updateTheme({ linkColor: e.target.value })} />
      </div>
    </>
  );
}
