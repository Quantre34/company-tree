import { useRef, useState } from 'react';
import { useT, useLang, useLangStore, dateLocale } from '../i18n/langStore';

type Mode = 'create' | 'unlock';

export interface OnboardingData {
  password: string;
  orgName?: string;
  logoDataUrl?: string;
}

interface Props {
  mode: Mode;
  onSubmit: (data: OnboardingData) => Promise<void>;
  onSkip?: () => void;    // "skip vault" — use in-memory / plain storage
  meta?: { updatedAt?: string };
}

export function LockScreen({ mode, onSubmit, onSkip, meta }: Props) {
  const t = useT();
  const lang = useLang();
  const setLang = useLangStore(s => s.setLang);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [orgName, setOrgName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setError(null);
    if (mode === 'create') {
      if (!orgName.trim()) { setError(t('lockscreen.enterOrgName')); return; }
      if (pass.length < 12) { setError(t('lockscreen.passwordMinLength')); return; }
      if (pass !== pass2) { setError(t('lockscreen.passwordMismatch')); return; }
    } else {
      if (!pass) { setError(t('lockscreen.enterPassword')); return; }
    }
    setBusy(true);
    try {
      await onSubmit({ password: pass, orgName: orgName.trim() || undefined, logoDataUrl });
    } catch (e: any) {
      setError(e?.message ?? t('common.genericError'));
      setBusy(false);
    }
  };

  const onPickLogo = (f: File) => {
    if (!f.type.startsWith('image/')) { setError(t('common.onlyImageFiles')); return; }
    if (f.size > 3 * 1024 * 1024) { setError(t('common.max3mb')); return; }
    const r = new FileReader();
    r.onload = () => setLogoDataUrl(r.result as string);
    r.readAsDataURL(f);
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-lang-toggle" role="group" aria-label={t('topbar.langToggleLabel')}>
          <button type="button" className={lang === 'tr' ? 'active' : ''} onClick={() => setLang('tr')} aria-pressed={lang === 'tr'}>TR</button>
          <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>EN</button>
        </div>
        <div className="brand-badge">CompanyTree</div>
        <div className="subtitle">{t('lockscreen.subtitle')}</div>
        <h2 style={{ margin: '6px 0 14px', fontSize: 16 }}>
          {mode === 'create' ? t('lockscreen.setupTitle') : t('lockscreen.unlockTitle')}
        </h2>

        {mode === 'create' && (
          <>
            <div style={{ textAlign: 'left', marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase',
                letterSpacing: 0.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                {t('lockscreen.orgNameLabel')}
              </label>
              <input
                type="text"
                placeholder={t('lockscreen.orgNamePlaceholder')}
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                autoFocus
              />
            </div>

            <div style={{ textAlign: 'left', marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase',
                letterSpacing: 0.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                {t('lockscreen.logoOptionalLabel')}
              </label>
              <div style={{
                border: '1px dashed #CBD1DA', borderRadius: 10, height: 68,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#F9FAFB', marginBottom: 6, overflow: 'hidden',
              }}>
                {logoDataUrl
                  ? <img src={logoDataUrl} alt="" style={{ maxHeight: '100%', maxWidth: '100%' }} />
                  : <span style={{ fontSize: 12, color: '#9CA3AF' }}>{t('lockscreen.logoNotAdded')}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}>
                  {logoDataUrl ? t('common.change') : t('common.upload')}
                </button>
                {logoDataUrl && (
                  <button type="button" onClick={() => setLogoDataUrl(undefined)}
                    style={{ padding: '6px 10px', fontSize: 12 }}>
                    {t('common.remove')}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) onPickLogo(f); e.currentTarget.value = ''; }} />
              </div>
            </div>
          </>
        )}

        <input
          type="password" placeholder={t('common.passwordPlaceholder')} value={pass}
          onChange={e => setPass(e.target.value)}
          autoFocus={mode === 'unlock'}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        {mode === 'create' && (
          <div style={{ marginTop: 8 }}>
            <input
              type="password" placeholder={t('lockscreen.passwordRepeatPlaceholder')} value={pass2}
              onChange={e => setPass2(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="primary" onClick={submit} disabled={busy}>
            {mode === 'create' ? t('lockscreen.createVault') : t('common.open')}
          </button>
          {onSkip && mode === 'create' && (
            <button onClick={onSkip} disabled={busy}>{t('lockscreen.continueWithoutPassword')}</button>
          )}
        </div>
        {mode === 'create' ? (
          <div className="warn">
            {t('lockscreen.warnCreate1')} <b>{t('lockscreen.warnCreate1b')}</b><br/>
            {t('lockscreen.warnCreate2')}
          </div>
        ) : (
          <div className="warn">
            {meta?.updatedAt && <>{t('lockscreen.lastUpdated', { date: new Date(meta.updatedAt).toLocaleString(dateLocale(lang)) })}<br/></>}
            {t('lockscreen.autoLockNote')}
          </div>
        )}
      </div>
    </div>
  );
}
