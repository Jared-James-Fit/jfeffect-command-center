/**
 * Getting a picked file ready for Cleo, on the phone: photos are shrunk (a
 * 12MP shot is 3-5MB, Cleo needs a fraction of that), a video becomes a set
 * of stills (plus the whole clip when it's small enough to be watched), and
 * everything goes to the person's own folder in the private bucket. Each
 * file is registered first (summer_attachments), so anything never sent is
 * swept up later.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  ATTACHMENTS_BUCKET, FRAME_MAX_EDGE, IMAGE_MAX_EDGE, PDF_MAX_BYTES, TEXT_MAX_BYTES, UPLOAD_MAX_BYTES, VIDEO_WATCH_MAX_BYTES,
  attachmentKind, frameTimes, type CleoAttachment,
} from "@/lib/cleo-attachments";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toJpeg(source: CanvasImageSource, w: number, h: number, maxEdge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

async function shrinkImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const out = await toJpeg(bitmap, bitmap.width, bitmap.height, IMAGE_MAX_EDGE, 0.85);
    bitmap.close?.();
    return out;
  } catch {
    // createImageBitmap can't decode it (HEIC on some browsers): try an <img>.
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      const out = await toJpeg(img, img.naturalWidth, img.naturalHeight, IMAGE_MAX_EDGE, 0.85);
      URL.revokeObjectURL(url);
      return out;
    } catch {
      return null;
    }
  }
}

function once(el: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      el.removeEventListener(event, ok);
      reject(new Error(`${event} timed out`));
    }, ms);
    const ok = () => {
      window.clearTimeout(t);
      el.removeEventListener(event, ok);
      resolve();
    };
    el.addEventListener(event, ok);
  });
}

/** Stills spread across the clip (about one a second, 6 to 16). Empty when the browser can't decode it. */
export async function videoStills(file: File): Promise<{ duration: number; frames: Array<{ blob: Blob; t: number }> }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.preload = "auto";
  v.src = url;
  const frames: Array<{ blob: Blob; t: number }> = [];
  let duration = 0;
  try {
    await once(v, "loadedmetadata", 10_000);
    duration = Number.isFinite(v.duration) ? v.duration : 0;
    // iOS only paints frames after the video has played once (muted, inline).
    try {
      await v.play();
      v.pause();
    } catch {
      // fine: some browsers paint without it
    }
    for (const t of frameTimes(duration)) {
      try {
        const seeked = once(v, "seeked", 6000);
        v.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        await seeked;
        const blob = await toJpeg(v, v.videoWidth, v.videoHeight, FRAME_MAX_EDGE, 0.8);
        if (blob && blob.size > 2000) frames.push({ blob, t });
      } catch {
        // skip a frame that won't seek
      }
    }
  } catch {
    // can't read the clip in this browser
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
  return { duration, frames };
}

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Sign in again to attach files.");
  return id;
}

async function put(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

/** Get one picked file ready to send. `onStage` reports what it's doing ("Reading video…"). */
export async function prepareAttachment(file: File, onStage?: (s: string) => void): Promise<CleoAttachment> {
  const kind = attachmentKind(file.type, file.name);
  if (!kind) throw new Error(`${file.name}: Cleo can read photos, videos, PDFs and text files.`);
  if (file.size > UPLOAD_MAX_BYTES && kind !== "video") throw new Error(`${file.name} is over 100 MB.`);
  const userId = await myId();
  const d = new Date();
  const base = `${userId}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}/${uid()}`;
  const name = file.name || (kind === "image" ? "photo.jpg" : kind === "video" ? "video.mp4" : "file");
  const register = async (paths: string[]) => {
    // Registered before upload, so a file that never gets sent is still cleaned up.
    await (supabase as any).from("summer_attachments").insert(paths.map((path) => ({ path, user_id: userId })));
  };

  if (kind === "image") {
    onStage?.("Preparing photo…");
    const small = await shrinkImage(file);
    if (!small && /hei[cf]/i.test(file.type + file.name)) throw new Error(`${name}: this browser can't open HEIC photos. Send a screenshot of it instead.`);
    const body = small ?? file;
    const path = `${base}.jpg`;
    await register([path]);
    onStage?.("Uploading…");
    await put(path, body, small ? "image/jpeg" : file.type || "image/jpeg");
    return { kind, name, mime: small ? "image/jpeg" : file.type, size: body.size, path };
  }

  if (kind === "video") {
    onStage?.("Reading video…");
    const { duration, frames } = await videoStills(file);
    const whole = file.size <= VIDEO_WATCH_MAX_BYTES;
    if (!frames.length && !whole) throw new Error(`${name}: couldn't read this video here. Try a shorter clip or a screen recording.`);
    const ext = (name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const framePaths = frames.map((f, i) => ({ path: `${base}/f${String(i + 1).padStart(2, "0")}.jpg`, t: f.t, blob: f.blob }));
    const path = whole ? `${base}.${ext}` : undefined;
    await register([...(path ? [path] : []), ...framePaths.map((f) => f.path)]);
    onStage?.("Uploading…");
    await Promise.all(framePaths.map((f) => put(f.path, f.blob, "image/jpeg")));
    if (path) await put(path, file, file.type || "video/mp4");
    return {
      kind, name, mime: file.type || "video/mp4", size: file.size, path,
      frames: framePaths.map(({ path: p, t }) => ({ path: p, t })),
      duration: duration || undefined,
    };
  }

  if (kind === "pdf") {
    if (file.size > PDF_MAX_BYTES) throw new Error(`${name} is over 20 MB.`);
    const path = `${base}.pdf`;
    await register([path]);
    onStage?.("Uploading…");
    await put(path, file, "application/pdf");
    return { kind, name, mime: "application/pdf", size: file.size, path };
  }

  if (file.size > TEXT_MAX_BYTES) throw new Error(`${name} is over 1 MB of text.`);
  const csv = /csv/i.test(file.type) || name.toLowerCase().endsWith(".csv");
  const path = `${base}.${csv ? "csv" : "txt"}`;
  await register([path]);
  onStage?.("Uploading…");
  await put(path, file, csv ? "text/csv" : "text/plain");
  return { kind, name, mime: csv ? "text/csv" : "text/plain", size: file.size, path };
}

/** Taking an unsent file out of the tray: delete it now rather than waiting for the sweep. */
export async function discardAttachment(a: CleoAttachment): Promise<void> {
  const paths = [...(a.path ? [a.path] : []), ...(a.frames ?? []).map((f) => f.path)];
  if (!paths.length) return;
  try {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
    await (supabase as any).from("summer_attachments").delete().in("path", paths);
  } catch {
    // the daily sweep gets it
  }
}
