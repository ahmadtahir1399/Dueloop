// Tiny synthetic proof files built byte by byte (no real screenshots, no payer data).
import { crc32 } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function png(width = 4, height = 3, opts: { trailing?: Buffer; truncate?: number } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const b = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(20, 7)), chunk('IEND', Buffer.alloc(0)), opts.trailing ?? Buffer.alloc(0)]);
  return opts.truncate ? b.subarray(0, b.length - opts.truncate) : b;
}

export function jpeg(width = 640, height = 480, opts: { trailing?: Buffer } = {}): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0', 'latin1'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, sos, Buffer.alloc(64, 0x55), Buffer.from([0xff, 0xd9]), opts.trailing ?? Buffer.alloc(0)]);
}

export function webp(width = 100, height = 50): Buffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const payload = Buffer.alloc(20);
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits >>> 0, 1);
  const vp8l = Buffer.concat([Buffer.from('VP8L', 'latin1'), Buffer.from([payload.length, 0, 0, 0]), payload]);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8l]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]);
}

export function pdf(extra = ''): Buffer {
  return Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog ${extra} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
