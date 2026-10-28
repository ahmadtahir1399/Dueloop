// Validate an uploaded proof BEFORE it is stored or sent anywhere (issue M, step 13c). Pure: bytes in, verdict
// out. The declared MIME type and file name are never trusted; the magic bytes decide. Images are measured from
// their headers only (no decode), so an extreme size is rejected before anything could inflate it.

export type ProofMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export type SniffResult =
  | { readonly ok: true; readonly mime: ProofMime; readonly width: number | null; readonly height: number | null }
  | { readonly ok: false; readonly reason: string };

export const PROOF_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // also the bucket's file_size_limit
  minBytes: 32,
  maxSide: 10_000,
  maxPixels: 40_000_000,
  /** Bytes allowed after an image's end marker (some encoders pad). More = a polyglot or appended payload. */
  maxTrailing: 64,
} as const;

const no = (reason: string): SniffResult => ({ ok: false, reason });
const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, Math.min(to, b.length)).toString('latin1');

// Markers of other formats or active content that must never ride along inside a "screenshot".
const FORBIDDEN = [/<script/i, /<html/i, /<svg/i, /<\?php/i, /<!doctype/i];
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // an archive appended to (or posing as) an image
const PDF_ACTIVE = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/OpenAction\b/, /\/AA\b/, /\/XFA\b/];

function dims(width: number, height: number): string | null {
  if (width < 1 || height < 1) return 'image_dimensions_invalid';
  if (width > PROOF_LIMITS.maxSide || height > PROOF_LIMITS.maxSide || width * height > PROOF_LIMITS.maxPixels) return 'image_too_large';
  return null;
}

function png(b: Buffer): SniffResult {
  if (ascii(b, 12, 16) !== 'IHDR') return no('png_malformed');
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const bad = dims(w, h);
  if (bad) return no(bad);
  // Walk the chunks to IEND: a truncated file or bytes after IEND are rejected.
  let p = 8;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = ascii(b, p + 4, p + 8);
    const next = p + 12 + len;
    if (len > b.length || next > b.length) return no('truncated');
    if (type === 'IEND') return b.length - next > PROOF_LIMITS.maxTrailing ? no('trailing_data') : { ok: true, mime: 'image/png', width: w, height: h };
    p = next;
  }
  return no('truncated');
}

function jpeg(b: Buffer): SniffResult {
  // Find a SOF marker for the dimensions; stop at SOS (entropy-coded data follows).
  let p = 2;
  let w = 0;
  let h = 0;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return no('jpeg_malformed');
    const m = b[p + 1] ?? 0;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) {
      p += m === 0xff ? 1 : 2;
      continue;
    }
    const len = b.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > b.length) return no('truncated');
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 7) return no('jpeg_malformed');
      h = b.readUInt16BE(p + 5);
      w = b.readUInt16BE(p + 7);
    }
    if (m === 0xda) break;
    p += 2 + len;
  }
  if (!w || !h) return no('jpeg_malformed');
  const bad = dims(w, h);
  if (bad) return no(bad);
  // The last EOI must be at (or within a few padding bytes of) the end.
  const eoi = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (eoi < p) return no('truncated');
  if (b.length - (eoi + 2) > PROOF_LIMITS.maxTrailing) return no('trailing_data');
  return { ok: true, mime: 'image/jpeg', width: w, height: h };
}

function webp(b: Buffer): SniffResult {
  if (b.readUInt32LE(4) + 8 !== b.length) return no(b.readUInt32LE(4) + 8 > b.length ? 'truncated' : 'trailing_data');
  const chunk = ascii(b, 12, 16);
  let w: number;
  let h: number;
  if (chunk === 'VP8 ' && b.length >= 30) {
    if (!startsWith(b, [0x9d, 0x01, 0x2a], 23)) return no('webp_malformed');
    w = b.readUInt16LE(26) & 0x3fff;
    h = b.readUInt16LE(28) & 0x3fff;
  } else if (chunk === 'VP8L' && b.length >= 25) {
    if (b[20] !== 0x2f) return no('webp_malformed');
    const bits = b.readUInt32LE(21);
    w = (bits & 0x3fff) + 1;
    h = ((bits >> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X' && b.length >= 30) {
    w = (b.readUIntLE(24, 3) & 0xffffff) + 1;
    h = (b.readUIntLE(27, 3) & 0xffffff) + 1;
  } else return no('webp_malformed');
  const bad = dims(w, h);
  return bad ? no(bad) : { ok: true, mime: 'image/webp', width: w, height: h };
}

function pdf(b: Buffer): SniffResult {
  const tail = ascii(b, Math.max(0, b.length - 1024), b.length);
  if (!/%%EOF\s*$/.test(tail)) return no('truncated');
  const text = b.toString('latin1');
  if (PDF_ACTIVE.some((r) => r.test(text))) return no('pdf_active_content');
  return { ok: true, mime: 'application/pdf', width: null, height: null };
}

export function sniffProof(b: Buffer): SniffResult {
  if (b.length > PROOF_LIMITS.maxBytes) return no('too_large');
  if (b.length < PROOF_LIMITS.minBytes) return no('too_small');
  const head = ascii(b, 0, 4096);
  const tail = ascii(b, Math.max(0, b.length - 4096), b.length);
  if (FORBIDDEN.some((r) => r.test(head) || r.test(tail)) || b.includes(ZIP_LOCAL_HEADER)) return no('forbidden_content');
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png(b);
  if (startsWith(b, [0xff, 0xd8, 0xff])) return jpeg(b);
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return webp(b);
  if (ascii(b, 0, 5) === '%PDF-') return pdf(b);
  return no('unsupported_type'); // SVG, HTML, archives, GIF, HEIC, anything else
}

/** A display name that can never be a path: no directories, controls or odd characters; never used to store. */
export function sanitiseFileName(name: string | null): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.normalize('NFKC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').slice(0, 200).trim();
  return clean === '' ? null : clean;
}
