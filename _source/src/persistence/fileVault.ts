import type { VaultDoc } from '../types/org';
import { encryptToBlob, decryptBlob } from '../crypto/vault';
import { normalizeVault } from './vaultMigration';

// Backup file extension (`.rigitree` legacy) — kept for backwards compatibility
// with existing exported backups.
export async function exportEncryptedFile(doc: VaultDoc, password: string): Promise<Blob> {
  const b64 = await encryptToBlob(doc, password);
  return new Blob([b64], { type: 'application/octet-stream' });
}

/** Decrypts the backup and normalizes it — an old backup may still be a bare
 * `OrgDoc` (`schemaVersion: 1`), which `normalizeVault` wraps as a one-tab
 * `VaultDoc`. */
export async function importEncryptedFile(file: File, password: string): Promise<VaultDoc> {
  const text = await file.text();
  const parsed = await decryptBlob<unknown>(text.trim(), password);
  return normalizeVault(parsed);
}

export function downloadAs(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
