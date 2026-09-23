/**
 * 2FA (TOTP) verification for admin-only operations — currently just
 * "change the company password" (see App.tsx's admin panel). Verifying a
 * correct 6-digit code mints a short-lived, single-use token the server
 * will accept once as X-Admin-Token on a PUT whose write-proof changes.
 */
import { translate as t } from '../i18n/langStore';

const ENDPOINT = './api/totp.php';

export async function verifyAdminCode(code: string): Promise<string> {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('Retry-After') ?? '', 10);
    const msg = Number.isFinite(retryAfter) && retryAfter > 0
      ? t('error.rateLimitedWithSeconds', { seconds: retryAfter })
      : t('error.rateLimitedGeneric');
    const err = new Error(msg);
    (err as any).code = 'RATE_LIMITED';
    throw err;
  }
  if (r.status === 503) {
    const err = new Error(t('admin.notConfigured'));
    (err as any).code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!r.ok) {
    const err = new Error(t('admin.invalidCode'));
    (err as any).code = 'INVALID_CODE';
    throw err;
  }
  const data = await r.json();
  return data.adminToken as string;
}
