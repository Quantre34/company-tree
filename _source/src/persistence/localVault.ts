import type { OrgDoc } from '../types/org';
import { encryptToBlob, decryptBlob } from '../crypto/vault';

const KEY = 'rigicontree.vault.v1';
const META_KEY = 'rigicontree.vault.meta.v1';

export interface VaultMeta {
  createdAt: string;
  updatedAt: string;
}

export function hasVault(): boolean {
  return typeof localStorage !== 'undefined' && !!localStorage.getItem(KEY);
}

export function readMeta(): VaultMeta | null {
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as VaultMeta; } catch { return null; }
}

export async function saveVault(doc: OrgDoc, password: string): Promise<void> {
  const blob = await encryptToBlob(doc, password);
  localStorage.setItem(KEY, blob);
  const now = new Date().toISOString();
  const meta = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({
    createdAt: meta?.createdAt ?? now, updatedAt: now,
  }));
}

export async function loadVault(password: string): Promise<OrgDoc> {
  const blob = localStorage.getItem(KEY);
  if (!blob) throw new Error('Kasa bulunamadı.');
  return await decryptBlob<OrgDoc>(blob, password);
}

export function clearVault(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(META_KEY);
}

export function rawBlob(): string | null {
  return localStorage.getItem(KEY);
}
