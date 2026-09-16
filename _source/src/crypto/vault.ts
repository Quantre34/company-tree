// AES-256-GCM + PBKDF2(SHA-256, 250k) vault for CompanyTree.
// File / localStorage layout (base64-encoded):
//   RIGITREE1 | salt(16) | iv(12) | ciphertext

const MAGIC = new TextEncoder().encode('RIGITREE1');
const PBKDF2_ITER = 250_000;
const SALT_LEN = 16;
const IV_LEN = 12;

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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(password);
  const base = await crypto.subtle.importKey(
    'raw', enc as unknown as BufferSource, { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptToBlob(plaintextObj: unknown, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const data = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, data as unknown as BufferSource
  ));
  const blob = new Uint8Array(MAGIC.length + salt.length + iv.length + ct.length);
  blob.set(MAGIC, 0);
  blob.set(salt, MAGIC.length);
  blob.set(iv, MAGIC.length + salt.length);
  blob.set(ct, MAGIC.length + salt.length + iv.length);
  return b64encode(blob);
}

export async function decryptBlob<T = unknown>(b64: string, password: string): Promise<T> {
  const bytes = b64decode(b64);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('Bilinmeyen kasa formatı.');
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = bytes.slice(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const ct = bytes.slice(MAGIC.length + SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource
    );
  } catch {
    throw new Error('Parola hatalı.');
  }
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text) as T;
}

export function isSecureContextOk(): boolean {
  return typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost');
}

export function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}
