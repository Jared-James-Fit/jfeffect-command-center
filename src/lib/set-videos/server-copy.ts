/**
 * Set videos' 720p copies for Crew, made on a server (pure, tested). The
 * database queues a job for every clip that needs one
 * (set_video_needs_server_copy = needsServerCopy) and the feed-copies-tick
 * hook (server-copy.server.ts) runs it through a video service (Mux): it
 * hands Mux a short-lived link to the clip, waits for a 720p MP4, stores it
 * as the clip's feed copy and deletes it from Mux. Until the keys are set, or
 * when a job fails, the phone's own copy (uploader.ts, catch-up.ts) is the
 * fallback.
 */
import { FILM_CLIP_MAX_BYTES, FILM_CLIP_MAX_S } from "@/lib/workout-film";
import { MIN_BYTES_TO_COMPRESS } from "@/lib/video-edit/plan";
import { videoBudget } from "@/lib/video-edit/limits";

/** Tries at a clip before it's left to the phone. */
export const SERVER_COPY_TRIES = 3;
/** A clip Mux hasn't finished in this long is given up on (the phone takes over). */
export const SERVER_COPY_MAX_MS = 30 * 60_000;
/** While Mux works on it: how soon to look again. */
export const SERVER_COPY_POLL_MS = 15_000;
/** In one request, after handing a clip over: how long to wait for it before leaving it to the next tick. */
export const SERVER_COPY_WAIT_MS = 40_000;
/** No keys on the server yet: a waiting job is looked at again this often. */
export const SERVER_COPY_NO_KEYS_RETRY_MS = 60 * 60_000;
/** A clip younger than this is the server's: the phone makes no copy of it (once server copies are on). */
export const SERVER_COPY_GRACE_MS = 30 * 60_000;
/** The link Mux fetches the clip from lasts this long. */
export const SERVER_COPY_LINK_S = 2 * 60 * 60;

/** Heavier than a feed clip: a 4K or 1080p picture, or more than a Crew post's target bytes. */
const HEAVY_LONG_EDGE = 1300;

export type CopyCandidate = {
  set_index: number | null;
  deleted_at?: string | null;
  feed_path?: string | null;
  client_id: string;
  storage_path: string | null;
  duration_s: number | string | null;
  size_bytes: number | string | null;
  width?: number | null;
  height?: number | null;
};

/** The same rule as the database's set_video_needs_server_copy. */
export function needsServerCopy(v: CopyCandidate): boolean {
  if (v.deleted_at || v.feed_path || !(Number(v.set_index) > 0) || !v.storage_path) return false;
  const own = new RegExp(`^${v.client_id}/set-videos/[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*\\.(mp4|mov|webm)$`);
  if (!own.test(v.storage_path) || /-feed\.(mp4|mov|webm)$/.test(v.storage_path)) return false;
  const secs = Number(v.duration_s);
  if (!Number.isFinite(secs) || secs < 0.5 || secs > FILM_CLIP_MAX_S + 1.5) return false;
  const bytes = Number(v.size_bytes) || 0;
  if (bytes < MIN_BYTES_TO_COMPRESS) return false;
  const longEdge = Math.max(Number(v.width) || 0, Number(v.height) || 0);
  return longEdge > HEAVY_LONG_EDGE || bytes > videoBudget("workout").target;
}

/** `<client>/set-videos/<job>.<ext>` → `<client>/set-videos/<job>-feed.mp4`. */
export function serverCopyPath(storagePath: string): string | null {
  const m = /^(.+\/set-videos\/[A-Za-z0-9_-]+)\.(mp4|mov|webm)$/i.exec(storagePath);
  if (!m || /-feed$/.test(m[1])) return null;
  return `${m[1]}-feed.mp4`;
}

/**
 * What Mux is asked for: the clip from its link, a 720p MP4 of it, the
 * cheapest encoding (`basic`). `legacy` is Mux's older form (an MP4 of up to
 * 1080p), tried once when the newer one is refused.
 */
export function muxAssetBody(url: string, legacy = false): Record<string, unknown> {
  if (legacy) return { input: [{ url }], playback_policy: ["public"], mp4_support: "capped-1080p" };
  return {
    inputs: [{ url }],
    playback_policies: ["public"],
    video_quality: "basic",
    static_renditions: [{ resolution: "720p" }],
  };
}

type MuxFile = { name?: string; ext?: string; status?: string; resolution?: string; width?: number; height?: number; filesize?: string | number };
export type MuxAsset = {
  id?: string;
  status?: string;
  errors?: { type?: string; messages?: string[] } | null;
  playback_ids?: Array<{ id?: string; policy?: string }>;
  static_renditions?: { status?: string; files?: MuxFile[] } | null;
};

export type RenditionRead =
  | { state: "ready"; name: string }
  | { state: "waiting" }
  | { state: "failed"; reason: string };

const RANK = ["720p", "capped-1080p", "1080p", "540p", "medium", "high", "highest"];

/** Whether Mux has the MP4 ready, read from either form of its answer. */
export function readRendition(asset: MuxAsset | null | undefined): RenditionRead {
  if (!asset) return { state: "waiting" };
  if (asset.status === "errored") {
    const why = asset.errors?.messages?.join(" ") || asset.errors?.type || "errored";
    return { state: "failed", reason: `asset: ${why}`.slice(0, 200) };
  }
  const sr = asset.static_renditions ?? null;
  const files = (sr?.files ?? []).filter((f) => (f.name ?? "").toLowerCase().endsWith(".mp4") || f.ext === "mp4");
  const ready = files.filter((f) => (f.status ? f.status === "ready" : sr?.status === "ready") && !!f.name);
  if (ready.length) {
    const rank = (f: MuxFile) => {
      const key = (f.resolution ?? (f.name ?? "").replace(/\.mp4$/i, "")).toLowerCase();
      const i = RANK.indexOf(key);
      return i < 0 ? RANK.length : i;
    };
    const best = [...ready].sort((a, b) => rank(a) - rank(b))[0];
    return { state: "ready", name: best.name! };
  }
  if (sr?.status === "errored" || sr?.status === "disabled") return { state: "failed", reason: `rendition: ${sr.status}` };
  if (files.length && files.every((f) => f.status === "errored" || f.status === "skipped")) {
    return { state: "failed", reason: `rendition: ${files.map((f) => f.status).join(",")}` };
  }
  return { state: "waiting" };
}

/** The public playback id the MP4 is fetched by. */
export function playbackIdOf(asset: MuxAsset | null | undefined): string | null {
  return asset?.playback_ids?.find((p) => p.id && (!p.policy || p.policy === "public"))?.id ?? null;
}

/** Where Mux serves a finished MP4. */
export function muxMp4Url(playbackId: string, name: string): string {
  return `https://stream.mux.com/${encodeURIComponent(playbackId)}/${encodeURIComponent(name)}`;
}

/** A made copy is worth keeping: a workout post's size, and lighter than what was sent. */
export function copyKeeps(copyBytes: number, sentBytes: number): boolean {
  return copyBytes > 0 && copyBytes <= FILM_CLIP_MAX_BYTES && (!sentBytes || copyBytes < sentBytes);
}

/** After a failed try: again soon, or (out of tries) left to the phone. */
export function afterFailure(attempts: number, now = Date.now()): { status: "queued" | "failed"; next_at: string } {
  const next = attempts >= SERVER_COPY_TRIES ? now : now + Math.min(15, 2 ** attempts) * 60_000;
  return { status: attempts >= SERVER_COPY_TRIES ? "failed" : "queued", next_at: new Date(next).toISOString() };
}

/** Whether the phone should leave a clip to the server (server copies on, and the clip is still young). */
export function leftToServer(serverOn: boolean, createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!serverOn) return false;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return !Number.isFinite(at) || now - at < SERVER_COPY_GRACE_MS;
}
