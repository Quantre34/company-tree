import { useState } from 'react';
import { useT } from '../i18n/langStore';
import { verifyAdminCode } from '../persistence/adminAuth';

interface Props {
  onClose: () => void;
  /** Called once a valid 2FA code has produced an admin token AND a new
   * password has been entered twice matching. The caller performs the
   * actual server write (it needs the current doc/version). */
  onChangePassword: (newPassword: string, adminToken: string) => Promise<void>;
}

/**
 * Admin-only "change the company password" flow. Step 1 verifies a 2FA
 * (TOTP) code against the server, which mints a short-lived, single-use
 * admin token. Step 2 collects the new password and performs the change.
 *
 * This is NOT gated by any secret URL or hidden route — the source is
 * public, so a hidden path is not real security. The actual boundary is
 * the 2FA code: without it, the server rejects the write outright
 * regardless of how this panel is reached.
 */
export function AdminPasswordPanel({ onClose, onChangePassword }: Props) {
  const t = useT();
  const [step, setStep] = useState<'code' | 'password'>('code');
  const [code, setCode] = useState('');
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError(t('admin.invalidCode')); return; }
    setBusy(true);
    try {
      const token = await verifyAdminCode(code);
      setAdminToken(token);
      setStep('password');
    } catch (e: any) {
      setError(e?.message ?? t('admin.invalidCode'));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setError(null);
    if (pass.length < 12) { setError(t('lockscreen.passwordMinLength')); return; }
    if (pass !== pass2) { setError(t('lockscreen.passwordMismatch')); return; }
    if (!adminToken) { setError(t('admin.invalidCode')); setStep('code'); return; }
    setBusy(true);
    try {
      await onChangePassword(pass, adminToken);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('common.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>{t('admin.changePasswordTitle')}</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          {step === 'code' ? t('admin.step2FA') : t('admin.stepNewPassword')} (2/2)
        </p>

        {step === 'code' ? (
          <>
            <label style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase',
              letterSpacing: 0.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
              {t('admin.enterCode')}
            </label>
            <input
              type="text" inputMode="numeric" pattern="\d{6}" maxLength={6}
              placeholder={t('admin.codePlaceholder')}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => { if (e.key === 'Enter') submitCode(); }}
              autoFocus
              style={{ letterSpacing: 6, textAlign: 'center', fontSize: 20 }}
            />
          </>
        ) : (
          <>
            <input
              type="password" placeholder={t('admin.newPasswordPlaceholder')} value={pass}
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPassword(); }}
              autoFocus
            />
            <div style={{ marginTop: 8 }}>
              <input
                type="password" placeholder={t('admin.newPasswordRepeatPlaceholder')} value={pass2}
                onChange={e => setPass2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitPassword(); }}
              />
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}

        <div className="actions">
          <button onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={step === 'code' ? submitCode : submitPassword}
            disabled={busy}
          >
            {busy
              ? (step === 'code' ? t('admin.verifying') : t('admin.changing'))
              : (step === 'code' ? t('admin.verify') : t('admin.changePassword'))}
          </button>
        </div>
      </div>
    </div>
  );
}
