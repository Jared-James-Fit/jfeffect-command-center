/**
 * Real footage for the lift analysis engine, decoded with ffmpeg the way the
 * phone decodes it (rotation applied, the shown shape, the working size, the
 * file's own frame times): for the validation harness, never the app.
 */
import { execFileSync } from "node:child_process";
import type { Frame } from "../../src/lib/lift-analysis/image";

export type Decoded = {
  frames: Frame[];
  w: number;
  h: number;
  fps: number;
  width: number;
  height: number;
};

export function probe(file: string): { width: number; height: number; times: number[] } {
  const raw = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:stream_side_data=rotation",
    "-of",
    "json",
    file,
  ]).toString();
  const s = JSON.parse(raw).streams[0];
  const rot =
    Math.abs(Number(s.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? 0)) % 180;
  const width = rot === 90 ? s.height : s.width;
  const height = rot === 90 ? s.width : s.height;
  const tl = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=best_effort_timestamp_time",
      "-of",
      "csv=p=0",
      file,
    ],
    { maxBuffer: 1 << 26 },
  ).toString();
  const times = tl
    .split("\n")
    .map((l) => Number(l.trim().replace(/,$/, "")))
    .filter((n) => Number.isFinite(n));
  return { width, height, times };
}

/** Every frame at `long` px on its long side, grey, with its time from the file. */
export function decode(
  file: string,
  long = 480,
  opts: { start?: number; end?: number } = {},
): Decoded {
  const p = probe(file);
  const L = Math.min(long, Math.max(p.width, p.height));
  const w = p.width >= p.height ? L : Math.max(16, Math.round((L * p.width) / p.height));
  const h = p.width >= p.height ? Math.max(16, Math.round((L * p.height) / p.width)) : L;
  const buf = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vsync",
      "passthrough",
      "-vf",
      `scale=${w}:${h}:flags=area,format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 2 ** 31 - 1 },
  );
  const n = Math.floor(buf.length / (w * h));
  const t0 = p.times[0] ?? 0;
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const t = (p.times[i] ?? t0 + i / 30) - t0;
    if (opts.start != null && t < opts.start) continue;
    if (opts.end != null && t > opts.end) continue;
    frames.push({ w, h, t, px: new Uint8Array(buf.buffer, buf.byteOffset + i * w * h, w * h) });
  }
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 1;
  return { frames, w, h, fps: (frames.length - 1) / span, width: p.width, height: p.height };
}
