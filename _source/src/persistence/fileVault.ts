import type { OrgDoc } from '../types/org';
import { encryptToBlob, decryptBlob } from '../crypto/vault';

// Backup file extension (`.rigitree` legacy) — kept for backwards compatibility
// with existing exported backups.
export async function exportEncryptedFile(doc: OrgDoc, password: string): Promise<Blob> {
  const b64 = await encryptToBlob(doc, password);
  return new Blob([b64], { type: 'application/octet-stream' });
}

export async function importEncryptedFile(file: File, password: string): Promise<OrgDoc> {
  const text = await file.text();
  return await decryptBlob<OrgDoc>(text.trim(), password);
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
