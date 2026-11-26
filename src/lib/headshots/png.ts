/**
 * A small PNG reader for the server's own look at a headshot's evidence frames
 * (the app sends them as one PNG strip made by the browser's canvas). Non-
 * interlaced, 8-bit grey, grey + alpha, RGB or RGBA: what a canvas writes.
 * Inflate is fflate's (already a dependency); nothing new is added. Pure.
 */
import { unzlibSync } from "fflate";

export type DecodedImage = { width: number; height: number; channels: 1 | 2 | 3 | 4; data: Uint8Array };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Never inflate something bigger than a few evidence strips could be. */
const MAX_PIXELS = 4_000_000;

function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG, or throw a short reason. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 33 || !SIGNATURE.every((v, i) => bytes[i] === v)) throw new Error("not_png");
  let o = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let idatLen = 0;
  while (o + 8 <= bytes.length) {
    const len = readU32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const start = o + 8;
    if (start + len > bytes.length) throw new Error("truncated");
    if (type === "IHDR") {
      width = readU32(bytes, start);
      height = readU32(bytes, start + 4);
      bitDepth = bytes[start + 8]!;
      colorType = bytes[start + 9]!;
      interlace = bytes[start + 12]!;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, start + len));
      idatLen += len;
    } else if (type === "IEND") {
      break;
    }
    o = start + len + 4; // + CRC
  }
  if (!width || !height || width * height > MAX_PIXELS) throw new Error("bad_size");
  if (bitDepth !== 8) throw new Error("bit_depth");
  if (interlace !== 0) throw new Error("interlaced");
  const channels = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, 1 | 2 | 3 | 4>)[colorType];
  if (!channels) throw new Error("color_type");
  const z = new Uint8Array(idatLen);
  let p = 0;
  for (const part of idat) {
    z.set(part, p);
    p += part.length;
  }
  const raw = unzlibSync(z);
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("short_data");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x]!;
      const a = x >= channels ? out[dst + x - channels]! : 0;
      const b = y > 0 ? out[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = r; break;
        case 1: v = r + a; break;
        case 2: v = r + b; break;
        case 3: v = r + ((a + b) >> 1); break;
        case 4: v = r + paeth(a, b, c); break;
        default: throw new Error("filter");
      }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

/** Luminance (0–255, Rec. 601) of a decoded image, one byte a pixel. */
export function toGray(img: DecodedImage): Uint8Array {
  const n = img.width * img.height;
  const g = new Uint8Array(n);
  const ch = img.channels;
  for (let i = 0; i < n; i++) {
    const s = i * ch;
    g[i] = ch >= 3 ? Math.round(0.299 * img.data[s]! + 0.587 * img.data[s + 1]! + 0.114 * img.data[s + 2]!) : img.data[s]!;
  }
  return g;
}

/** A JPEG's size from its frame header, and whether it carries camera (EXIF) data. Pure, no decoding. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; exif: boolean } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let o = 2;
  let exif = false;
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff) return null;
    const marker = bytes[o + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (bytes[o + 2]! << 8) | bytes[o + 3]!;
    if (len < 2) return null;
    if (marker === 0xe1 && o + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(o + 4, o + 8)) === "Exif") exif = true;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && o + 9 <= bytes.length) {
      const height = (bytes[o + 5]! << 8) | bytes[o + 6]!;
      const width = (bytes[o + 7]! << 8) | bytes[o + 8]!;
      return { width, height, exif };
    }
    o += 2 + len;
  }
  return null;
}
