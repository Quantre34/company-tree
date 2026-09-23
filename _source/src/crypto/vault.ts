// AES-256-GCM + PBKDF2(SHA-256, 250k) vault for CompanyTree.
// File / localStorage layout (base64-encoded):
//   RIGITREE1 | salt(16) | iv(12) | ciphertext

import { translate as t } from '../i18n/langStore';

const MAGIC = new TextEncoder().encode('RIGITREE1');
const PBKDF2_ITER = 250_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const WRITE_PROOF_INFO = new TextEncoder().encode('companytree-writeproof-v1');

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string): Uint8Array {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A single expensive PBKDF2 pass (250k iterations) produces 256 raw bits.
 * Everything downstream — the AES-GCM key AND the write-proof digest — is
 * derived from those SAME bits via cheap, non-iterated steps, so neither
 * unlocking nor saving ever pays for a second PBKDF2 pass in the same
 * operation. `deriveBits` + `importKey('raw', ...)` is byte-for-byte
 * equivalent to the old direct `deriveKey` call (verified empirically),
 * so this is fully compatible with every blob ever written by this app.
 */
async function deriveMasterBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder().encode(password);
  const base = await crypto.subtle.importKey(
    'raw', enc as unknown as BufferSource, { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    256,
  );
}

/**
 * The keys/proof for one "session" of vault access, all derived from one
 * PBKDF2 pass over `salt`. `salt` is whatever the CURRENT stored blob was
 * last written with — it only changes on a deliberate password change, not
 * on every ordinary save — which is what makes `writeProof` stable across
 * a session's autosaves instead of a new value every time.
 */
export interface VaultSession {
  aesKey: CryptoKey;
  salt: Uint8Array;
  /** Stable hex digest proving knowledge of the password without ever
   * revealing it. Sent as the X-Write-Proof header on every PUT; the
   * server just compares it byte-for-byte to what it has on file. */
  writeProof: string;
}

export async function deriveSession(password: string, salt: Uint8Array): Promise<VaultSession> {
  const bits = await deriveMasterBits(password, salt);
  const aesKey = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const hmacKey = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, WRITE_PROOF_INFO as unknown as BufferSource));
  return { aesKey, salt, writeProof: toHex(sig) };
}

/** Encrypt with an already-derived session — no PBKDF2 involved, just a
 * fresh IV (required per AES-GCM call) and an AES-GCM encrypt. This is
 * what every ordinary autosave should use once a session exists. */
export async function encryptWithSession(plaintextObj: unknown, session: VaultSession): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const data = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource }, session.aesKey, data as unknown as BufferSource
  ));
  const blob = new Uint8Array(MAGIC.length + session.salt.length + iv.length + ct.length);
  blob.set(MAGIC, 0);
  blob.set(session.salt, MAGIC.length);
  blob.set(iv, MAGIC.length + session.salt.length);
  blob.set(ct, MAGIC.length + session.salt.length + iv.length);
  return b64encode(blob);
}

/** Vault creation, or a deliberate password change: generates a FRESH
 * random salt (the new stable baseline going forward) and encrypts with
 * it. Returns the session so the caller can cache it for later saves. */
export async function createSession(password: string): Promise<VaultSession> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  return deriveSession(password, salt);
}

/** Decrypt an existing blob and derive the session (AES key + write-proof)
 * from the SAME salt it was written with, so the caller can cache that
 * session and reuse it for subsequent saves without re-deriving. */
export async function decryptBlobWithSession<T = unknown>(
  b64: string, password: string,
): Promise<{ doc: T; session: VaultSession }> {
  const bytes = b64decode(b64);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error(t('error.unknownVaultFormat'));
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = bytes.slice(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const ct = bytes.slice(MAGIC.length + SALT_LEN + IV_LEN);
  const session = await deriveSession(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource }, session.aesKey, ct as unknown as BufferSource
    );
  } catch {
    throw new Error(t('error.wrongPassword'));
  }
  const text = new TextDecoder().decode(plain);
  return { doc: JSON.parse(text) as T, session };
}

/** One-off encrypt/decrypt with a fresh random salt each call — for local
 * uses that have nothing to do with the server vault's stable-session
 * write-proof (the .rigitree backup file export/import, and decrypting an
 * already-known-password remote update during sync polling). Not used for
 * anything that gets PUT to the server. */
export async function encryptToBlob(plaintextObj: unknown, password: string): Promise<string> {
  const session = await createSession(password);
  return encryptWithSession(plaintextObj, session);
}

export async function decryptBlob<T = unknown>(b64: string, password: string): Promise<T> {
  const { doc } = await decryptBlobWithSession<T>(b64, password);
  return doc;
}

export function isSecureContextOk(): boolean {
  return typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost');
}

export function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}
