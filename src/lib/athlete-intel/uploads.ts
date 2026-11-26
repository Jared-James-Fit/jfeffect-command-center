/**
 * Uploads (pure, shared by the phone and the server): which files are taken
 * and how big, a safe storage name, the rights confirmation kept word for
 * word, and a coach's correction of a fact read and checked.
 */
import { fileKind } from "@/lib/program-import/extract";
import type { FactKind, SourceKind } from "./types";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export const RIGHTS_TEXT =
  "I have the right to share this, and the athlete agreed to it being used for their coaching and competition preparation in JF Effect.";

export const ACCEPT =
  ".xlsx,.xlsm,.csv,.tsv,.docx,.pdf,.txt,.md,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.m4v,.webm,application/pdf,image/*,video/*,text/*";

/** What a file is, by its name and type. */
export function fileKindOf(name: string, type: string): SourceKind | "xls" | "unsupported" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const t = (type ?? "").toLowerCase();
  if (/^(mp4|mov|m4v|webm)$/.test(ext) || t.startsWith("video/")) return "video";
  const k = fileKind(name, type ?? "");
  return k === "text" ? "text" : k;
}

/** The kinds the phone reads itself (cells as shown, text): the rest go to the server as they are. */
export const READ_ON_PHONE: SourceKind[] = ["xlsx", "csv", "docx", "text"];

export function safeName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+/, "")
    .slice(-80);
  return base && /\.[a-z0-9]{1,5}$/i.test(base) ? base : `${base || "upload"}.bin`;
}

const num = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A correction the coach typed, merged onto the fact's own data and checked; null when it doesn't read. */
export function cleanCorrection(kind: FactKind, prev: any, patch: Record<string, unknown>): Record<string, unknown> | null {
  const d = { ...(prev ?? {}) };
  if (kind === "training") {
    if ("loadKg" in patch) {
      const v = patch.loadKg == null ? null : num(patch.loadKg, 10, 600);
      if (patch.loadKg != null && v == null) return null;
      d.loadKg = v;
      d.load = v;
      d.unit = v != null ? "kg" : d.unit;
    }
    if ("reps" in patch) {
      const v = num(patch.reps, 1, 30);
      if (v == null) return null;
      d.reps = Math.round(v);
    }
    if ("sets" in patch) {
      const v = num(patch.sets, 1, 12);
      if (v == null) return null;
      d.sets = Math.round(v);
    }
    if ("rpe" in patch) d.rpe = patch.rpe == null ? null : num(patch.rpe, 5, 10);
    if ("completion" in patch) {
      if (!["completed", "prescribed", "unknown"].includes(String(patch.completion))) return null;
      d.completion = patch.completion;
    }
    if ("standard" in patch) {
      if (!["competition", "variation", "unclear"].includes(String(patch.standard))) return null;
      d.standard = patch.standard;
    }
    return d;
  }
  if (kind === "attempt_plan") {
    for (const k of ["opener", "second", "third"]) if (k in patch) d[k] = patch[k] == null ? null : num(patch[k], 20, 600);
    if (d.opener == null) return null;
    return d;
  }
  if (kind === "bodyweight") {
    const v = num(patch.kg ?? d.kg, 30, 300);
    return v == null ? null : { kg: v };
  }
  if (kind === "risk") {
    const status = patch.status ?? d.status;
    if (!["current", "resolved", "unknown"].includes(String(status))) return null;
    return { ...d, status, text: text(patch.text, 400) ?? d.text };
  }
  if (kind === "equipment") {
    for (const k of ["rackHeight", "safety", "footBlocks"]) if (k in patch) d[k] = text(patch[k], 10);
    return d;
  }
  if ("text" in patch) {
    const t = text(patch.text, 400);
    if (!t) return null;
    d.text = t;
  }
  return d;
}
