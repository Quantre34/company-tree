/**
 * Server-side encrypted vault client.
 *
 * The frontend encrypts the doc client-side (AES-256-GCM + PBKDF2 in
 * `crypto/vault.ts`) and PUTs the opaque base64 blob here. The server
 * never sees plaintext or the password — it only stores the blob.
 *
 * Concurrency: `If-Match: <version>` header on PUT; on 409 the client
 * must reload the latest blob to avoid overwriting a fresh save from
 * another device.
 *
 * Write authentication: every PUT also carries `X-Write-Proof`, a stable
 * digest (see crypto/vault.ts's VaultSession) proving knowledge of the
 * current password without revealing it. The server compares it to what
 * it has on file and rejects (403) anything that doesn't match — closing
 * an "anyone who finds this URL can overwrite the vault" hole that used
 * to exist because writes had no authentication at all. A write whose
 * proof legitimately differs (a deliberate password change) must also
 * carry a valid `X-Admin-Token`, minted by a 2FA check — see adminAuth.ts.
 */
import type { VaultDoc } from '../types/org';
import { createSession, decryptBlobWithSession, encryptWithSession, type VaultSession } from '../crypto/vault';
import { translate as t } from '../i18n/langStore';

const ENDPOINT = './api/tree.php';

export interface FetchedBlob { blob: string; version: string; }

/** Turns a non-ok Response into a localized Error. A 429 gets a specific
 * `RATE_LIMITED` code (and mentions Retry-After) so callers can tell
 * "server is throttling us" apart from "vault doesn't exist" or a real
 * failure — conflating them is what would let a throttled first-load get
 * misread as "no vault yet" and steer a user into re-creating the company. */
function httpErrorFor(r: Response, context: string): Error {
  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('Retry-After') ?? '', 10);
    const msg = Number.isFinite(retryAfter) && retryAfter > 0
      ? t('error.rateLimitedWithSeconds', { seconds: retryAfter })
      : t('error.rateLimitedGeneric');
    const err = new Error(msg);
    (err as any).code = 'RATE_LIMITED';
    return err;
  }
  return new Error(`${context} (${r.status})`);
}

export async function hasServerVault(): Promise<boolean> {
  const r = await fetch(ENDPOINT, { method: 'HEAD', cache: 'no-store' });
  if (r.status === 404) return false;
  if (r.ok) return true;
  // Any other status (429, 5xx, ...) is NOT "no vault" — it must surface as
  // an error so the caller lands in the fatal state, never the create flow.
  throw httpErrorFor(r, t('error.serverErrorContext'));
}

export async function fetchServerBlob(): Promise<FetchedBlob | null> {
  const r = await fetch(ENDPOINT, { method: 'GET', cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw httpErrorFor(r, t('error.serverErrorContext'));
  const version = r.headers.get('X-Vault-Version') ?? '';
  const blob = (await r.text()).trim();
  return { blob, version };
}

/** `doc` is whatever shape the stored blob happens to be — a legacy bare
 * `OrgDoc` or a `VaultDoc` — the caller must run it through
 * `normalizeVault()` before using it. */
export async function loadServerVault(
  password: string,
): Promise<{ doc: unknown; version: string; session: VaultSession }> {
  const got = await fetchServerBlob();
  if (!got) throw new Error(t('error.vaultNotFoundOnServer'));
  const { doc, session } = await decryptBlobWithSession<unknown>(got.blob, password);
  return { doc, version: got.version, session };
}

/** First-ever vault creation: no version to conflict with, no admin token
 * needed (there's nothing to protect yet — the incoming write-proof simply
 * becomes the new baseline). */
export async function createServerVault(
  doc: VaultDoc, password: string,
): Promise<{ version: string; session: VaultSession }> {
  const session = await createSession(password);
  const blob = await encryptWithSession(doc, session);
  const r = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Write-Proof': session.writeProof },
    body: blob,
  });
  if (!r.ok) throw httpErrorFor(r, t('error.saveErrorContext'));
  return { version: r.headers.get('X-Vault-Version') ?? '', session };
}

function writeProofRejectedError(): Error {
  const err = new Error(t('error.writeProofRejected'));
  (err as any).code = 'WRITE_PROOF_REJECTED';
  return err;
}

/**
 * Encrypt `doc` with an already-derived session and PUT the blob.
 * Pass `expectedVersion` = the version returned by the previous fetch/save.
 * On 409 (mismatch), reject with a specific error so the caller can
 * decide to refetch + retry after user acknowledgement. `adminToken` is
 * only needed when `session` was derived from a NEW password (i.e. this
 * call is itself the password-change write) — ordinary same-password
 * saves never need it.
 */
export async function saveServerVault(
  doc: VaultDoc,
  session: VaultSession,
  expectedVersion: string | null,
  adminToken?: string,
): Promise<string> {
  const blob = await encryptWithSession(doc, session);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Write-Proof': session.writeProof,
  };
  if (expectedVersion) headers['If-Match'] = expectedVersion;
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const r = await fetch(ENDPOINT, { method: 'PUT', headers, body: blob });
  if (r.status === 409) {
    const err = new Error(t('error.newerVersionOnServer'));
    (err as any).code = 'CONFLICT';
    throw err;
  }
  if (r.status === 403) throw writeProofRejectedError();
  if (!r.ok) throw httpErrorFor(r, t('error.saveErrorContext'));
  return r.headers.get('X-Vault-Version') ?? '';
}

/** Rotate the vault's password: derive a brand-new session (fresh salt) from
 * `newPassword`, re-encrypt the current doc with it, and PUT with the
 * freshly 2FA-minted `adminToken` — the only way the server accepts a
 * write whose write-proof differs from what's on file. */
export async function changeServerPassword(
  doc: VaultDoc,
  newPassword: string,
  expectedVersion: string,
  adminToken: string,
): Promise<{ version: string; session: VaultSession }> {
  const session = await createSession(newPassword);
  const version = await saveServerVault(doc, session, expectedVersion, adminToken);
  return { version, session };
}
