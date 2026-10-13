/**
 * What can be attached to a Cleo message, and how it's described. Pure:
 * shared by the uploader (cleo-attachment-upload.ts), the server
 * (cleo-attachments.server.ts) and the chat.
 *
 * Photos are shrunk on the phone and the model looks at them directly.
 * Videos become a set of stills (works for any length, on any model); a
 * short clip is also watched in full by a model that takes video. PDFs and
 * text files are read in full. Files live in the private cleo-attachments
 * bucket under the person's own folder.
 */
import { z } from "zod";

export const ATTACHMENTS_BUCKET = "cleo-attachments";
export const MAX_ATTACHMENTS = 5;
/** Longest edge for a photo Cleo looks at (a 12MP shot shrinks to ~300-500KB). */
export const IMAGE_MAX_EDGE = 2000;
/** Stills from a video: longest edge, and how many (about one a second, 6 to 16). */
export const FRAME_MAX_EDGE = 1024;
export const MIN_FRAMES = 6;
export const MAX_FRAMES = 16;
/**
 * A clip up to this size is also uploaded whole, for a model that watches
 * video. Gemini takes about 20MB of inline data a request and base64 adds a
 * third, so 14MB; bigger clips are read from their stills.
 */
export const VIDEO_WATCH_MAX_BYTES = 14 * 1024 * 1024;
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const ATTACH_ACCEPT = "image/*,video/*,application/pdf,.pdf,.csv,.txt,.md,.json,text/plain,text/csv";

export type AttachmentKind = "image" | "video" | "pdf" | "text";

export type CleoAttachment = {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  /** The file: a shrunk photo, the whole clip (if small enough), the PDF or text. */
  path?: string;
  /** Video stills, with their time in seconds. */
  frames?: Array<{ path: string; t: number }>;
  duration?: number;
  /** What Cleo read from it (a video or PDF), kept so follow-up questions can use it. */
  digest?: string;
  /** Display only (signed, short-lived); never stored. */
  url?: string;
  thumbUrl?: string;
};

/** Which kind a picked file is, or null if Cleo can't use it. */
export function attachmentKind(mime: string, name: string): AttachmentKind | null {
  const m = (mime || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"].includes(ext)) return "image";
  if (m.startsWith("video/") || ["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("text/") || m === "application/json" || ["txt", "csv", "md", "json"].includes(ext)) return "text";
  return null;
}

/** About one still a second, at least 6 and at most 16, spread evenly (never the very first or last frame). */
export function frameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const n = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.ceil(duration)));
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * duration * 100) / n) / 100);
}

/** A one-line label: "squat.mov (video, 0:14)". */
export function attachmentLabel(a: Pick<CleoAttachment, "kind" | "name" | "duration">): string {
  const len = a.kind === "video" && a.duration ? `, ${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, "0")}` : "";
  return `${a.name} (${a.kind === "image" ? "photo" : a.kind === "pdf" ? "PDF" : a.kind}${len})`;
}

const safePath = z.string().min(3).max(300).regex(/^[0-9a-f-]{36}\/[\w./-]+$/i, "bad path").refine((p) => !p.includes(".."), "bad path");

/** What the server accepts from the browser (paths must be in the sender's own folder; checked again on the server). */
export const AttachmentInput = z.object({
  kind: z.enum(["image", "video", "pdf", "text"]),
  name: z.string().trim().min(1).max(200),
  mime: z.string().max(120),
  size: z.number().int().nonnegative().max(UPLOAD_MAX_BYTES),
  path: safePath.optional(),
  frames: z.array(z.object({ path: safePath, t: z.number().min(0).max(36_000) })).max(MAX_FRAMES).optional(),
  duration: z.number().min(0).max(36_000).optional(),
});
export const AttachmentsInput = z.array(AttachmentInput).max(MAX_ATTACHMENTS);

/** Every stored file an attachment uses. */
export function attachmentPaths(a: Pick<CleoAttachment, "path" | "frames">): string[] {
  return [...(a.path ? [a.path] : []), ...(a.frames ?? []).map((f) => f.path)];
}
