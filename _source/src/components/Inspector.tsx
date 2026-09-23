import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgStore } from '../store/orgStore';
import type { OrgNode } from '../types/org';
import { useT } from '../i18n/langStore';

interface Props {
  onDeleteRequest: (id: string) => void;
  onReparentRequest: (id: string) => void;
}

export function Inspector({ onDeleteRequest, onReparentRequest }: Props) {
  const t = useT();
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
          <strong>{t('inspector.selectNode')}</strong>
          {t('inspector.selectNodeHint')}<br/>
          <span style={{ fontSize: 11.5, opacity: 0.75 }}>
            {t('inspector.autoLayoutHint')}
          </span>
        </div>
        <div className="section">
          <h3>{t('inspector.globalSettings')}</h3>
          <ThemeControls />
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="section identity">
        <div className="type-badge">{typeLabel(node.type, t)}</div>
        <h2 className="hero-title">{node.title || t('inspector.untitled')}</h2>
        {node.subtitle && <div className="hero-subtitle">{node.subtitle}</div>}
      </div>

      <div className="section">
        <h3>{t('inspector.content')}</h3>
        <div className="field">
          <label>{t('inspector.titleLabel')}</label>
          <DebouncedText
            key={node.id + ':title'}
            value={node.title}
            onCommit={(v) => updateNode(node.id, { title: v })}
          />
        </div>
        <div className="field">
          <label>{t('inspector.subtitleLabel')}</label>
          <DebouncedText
            key={node.id + ':subtitle'}
            value={node.subtitle ?? ''}
            onCommit={(v) => updateNode(node.id, { subtitle: v || undefined })}
          />
        </div>
        <div className="field">
          <label>{t('inspector.typeLabel')}</label>
          <div className="type-row">
            {(['role', 'department', 'group'] as const).map(ty => (
              <button
                key={ty}
                className={ty === node.type ? 'active' : ''}
                onClick={() => updateNode(node.id, { type: ty })}
              >{typeLabel(ty, t)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('inspector.layoutModeLabel')}</label>
          <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(['horizontal', 'stacked'] as const).map(m => (
              <button
                key={m}
                className={m === (node.layoutMode ?? doc.meta.defaults.layoutMode) ? 'active' : ''}
                onClick={() => updateNode(node.id, { layoutMode: m })}
              >{m === 'horizontal' ? t('inspector.horizontal') : t('inspector.stacked')}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('inspector.descriptionLabel')}</label>
          <DebouncedText
            key={node.id + ':description'}
            multiline rows={2}
            value={node.description ?? ''}
            onCommit={(v) => updateNode(node.id, { description: v || undefined })}
          />
        </div>
      </div>

      <div className="section">
        <h3>{t('inspector.people')}</h3>
        <ul className="people-list">
          {node.people.map((p, i) => (
            <li key={p.id}>
              <input
                value={p.name}
                onChange={e => updatePerson(node.id, p.id, { name: e.target.value })}
              />
              <button className="ghost" title={t('common.up')} onClick={() => movePerson(node.id, p.id, -1)} disabled={i === 0}>↑</button>
              <button className="ghost" title={t('common.down')} onClick={() => movePerson(node.id, p.id, 1)} disabled={i === node.people.length - 1}>↓</button>
              <button className="ghost danger" title={t('common.delete')} onClick={() => removePerson(node.id, p.id)}>✕</button>
            </li>
          ))}
        </ul>
        <button style={{ marginTop: 8 }} onClick={() => addPerson(node.id)}>{t('inspector.addPerson')}</button>
      </div>

      <div className="section">
        <h3>{t('inspector.image')}</h3>
        <ImageField node={node} />
      </div>

      <div className="section">
        <h3>{t('inspector.appearance')}</h3>
        <div className="field">
          <label style={{ fontSize: 10.5 }}>{t('inspector.headerStyleLabel')}</label>
          <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(['banner', 'plain'] as const).map(v => (
              <button
                key={v}
                className={v === (node.style?.headerStyle ?? (node.type === 'department' ? 'banner' : 'plain')) ? 'active' : ''}
                onClick={() => updateStyle(node.id, { headerStyle: v })}
              >{v === 'banner' ? t('inspector.banner') : t('inspector.plain')}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label style={{ fontSize: 10.5 }}>{t('inspector.shapeLabel')}</label>
          <div className="type-row">
            {(['rounded', 'sharp', 'pill'] as const).map(v => (
              <button
                key={v}
                className={v === (node.style?.shape ?? doc.meta.defaults.shape) ? 'active' : ''}
                onClick={() => updateStyle(node.id, { shape: v })}
              >{v === 'rounded' ? t('inspector.shapeRounded') : v === 'sharp' ? t('inspector.shapeSharp') : t('inspector.shapePill')}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('inspector.headerColor')}</label>
          <DebouncedColor
            value={node.style?.headerFill ?? doc.meta.theme.primary}
            onLive={(v) => updateStyle(node.id, { headerFill: v }, false)}
            onCommit={(v) => updateStyle(node.id, { headerFill: v }, true)}
          />
        </div>
        <div className="field">
          <label>{t('inspector.boxColor')}</label>
          <DebouncedColor
            value={node.style?.fill ?? doc.meta.theme.nodeBg}
            onLive={(v) => updateStyle(node.id, { fill: v }, false)}
            onCommit={(v) => updateStyle(node.id, { fill: v }, true)}
          />
        </div>
      </div>

      <div className="section">
        <h3>{t('inspector.structure')}</h3>
        <div className="btn-row">
          <button onClick={() => addChild(node.id)}>{t('inspector.addChild')}</button>
          <button onClick={() => addSibling(node.id)} disabled={node.parentId === null}>{t('inspector.addSibling')}</button>
          <button onClick={() => moveUp(node.id)}>{t('inspector.moveUp')}</button>
          <button onClick={() => moveDown(node.id)}>{t('inspector.moveDown')}</button>
          <button onClick={() => onReparentRequest(node.id)} disabled={node.parentId === null}>{t('inspector.reparent')}</button>
          <button className="danger" onClick={() => onDeleteRequest(node.id)} disabled={node.parentId === null}>{t('inspector.deleteNode')}</button>
        </div>
      </div>
    </div>
  );
}

function typeLabel(ty: 'role' | 'department' | 'group', t: ReturnType<typeof useT>) {
  return ty === 'role' ? t('inspector.typeRole') : ty === 'department' ? t('inspector.typeDepartment') : t('inspector.typeGroup');
}

interface DebouncedTextProps {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}
/**
 * Only commits on blur (or Enter for input mode). We do NOT flush a store
 * update on every keystroke because that fires the 2s autosave → PBKDF2 250k
 * → 500-1500ms freeze on mobile per keystroke.
 */
function DebouncedText({ value, onCommit, multiline, rows, placeholder }: DebouncedTextProps) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  if (multiline) {
    return (
      <textarea
        rows={rows ?? 2}
        value={local}
        placeholder={placeholder}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Escape') { setLocal(value); (e.currentTarget as HTMLTextAreaElement).blur(); }
        }}
      />
    );
  }
  return (
    <input
      value={local}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setLocal(value); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

/**
 * Native color-picker input that streams intermediate values to the tree
 * (for live preview) but only snapshots undo + marks the doc dirty on
 * commit (`onChange` after picker closes / `onBlur`). Avoids filling the
 * undo stack with 60 intermediate hex values while sliding.
 */
function DebouncedColor({
  value, onLive, onCommit,
}: {
  value: string;
  onLive: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="color"
      value={local}
      onInput={e => {
        const v = (e.currentTarget as HTMLInputElement).value;
        setLocal(v);
        onLive(v);   // visual only — no snapshot, no dirty
      }}
      onChange={e => onCommit((e.currentTarget as HTMLInputElement).value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
    />
  );
}

function ImageField({ node }: { node: OrgNode }) {
  const t = useT();
  const updateStyle = useOrgStore(s => s.updateStyle);
  const fileRef = useRef<HTMLInputElement>(null);
  const image = node.style?.image;
  const mode = node.style?.imageMode ?? 'cover';
  const heightV = node.style?.imageHeight ?? 88;

  const onPick = (f: File) => {
    if (!f.type.startsWith('image/')) { alert(t('common.onlyImageFiles')); return; }
    if (f.size > 3 * 1024 * 1024) { alert(t('common.max3mb')); return; }
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
        <div className="image-preview" style={{ color: 'var(--muted)', fontSize: 12 }}>{t('inspector.noImage')}</div>
      )}
      <div className="btn-row">
        <button onClick={() => fileRef.current?.click()}>{image ? t('common.change') : t('common.upload')}</button>
        {image && <button className="danger" onClick={() => updateStyle(node.id, { image: undefined })}>{t('common.remove')}</button>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
      </div>
      {image && (
        <>
          <div className="field row" style={{ marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 10.5 }}>{t('inspector.heightLabel', { px: heightV })}</label>
              <input type="range" min={40} max={220} value={heightV} onChange={e => updateStyle(node.id, { imageHeight: parseInt(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: 10.5 }}>{t('inspector.scaleLabel')}</label>
              <div className="type-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button className={mode === 'cover' ? 'active' : ''} onClick={() => updateStyle(node.id, { imageMode: 'cover' })}>{t('inspector.fillMode')}</button>
                <button className={mode === 'contain' ? 'active' : ''} onClick={() => updateStyle(node.id, { imageMode: 'contain' })}>{t('inspector.containMode')}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ThemeControls() {
  const t = useT();
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
    if (!f.type.startsWith('image/')) { alert(t('common.onlyImageFiles')); return; }
    if (f.size > 3 * 1024 * 1024) { alert(t('common.max3mb')); return; }
    const r = new FileReader();
    r.onload = () => updateMeta({ logoUrl: r.result as string });
    r.readAsDataURL(f);
  };

  return (
    <>
      <div className="field">
        <label>{t('inspector.orgNameLabel')}</label>
        <DebouncedText
          value={meta.orgName}
          onCommit={(v) => updateMeta({ orgName: v })}
        />
      </div>
      <div className="field">
        <label>{t('inspector.schemaTitleLabel')}</label>
        <DebouncedText
          value={meta.title}
          onCommit={(v) => updateMeta({ title: v })}
        />
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>{t('inspector.exportLogoLabel')}</label>
        <div className="image-preview" style={{ height: 82 }}>
          {showLogo && logoUrl
            ? <img src={logoUrl} alt="" style={{ objectFit: 'contain' }} />
            : <span style={{ fontSize: 12 }}>{t('inspector.logoHidden')}</span>}
        </div>
        <div className="btn-row">
          <button onClick={() => fileRef.current?.click()}>{t('common.change')}</button>
          <button onClick={() => updateMeta({ logoUrl: './logo.png' })}>{t('common.default')}</button>
          <button onClick={() => updateMeta({ showLogo: !showLogo })}>
            {showLogo ? t('common.hide') : t('common.show')}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) onPickLogo(f); e.currentTarget.value = ''; }} />
        </div>
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
                  onClick={() => updateMeta({ logoCorner: c })}
                >
                  <span className={`corner-icon corner-${c}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t('inspector.logoWidthLabel', { pct: Math.round(logoWidthPct * 100) })}</label>
            <input type="range" min={5} max={30} value={Math.round(logoWidthPct * 100)}
              onInput={e => updateMeta({ logoWidthPct: parseInt((e.target as HTMLInputElement).value) / 100 }, false)}
              onChange={e => updateMeta({ logoWidthPct: parseInt((e.target as HTMLInputElement).value) / 100 }, true)} />
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>{t('inspector.primaryColor')}</label>
        <DebouncedColor
          value={theme.primary}
          onLive={(v) => updateTheme({ primary: v }, false)}
          onCommit={(v) => updateTheme({ primary: v }, true)}
        />
      </div>
      <div className="field">
        <label>{t('inspector.accentColor')}</label>
        <DebouncedColor
          value={theme.accent}
          onLive={(v) => updateTheme({ accent: v }, false)}
          onCommit={(v) => updateTheme({ accent: v }, true)}
        />
      </div>
      <div className="field">
        <label>{t('inspector.canvasBgColor')}</label>
        <DebouncedColor
          value={theme.canvasBg}
          onLive={(v) => updateTheme({ canvasBg: v }, false)}
          onCommit={(v) => updateTheme({ canvasBg: v }, true)}
        />
      </div>
      <div className="field">
        <label>{t('inspector.linkColor')}</label>
        <DebouncedColor
          value={theme.linkColor}
          onLive={(v) => updateTheme({ linkColor: v }, false)}
          onCommit={(v) => updateTheme({ linkColor: v }, true)}
        />
      </div>
    </>
  );
}

function cornerLabel(c: 'tl' | 'tr' | 'bl' | 'br', t: ReturnType<typeof useT>) {
  return c === 'tl' ? t('corner.topLeft') : c === 'tr' ? t('corner.topRight') : c === 'bl' ? t('corner.bottomLeft') : t('corner.bottomRight');
}
