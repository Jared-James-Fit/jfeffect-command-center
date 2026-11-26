/**
 * Sending athlete information from the phone (shared by the coach's sheet and
 * the share page): spreadsheets, Word and text are read here, cells as shown
 * (nothing leaves the phone but the file and its text); a fingerprint of the
 * file says when it's already been added; each file goes up through a
 * one-time link the server signed, with real progress; then the server reads
 * it in the background, so leaving the screen loses nothing once it's up.
 */
import { readLocalFile } from "@/lib/program-import/extract";
import { fileKindOf, READ_ON_PHONE } from "@/lib/athlete-intel/uploads";
import { uploadFileToSignedUrlWithProgress } from "@/lib/upload-with-progress";

export type Picked = { file: File; key: string };
export type Progress = Record<string, { percent: number; state: "hashing" | "uploading" | "reading" | "done" | "duplicate" | "failed"; note?: string }>;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A fingerprint of the file (the whole file; a video's first 4 MB and its size, so a long clip isn't read twice). */
export async function fingerprint(file: File): Promise<string | null> {
  try {
    const video = fileKindOf(file.name, file.type) === "video";
    const bytes = video ? new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer()) : new Uint8Array(await file.arrayBuffer());
    const extra = video ? new TextEncoder().encode(`|${file.size}`) : new Uint8Array();
    const all = new Uint8Array(bytes.length + extra.length);
    all.set(bytes);
    all.set(extra, bytes.length);
    return hex(await crypto.subtle.digest("SHA-256", all));
  } catch {
    return null;
  }
}

const clip = (s: string) => (s.length > 500 ? s.slice(0, 500) : s);

/** What the phone can read itself: text and sheets (cells as shown), within what the server takes. */
export async function readOnPhone(file: File): Promise<{ text: string; sheets: Array<{ name: string; rows: string[][] }> | null } | null> {
  const kind = fileKindOf(file.name, file.type);
  if (!READ_ON_PHONE.includes(kind as any)) return null;
  try {
    const doc = readLocalFile(file.name, kind as "csv" | "xlsx" | "docx" | "text", new Uint8Array(await file.arrayBuffer()));
    return {
      text: doc.text.slice(0, 200_000),
      sheets: doc.sheets
        ? doc.sheets.slice(0, 40).map((s) => ({ name: s.name.slice(0, 120), rows: s.rows.slice(0, 2000).map((r) => r.slice(0, 60).map((c) => clip(String(c ?? "")))) }))
        : null,
    };
  } catch {
    // the server can still keep the original; the reader says what it couldn't do
    return { text: "", sheets: null };
  }
}

export type StartFn = (files: Array<{ name: string; size: number; type: string; hash: string | null }>) => Promise<{
  files: Array<{ name: string; sourceId: string | null; path: string | null; token: string | null; signedUrl?: string | null; duplicateOf: string | null; problem: string | null; kind: string | null }>;
}>;
export type FinishFn = (sourceId: string, extracted: Awaited<ReturnType<typeof readOnPhone>>, failed?: boolean) => Promise<unknown>;

/** Up and queued: every file, with progress; problems and duplicates said per file, never thrown for the batch. */
export async function sendFiles(picked: Picked[], start: StartFn, finish: FinishFn, onProgress: (p: Progress) => void): Promise<{ sent: number; duplicates: number; problems: string[] }> {
  const progress: Progress = {};
  const set = (k: string, v: Progress[string]) => {
    progress[k] = v;
    onProgress({ ...progress });
  };
  const metas = [];
  for (const p of picked) {
    set(p.key, { percent: 0, state: "hashing" });
    metas.push({ name: p.file.name, size: p.file.size, type: p.file.type || "", hash: await fingerprint(p.file) });
  }
  const r = await start(metas);
  let sent = 0;
  let duplicates = 0;
  const problems: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const f = r.files[i];
    if (!f) continue;
    if (f.problem) {
      problems.push(`${p.file.name}: ${f.problem}`);
      set(p.key, { percent: 0, state: "failed", note: f.problem });
      continue;
    }
    if (f.duplicateOf) {
      duplicates++;
      set(p.key, { percent: 100, state: "duplicate", note: `Already added (${f.duplicateOf})` });
      continue;
    }
    if (!f.sourceId || !f.path || !f.token) continue;
    try {
      const extracted = await readOnPhone(p.file);
      set(p.key, { percent: 0, state: "uploading" });
      await uploadFileToSignedUrlWithProgress({
        bucket: "athlete-intel",
        path: f.path,
        signedUrl: f.signedUrl ?? "",
        token: f.token,
        file: p.file,
        contentType: p.file.type || undefined,
        onProgress: (x) => set(p.key, { percent: x.percent, state: "uploading" }),
      });
      set(p.key, { percent: 100, state: "reading" });
      await finish(f.sourceId, extracted);
      sent++;
      set(p.key, { percent: 100, state: "done" });
    } catch (e: any) {
      problems.push(`${p.file.name}: ${e?.message ?? "didn't upload"}`);
      set(p.key, { percent: 0, state: "failed", note: e?.message ?? "Didn't upload" });
      await finish(f.sourceId, null, true).catch(() => undefined);
    }
  }
  return { sent, duplicates, problems };
}
