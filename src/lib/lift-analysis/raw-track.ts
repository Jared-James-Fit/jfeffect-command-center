/**
 * The followed track kept on a read, packed (pure, tested): every frame's
 * plate centre, size and how much of its rim showed, so the read can be done
 * again on any device without decoding the video or following the plate
 * again (the athlete's "Not a rep": the reps and the set re-read in an
 * instant, to the same numbers). 30 bytes a frame: a 25 s clip at 30 fps is
 * ~30 KB.
 *
 * Layout per frame, little-endian: t (Float64, s), x, y, r, a, b (Int32,
 * thousandths of an analysed px, so a re-read gives the same speeds and the
 * same scale; the smallest Int32 = not measured), conf (Uint16, 0…10000 =
 * 0…1; 65535 = the plate wasn't followed in that frame).
 */
import type { TrackPoint } from "@/lib/lift-analysis/track";

const BYTES = 8 + 5 * 4 + 2;
const NONE32 = -2147483648;
const LOST = 65535;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const i32 = (v: number) =>
  Number.isFinite(v) ? Math.max(-2147483647, Math.min(2147483647, Math.round(v * 1000))) : NONE32;
const f32 = (v: number) => (v === NONE32 ? NaN : v / 1000);

export function packTrack(points: TrackPoint[]): string {
  const buf = new ArrayBuffer(points.length * BYTES);
  const dv = new DataView(buf);
  points.forEach((p, i) => {
    const o = i * BYTES;
    dv.setFloat64(o, p.t, true);
    dv.setInt32(o + 8, i32(p.found ? p.x : NaN), true);
    dv.setInt32(o + 12, i32(p.found ? p.y : NaN), true);
    dv.setInt32(o + 16, i32(p.r), true);
    dv.setInt32(o + 20, i32(p.a), true);
    dv.setInt32(o + 24, i32(p.b), true);
    dv.setUint16(
      o + 28,
      p.found ? Math.max(0, Math.min(10000, Math.round((p.conf || 0) * 10000))) : LOST,
      true,
    );
  });
  return toBase64(new Uint8Array(buf));
}

export function unpackTrack(b64: string): TrackPoint[] {
  const bytes = fromBase64(b64);
  const n = Math.floor(bytes.length / BYTES);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: TrackPoint[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * BYTES;
    const c = dv.getUint16(o + 28, true);
    const found = c !== LOST;
    out.push({
      t: dv.getFloat64(o, true),
      x: f32(dv.getInt32(o + 8, true)),
      y: f32(dv.getInt32(o + 12, true)),
      r: f32(dv.getInt32(o + 16, true)),
      a: f32(dv.getInt32(o + 20, true)),
      b: f32(dv.getInt32(o + 24, true)),
      conf: found ? c / 10000 : 0,
      found,
    });
  }
  return out;
}
