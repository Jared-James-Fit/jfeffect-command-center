import type { Framing } from "@/lib/photo-frame";
import type { MediaGrade } from "@/lib/media-grade";

/**
 * What a slide's upload is made from (its framing and turn, filter, cover,
 * trim, sound and the post's shape): a change to any of it makes the slide
 * again when the post goes; posting again (a retry) with none of it changed
 * makes nothing twice. Pure, tested in media-capture.test.ts.
 */
export function bakeKey(
  it: {
    kind: "image" | "video";
    framing?: Framing | null;
    grade?: MediaGrade | null;
    cover?: Blob | null;
    trim?: { start: number; end: number } | null;
    muted?: boolean;
  },
  shape: number | null,
): string {
  const f = it.framing;
  const r = (n: number | undefined) => (n == null ? null : Math.round(n * 10000) / 10000);
  return JSON.stringify({
    k: it.kind,
    s: shape == null ? null : r(shape),
    f: f ? [r(f.z), r(f.cx), r(f.cy), r(f.r)] : null,
    g: it.grade ?? null,
    c: it.cover ? it.cover.size : null,
    t: it.trim ? [r(it.trim.start), r(it.trim.end)] : null,
    m: !!it.muted,
  });
}
