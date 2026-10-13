/**
 * Cleo's attachments on the server: check they're the sender's own files,
 * turn them into what the model sees, keep what was read from them, and
 * clean up files whose message is gone. Server-only.
 *
 * - Photos and video stills go to the model as images.
 * - A whole clip (small enough) and a PDF are read by a model that takes
 *   them (Gemini) into a written "digest", saved on the message so
 *   follow-up questions can use it without re-reading the file.
 * - Text files are read as text.
 * Files are read with the service key, but only paths inside the sender's
 * own folder are ever accepted.
 */
import {
  ATTACHMENTS_BUCKET, attachmentLabel, attachmentPaths, type CleoAttachment,
} from "@/lib/cleo-attachments";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
/** Read PDFs (checked live, and by the receipt scanner). */
const DIGEST_MODELS = ["google/gemini-3-flash-preview", "google/gemini-2.5-flash"];
/** Watch a clip: the stronger model first (form checks), the faster one if it's busy or refuses. Both checked live. */
const VIDEO_MODELS = ["google/gemini-3.1-pro-preview", "google/gemini-3-flash-preview"];
const TEXT_CHARS = 40_000;
const DIGEST_CHARS = 6_000;

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Only files in the sender's own folder. Throws on anything else. */
export function assertOwnAttachments(userId: string, atts: CleoAttachment[]): void {
  for (const a of atts) {
    for (const p of attachmentPaths(a)) {
      if (!p.startsWith(`${userId}/`) || p.includes("..")) throw new Error("That attachment isn't yours.");
    }
  }
}

async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await (await admin()).storage.from(ATTACHMENTS_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Attachment not found");
  return new Uint8Array(await data.arrayBuffer());
}

const VIDEO_PROMPT = [
  "You are the eyes for a strength and physique coach's assistant. Watch this whole video carefully and write down everything useful, plainly and specifically, with timestamps.",
  "If it's training: the exercise and setup, camera angle, how many reps, load if visible, tempo, depth / range of motion, bar path, joint positions (knees, hips, back, elbows), bracing, where each rep slows or breaks down, how hard it looks (estimated RPE / reps in reserve), anything unsafe.",
  "If it's something else (a meal, a screen, a person talking): describe it and copy any text, numbers or speech that matters.",
  "Say what you can't tell from this angle. Never guess beyond what's visible.",
].join("\n");

const PDF_PROMPT = [
  "Read this whole document for a strength and physique coach's assistant.",
  "Copy out everything that matters exactly: every number with its unit and reference range, dates, names, tables (as simple rows), headings and conclusions. Keep the document's order. Don't summarize away numbers.",
].join("\n");

// Per server instance: the part shape the gateway took for video last time.
let videoShape: "file" | "image_url" | null = null;

async function gateway(model: string, prompt: string, part: Record<string, unknown>): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { ok: false, status: 0, error: "AI is not configured" };
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({ model, messages: [{ role: "user", content: [{ type: "text", text: prompt }, part] }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text().catch(() => "")).slice(0, 200) };
    const json: any = await res.json();
    const c = json?.choices?.[0]?.message?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => x?.text ?? "").join("") : "";
    return text.trim() ? { ok: true, text: text.trim() } : { ok: false, status: 200, error: "empty" };
  } catch (e: any) {
    return { ok: false, status: 0, error: String(e?.message ?? e).slice(0, 200) };
  }
}

/** A whole clip, watched. Null when no model would take it (the stills still go through). */
async function digestVideo(bytes: Uint8Array, mime: string, name: string): Promise<string | null> {
  const dataUrl = `data:${mime || "video/mp4"};base64,${toBase64(bytes)}`;
  const shapes: Array<"file" | "image_url"> = videoShape ? [videoShape, videoShape === "file" ? "image_url" : "file"] : ["file", "image_url"];
  for (const model of VIDEO_MODELS) {
    for (const shape of shapes) {
      const part = shape === "file" ? { type: "file", file: { filename: name, file_data: dataUrl } } : { type: "image_url", image_url: { url: dataUrl } };
      const r = await gateway(model, VIDEO_PROMPT, part);
      if (r.ok) {
        videoShape = shape;
        return r.text.slice(0, DIGEST_CHARS);
      }
      console.warn(`[cleo] video read failed on ${model} (${shape}): ${r.status} ${r.error}`);
      if (r.status === 429 || r.status === 402) return null;
    }
  }
  return null;
}

async function digestPdf(bytes: Uint8Array, name: string): Promise<string | null> {
  const part = { type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${toBase64(bytes)}` } };
  for (const model of DIGEST_MODELS) {
    const r = await gateway(model, PDF_PROMPT, part);
    if (r.ok) return r.text.slice(0, DIGEST_CHARS * 2);
    console.warn(`[cleo] PDF read failed on ${model}: ${r.status} ${r.error}`);
    if (r.status === 429 || r.status === 402) return null;
  }
  return null;
}

export type ModelPart = { type: "text"; text: string } | { type: "image"; image: Uint8Array; mediaType: string };

/**
 * What the model sees for this message's attachments: notes (labels, digests,
 * text files) and image parts (photos, video stills). Also returns the
 * attachments with their digests filled in, to save on the message.
 */
export async function readAttachments(atts: CleoAttachment[]): Promise<{ notes: string; images: ModelPart[]; saved: CleoAttachment[] }> {
  const notes: string[] = [];
  // Per attachment, so the images line up with the notes' order.
  const imagesBy: ModelPart[][] = atts.map(() => []);
  const saved: CleoAttachment[] = [];
  await Promise.all(
    atts.map(async (a, i) => {
      const keep: CleoAttachment = { kind: a.kind, name: a.name, mime: a.mime, size: a.size, path: a.path, frames: a.frames, duration: a.duration };
      const label = `Attachment ${i + 1}: ${attachmentLabel(a)}`;
      try {
        if (a.kind === "image" && a.path) {
          imagesBy[i].push({ type: "image", image: await download(a.path), mediaType: "image/jpeg" });
          notes[i] = `${label}. The photo is attached below.`;
        } else if (a.kind === "video") {
          const [digest, stills] = await Promise.all([
            a.path ? download(a.path).then((b) => digestVideo(b, a.mime, a.name)).catch(() => null) : Promise.resolve(null),
            Promise.all((a.frames ?? []).map(async (f) => ({ t: f.t, bytes: await download(f.path).catch(() => null) }))),
          ]);
          const got = stills.filter((s) => s.bytes);
          for (const s of got) imagesBy[i].push({ type: "image", image: s.bytes!, mediaType: "image/jpeg" });
          if (digest) keep.digest = digest;
          notes[i] = [
            `${label}.`,
            got.length ? `${got.length} stills from it are attached below, in order, at ${got.map((s) => `${s.t.toFixed(1)}s`).join(", ")}.` : "",
            digest ? `What the whole clip shows (watched in full by a video model):\n${digest}` : got.length ? "" : "It couldn't be read; say so.",
          ].filter(Boolean).join(" ");
        } else if (a.kind === "pdf" && a.path) {
          const digest = await digestPdf(await download(a.path), a.name);
          if (digest) keep.digest = digest;
          notes[i] = digest ? `${label}. Its contents:\n${digest}` : `${label}. It couldn't be read; say so.`;
        } else if (a.kind === "text" && a.path) {
          const text = new TextDecoder().decode(await download(a.path)).slice(0, TEXT_CHARS);
          keep.digest = text.slice(0, DIGEST_CHARS * 2);
          notes[i] = `${label}. Its contents:\n${text}`;
        }
      } catch (e: any) {
        notes[i] = `${label}. It couldn't be opened (${String(e?.message ?? e).slice(0, 80)}); say so.`;
      }
      saved[i] = keep;
    }),
  );
  return { notes: notes.filter(Boolean).join("\n\n"), images: imagesBy.flat(), saved };
}

/** A past message's attachments, as words (follow-up questions use the digests, not the files). */
export function attachmentsInHistory(atts: CleoAttachment[] | null | undefined): string {
  if (!atts?.length) return "";
  return atts
    .map((a, i) => `[Attachment ${i + 1}: ${attachmentLabel(a)}${a.digest ? `. What it showed: ${a.digest.slice(0, 1500)}` : ""}]`)
    .join("\n");
}

/** Photos from a recent message, re-sent so "what about the second photo?" works. */
export async function recentImages(atts: CleoAttachment[] | null | undefined, max = 4): Promise<ModelPart[]> {
  const paths = (atts ?? []).flatMap((a) => (a.kind === "image" && a.path ? [a.path] : a.kind === "video" && a.frames?.length ? [a.frames[Math.floor(a.frames.length / 2)].path] : [])).slice(0, max);
  const out: ModelPart[] = [];
  for (const p of paths) {
    try {
      out.push({ type: "image", image: await download(p), mediaType: "image/jpeg" });
    } catch {
      // gone: the words are still there
    }
  }
  return out;
}

/** The sent message owns its files now (they live and go with it). */
export async function linkAttachments(userId: string, messageId: string, atts: CleoAttachment[]): Promise<void> {
  const paths = atts.flatMap(attachmentPaths);
  if (!paths.length) return;
  await (await admin()).from("summer_attachments").update({ message_id: messageId }).in("path", paths).eq("user_id", userId);
}

/** Short-lived links to show attachments in the chat: the file, and a thumbnail (a video's middle still). */
export async function withAttachmentUrls<T extends { attachments?: CleoAttachment[] | null }>(messages: T[]): Promise<T[]> {
  const wanted = new Set<string>();
  for (const m of messages) for (const a of m.attachments ?? []) {
    if (a.path) wanted.add(a.path);
    if (a.frames?.length) wanted.add(a.frames[Math.floor(a.frames.length / 2)].path);
  }
  if (!wanted.size) return messages;
  const { data } = await (await admin()).storage.from(ATTACHMENTS_BUCKET).createSignedUrls([...wanted], 60 * 60 * 6);
  const url = new Map<string, string>(((data ?? []) as any[]).filter((d) => d?.signedUrl && d?.path).map((d) => [d.path, d.signedUrl]));
  return messages.map((m) =>
    m.attachments?.length
      ? {
          ...m,
          attachments: m.attachments.map((a) => {
            const still = a.frames?.length ? url.get(a.frames[Math.floor(a.frames.length / 2)].path) : undefined;
            const file = a.path ? url.get(a.path) : undefined;
            return { ...a, digest: undefined, url: file ?? still, thumbUrl: a.kind === "image" ? file : still };
          }),
        }
      : m,
  );
}

/** Delete files now (a chat was deleted). */
export async function removeAttachmentFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const sb = await admin();
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from(ATTACHMENTS_BUCKET).remove(paths.slice(i, i + 100));
  await sb.from("summer_attachments").delete().in("path", paths);
}

/** The daily sweep: files whose message is gone, or that were never sent (a day old). */
export async function sweepAttachments(): Promise<{ removed: number }> {
  const sb = await admin();
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.from("summer_attachments").select("path").is("message_id", null).lt("created_at", cutoff).limit(500);
    if (error) throw new Error(error.message);
    const paths = ((data ?? []) as Array<{ path: string }>).map((r) => r.path);
    if (!paths.length) break;
    await removeAttachmentFiles(paths);
    removed += paths.length;
  }
  return { removed };
}
