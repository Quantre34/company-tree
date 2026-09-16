/**
 * Runtime font loader for jsPDF.
 *
 * Standard PDF fonts (Helvetica/Times/Courier) use WinAnsi codepage, which does NOT
 * include Turkish characters (ş, ğ, ı, İ, ç, etc.). Fetching Roboto TTF at export time
 * and registering it with jsPDF gives us a Unicode font without bloating the main bundle.
 */
let cached: { regular: string; bold: string } | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export async function loadPdfFonts(): Promise<{ regular: string; bold: string }> {
  if (cached) return cached;
  const base = new URL('./fonts/', document.baseURI);
  const [reg, bold] = await Promise.all([
    fetch(new URL('Roboto-Regular.ttf', base).toString()).then(r => {
      if (!r.ok) throw new Error('Roboto-Regular.ttf yüklenemedi');
      return r.arrayBuffer();
    }),
    fetch(new URL('Roboto-Bold.ttf', base).toString()).then(r => {
      if (!r.ok) throw new Error('Roboto-Bold.ttf yüklenemedi');
      return r.arrayBuffer();
    }),
  ]);
  cached = {
    regular: arrayBufferToBase64(reg),
    bold: arrayBufferToBase64(bold),
  };
  return cached;
}
