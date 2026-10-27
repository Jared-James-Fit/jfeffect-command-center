// Save a chat photo or video to the phone, iMessage style.
//
// A web app can't write to Photos itself: on a phone the file goes to the share
// sheet, whose "Save Image" / "Save Video" puts it in Photos; on a computer it
// downloads. iOS opens the share sheet only from inside a tap, so the file has
// to be in hand when the tap lands: `prepareSave` starts as the finger touches
// down (a clip already downloaded for playback is used as is, nothing fetched
// twice), and `readyFiles` hands it over synchronously at the tap. When it
// isn't ready in time (a long video still downloading), the caller offers one
// more tap once it is.

import { supabase } from "@/integrations/supabase/client";
import { peekChatVideo } from "@/lib/chat-video-store";
import { canShareFiles, downloadFiles, isTouchDevice } from "@/lib/file-share";

const BUCKET = "message-attachments";
const SIGN_SECONDS = 10 * 60;
/** Files held ready for a second tap; least recently used go first. */
const KEEP_BYTES = 200 * 1024 * 1024;

export type SaveItem = {
  kind: "image" | "video";
  /** Storage path in message-attachments (preferred: signed fresh, or the local clip). */
  path?: string | null;
  /** A link to use when there's no path (or the one already on screen). */
  url?: string | null;
  name?: string | null;
  mime?: string | null;
  /** When it was sent, for the file name. */
  at?: string | null;
};

/** Anything in a message that can be saved: its photos and videos (not GIFs or sound effects). */
export function saveItemsOf(
  attachments: unknown,
  opts: { at?: string | null; signed?: Record<string, string | undefined> } = {},
): SaveItem[] {
  const list = Array.isArray(attachments) ? attachments : [];
  const out: SaveItem[] = [];
  for (const raw of list) {
    const a = raw as Record<string, any> | null;
    if (!a || (a.type !== "image" && a.type !== "video")) continue;
    if (a.kind === "gif" || a.kind === "sound") continue;
    const path = typeof a.storage_path === "string" && a.storage_path ? a.storage_path : null;
    const url = (path && opts.signed?.[path]) || (typeof a.url === "string" && a.url ? a.url : null);
    if (!path && !url) continue;
    out.push({ kind: a.type, path, url, name: a.name ?? null, mime: a.mime ?? null, at: opts.at ?? null });
  }
  return out;
}

/** "Save photo", "Save video", "Save 3 photos", "Save 2 photos & videos". */
export function saveLabel(items: Pick<SaveItem, "kind">[]): string {
  const photos = items.filter((i) => i.kind === "image").length;
  const videos = items.length - photos;
  if (items.length <= 1) return videos ? "Save video" : "Save photo";
  if (!videos) return `Save ${photos} photos`;
  if (!photos) return `Save ${videos} videos`;
  return `Save ${items.length} photos & videos`;
}

export function saveKey(item: SaveItem): string {
  return item.path || item.url || "";
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v",
};

/** The file's type: what the server or picker said, else its name / path. */
export function saveMime(item: SaveItem, blobType?: string | null): string {
  const said = (blobType || item.mime || "").split(";")[0].trim().toLowerCase();
  if (said && said !== "application/octet-stream") return said;
  const from = (item.name || item.path || item.url || "").split("?")[0];
  const ext = from.split(".").pop()?.toLowerCase() ?? "";
  const hit = Object.entries(EXT).find(([, e]) => e === ext || (ext === "jpeg" && e === "jpg"));
  return hit ? hit[0] : item.kind === "video" ? "video/mp4" : "image/jpeg";
}

/** The sender's own name when it has a sensible extension, else "jfeffect-2026-10-27-1.jpg". */
export function saveFileName(item: SaveItem, index: number, type: string): string {
  const ext = EXT[type] ?? (type.startsWith("video/") ? "mp4" : "jpg");
  const own = (item.name ?? "").trim().replace(/[\\/:*?"<>|]+/g, "-");
  if (own && /\.[a-z0-9]{2,5}$/i.test(own) && own.length <= 80) return own;
  const day = (item.at || new Date().toISOString()).slice(0, 10);
  return `jfeffect-${day}-${index + 1}.${ext}`;
}

/* ------------------------------ ready files ------------------------------ */

const ready = new Map<string, { file: File; usedAt: number }>();
const pending = new Map<string, Promise<File>>();

function keep(key: string, file: File) {
  ready.set(key, { file, usedAt: Date.now() });
  let total = 0;
  for (const v of ready.values()) total += v.file.size;
  if (total <= KEEP_BYTES) return;
  for (const [k, v] of [...ready.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
    if (total <= KEEP_BYTES || k === key) continue;
    ready.delete(k);
    total -= v.file.size;
  }
}

/** Every item's file, if all are in hand right now (synchronous: safe inside a tap). */
export function readyFiles(items: SaveItem[]): File[] | null {
  if (!items.length) return null;
  const files: File[] = [];
  for (const item of items) {
    const hit = ready.get(saveKey(item));
    if (!hit) return null;
    hit.usedAt = Date.now();
    files.push(hit.file);
  }
  return files;
}

/**
 * The file's bytes: a clip already on the phone for playback first (no second
 * download), then the link already on screen (often in the browser's cache),
 * then a freshly signed one (an old message's stored link may have expired).
 */
async function openSource(item: SaveItem): Promise<Response> {
  const local = item.kind === "video" ? peekChatVideo(item.path) : undefined;
  if (local) {
    try {
      const r = await fetch(local);
      if (r.ok) return r;
    } catch { /* released meanwhile: download it */ }
  }
  if (item.url) {
    try {
      const r = await fetch(item.url);
      if (r.ok || !item.path) return r;
    } catch (e) {
      if (!item.path) throw e;
    }
  }
  if (!item.path) throw new Error("No link for this file");
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(item.path, SIGN_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("No link for this file");
  return fetch(data.signedUrl);
}

async function fetchFile(item: SaveItem, index: number, onBytes?: (got: number, total: number | null) => void): Promise<File> {
  const res = await openSource(item);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || null;
  let blob: Blob;
  if (res.body && onBytes) {
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { parts.push(value); got += value.byteLength; onBytes(got, total); }
    }
    blob = new Blob(parts, { type: res.headers.get("content-type") ?? "" });
  } else {
    blob = await res.blob();
  }
  const type = saveMime(item, blob.type);
  return new File([blob], saveFileName(item, index, type), { type });
}

/**
 * Get every item's file in hand (started on touch-down, awaited on the tap).
 * `onProgress` gets 0–1 across all of them while anything downloads.
 */
export async function prepareSave(items: SaveItem[], onProgress?: (share: number) => void): Promise<File[]> {
  const got = new Map<number, number>();
  const totals = new Map<number, number>();
  const report = () => {
    if (!onProgress) return;
    const want = [...totals.values()].reduce((a, b) => a + b, 0);
    if (!want) return;
    const have = [...got.values()].reduce((a, b) => a + b, 0);
    onProgress(Math.min(1, have / want));
  };
  return Promise.all(items.map((item, i) => {
    const key = saveKey(item);
    const hit = ready.get(key);
    if (hit) return Promise.resolve(hit.file);
    let job = pending.get(key);
    if (!job) {
      job = fetchFile(item, i, (n, total) => { got.set(i, n); if (total) totals.set(i, total); report(); })
        .then((file) => { keep(key, file); return file; })
        .finally(() => { pending.delete(key); });
      pending.set(key, job);
    }
    return job;
  }));
}

/**
 * Warm the files as a finger lands on Save (errors wait for the tap).
 * `cheap`: only what costs little (photos, clips already on the phone), for
 * when Save is merely on offer (a message's menu, the full-screen viewer).
 */
export function warmSave(items: SaveItem[], opts: { cheap?: boolean } = {}) {
  const list = opts.cheap ? items.filter((i) => i.kind === "image" || !!peekChatVideo(i.path)) : items;
  if (!list.length || readyFiles(list)) return;
  prepareSave(list).catch(() => { /* the tap reports it */ });
}

export type SaveOutcome = "shared" | "cancelled" | "again" | "saved" | "failed";

/**
 * Hand the files over: the share sheet on a phone (its first await is the
 * share itself, so this must be called straight from the tap), a download
 * on a computer. "again": the phone wouldn't open the sheet from this tap.
 */
export async function saveFiles(files: File[]): Promise<SaveOutcome> {
  if (isTouchDevice() && canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") return "cancelled";
      if (name === "NotAllowedError") return "again";
      return downloadFiles(files) ? "saved" : "failed";
    }
  }
  return downloadFiles(files) ? "saved" : "failed";
}

/** Test hook: forget held files. */
export function _resetSaveMedia() {
  ready.clear();
  pending.clear();
}
