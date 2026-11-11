/**
 * What a set video says about its set: "100 kg × 5 @ RPE 8". Pure (tested),
 * shared by the set row's video cell, the upload job and the coach chat card,
 * so the set reads the same everywhere it shows.
 */
import type { LoadType } from "@/lib/workout-load-type";

export type SetVideoSetValues = {
  /** As shown on the set (the athlete's unit). */
  load: number | null;
  unit: "kg" | "lb";
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  loadType: LoadType;
  /** A timed set. */
  durationSec: number | null;
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "100 kg × 5 @ RPE 8", "BW × 12", "20 kg assist × 8", "45s @ RPE 7", "" when nothing is logged. */
export function setVideoLabel(v: SetVideoSetValues): string {
  const load = v.load != null && Number.isFinite(v.load) ? v.load : null;
  const loadPart =
    v.loadType === "assisted"
      ? load != null && load > 0
        ? `${num(load)} ${v.unit} assist`
        : "Assisted"
      : v.loadType === "bodyweight"
        ? load != null && load > 0
          ? `BW + ${num(load)} ${v.unit}`
          : "BW"
        : load != null
          ? `${num(load)} ${v.unit}`
          : null;
  const reps = v.reps != null && Number.isFinite(v.reps) && v.reps > 0 ? Math.round(v.reps) : null;
  const dur = v.durationSec != null && v.durationSec > 0 ? clock(v.durationSec) : null;
  let work = "";
  if (loadPart && reps != null) work = `${loadPart} × ${reps}`;
  else if (loadPart && dur) work = `${loadPart} · ${dur}`;
  else if (reps != null) work = `${reps} ${reps === 1 ? "rep" : "reps"}`;
  else if (dur) work = dur;
  else if (loadPart) work = loadPart;
  const effort =
    v.rpe != null && Number.isFinite(v.rpe)
      ? `RPE ${num(v.rpe)}`
      : v.rir != null && Number.isFinite(v.rir)
        ? `RIR ${num(v.rir)}`
        : null;
  if (!work) return effort ?? "";
  return effort ? `${work} @ ${effort}` : work;
}

/** The chat message: "🎥 Bench Press · Set 3 · 100 kg × 5 @ RPE 8" (≤ 200 characters). */
export function setVideoMessageBody(exercise: string, setIndex: number, label: string): string {
  const parts = [exercise.trim() || "Exercise", `Set ${setIndex}`, label.trim()].filter(Boolean);
  return `🎥 ${parts.join(" · ")}`.slice(0, 200);
}

/**
 * The picked file, recognised again: the same clip picked twice (a double
 * tap, or the same video attached again) is one upload and one message.
 * Name + size + last-modified is what the phone's picker gives us; it's
 * hashed with the client so the key says nothing about the file.
 */
export async function setVideoFileKey(
  clientId: string,
  file: Pick<File, "name" | "size" | "lastModified">,
): Promise<string> {
  const raw = `${clientId}|${file.name}|${file.size}|${file.lastModified}`;
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40);
  } catch {
    // no SubtleCrypto (an old webview): a plain, stable string hash
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 0x01000193) >>> 0;
    return `f${h.toString(16)}${file.size.toString(16)}`;
  }
}

/** Where a set video lives: the client's own folder of the coach chat's bucket (the chat's own access rules). */
export function setVideoStem(clientId: string, jobId: string): string {
  return `${clientId}/set-videos/${jobId}`;
}
