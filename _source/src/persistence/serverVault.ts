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
 */
import type { OrgDoc } from '../types/org';
import { encryptToBlob, decryptBlob } from '../crypto/vault';

const ENDPOINT = './api/tree.php';

export interface FetchedBlob { blob: string; version: string; }

export async function hasServerVault(): Promise<boolean> {
  const r = await fetch(ENDPOINT, { method: 'HEAD', cache: 'no-store' });
  return r.ok;
}

export async function fetchServerBlob(): Promise<FetchedBlob | null> {
  const r = await fetch(ENDPOINT, { method: 'GET', cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Sunucu hatası (${r.status})`);
  const version = r.headers.get('X-Vault-Version') ?? '';
  const blob = (await r.text()).trim();
  return { blob, version };
}

export async function loadServerVault(password: string): Promise<{ doc: OrgDoc; version: string }> {
  const got = await fetchServerBlob();
  if (!got) throw new Error('Sunucuda kasa bulunamadı.');
  const doc = await decryptBlob<OrgDoc>(got.blob, password);
  return { doc, version: got.version };
}

/**
 * Encrypt `doc` with `password` and PUT the blob.
 * Pass `expectedVersion` = `null` for the very first save (create),
 * or the version returned by the previous fetch/save otherwise.
 * On 409 (mismatch), reject with a specific error so the caller can
 * decide to refetch + retry after user acknowledgement.
 */
export async function saveServerVault(
  doc: OrgDoc,
  password: string,
  expectedVersion: string | null,
): Promise<string> {
  const blob = await encryptToBlob(doc, password);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  if (expectedVersion) headers['If-Match'] = expectedVersion;
  const r = await fetch(ENDPOINT, { method: 'PUT', headers, body: blob });
  if (r.status === 409) {
    const err = new Error('Sunucu tarafında daha yeni bir sürüm var.');
    (err as any).code = 'CONFLICT';
    throw err;
  }
  if (!r.ok) throw new Error(`Kayıt hatası (${r.status})`);
  return r.headers.get('X-Vault-Version') ?? '';
}
