/**
 * Which stored reads an older engine left behind are read again by the
 * current one, and from what (pure; Nov 22 2026). Production's reads before
 * bar-path/4 were refused for camera angles that don't affect vertical speed,
 * a brief hand over the plate and a finished rep called incomplete, or left
 * "needs a look" with a choice of circles: none of that should stay just
 * because the clip was sent before the fix.
 *
 *   - a read whose speed is on the set (velocity_accepted): never touched;
 *   - a read from the current engine, or one that couldn't open the video:
 *     left as it is;
 *   - "needs a look": found again by itself (seed auto);
 *   - a refused or partial read the athlete confirmed (source "tap"): read
 *     again from their own ring (its keys), never asked again;
 *   - a refused or partial read found by itself: found again by itself, and
 *     kept only when the new read stands up (run.ts autoReadCheck).
 */
import type { ShownKey } from "@/lib/lift-analysis/run";

export type RereadPlan =
  | { mode: "auto"; was: "needs_tap" | "done" }
  | { mode: "keys"; was: "done"; keys: ShownKey[]; plateMm: number | null };

type Row = {
  status?: string | null;
  /** The table's own column: who put the ring where it was read from ("tap" = the athlete or coach confirmed it). */
  source?: string | null;
  engine?: string | null;
  velocity_accepted?: boolean | null;
  result?: unknown;
};

type OldRead = {
  engine?: string;
  source?: "auto" | "tap";
  frame?: { w: number; h: number };
  plate?: { t?: number; x?: number; y?: number; r?: number; mm?: number; confirmed?: boolean };
  track?: { keys?: { t: number; x: number; y: number; a: number; b: number; source?: string }[] };
};

/** The engine a stored row was read with (the column, else the read's own field). */
export function engineOf(row: Row): string | null {
  const r = (row.result ?? null) as OldRead | null;
  return row.engine ?? r?.engine ?? null;
}

export function rereadPlan(row: Row | null | undefined, engine: string): RereadPlan | null {
  if (!row) return null;
  if (row.velocity_accepted) return null;
  const was = engineOf(row);
  if (!was || was === engine) return null;
  const status = row.status ?? "done";
  if (status === "needs_tap") return { mode: "auto", was: "needs_tap" };
  if (status !== "done") return null;
  const r = (row.result ?? null) as OldRead | null;
  if (!r) return null;
  if ((row.source ?? r.source) === "tap") {
    const keys = keysOf(r);
    if (keys.length)
      return {
        mode: "keys",
        was: "done",
        keys,
        plateMm: r.plate?.confirmed && r.plate.mm ? r.plate.mm : null,
      };
  }
  return { mode: "auto", was: "done" };
}

/** The ring(s) an old read was followed from, as shares of its frame (its plate when it kept no keys). */
function keysOf(r: OldRead): ShownKey[] {
  const w = r.frame?.w;
  const h = r.frame?.h;
  if (!w || !h) return [];
  const keys = (r.track?.keys ?? []).filter(
    (k) => [k.t, k.x, k.y, k.a, k.b].every(Number.isFinite) && k.a > 0 && k.b > 0,
  );
  if (keys.length)
    return keys.map((k) => ({
      t: k.t,
      fx: k.x / w,
      fy: k.y / h,
      fa: k.a / w,
      fb: k.b / h,
      source: k.source === "correction" ? "correction" : "confirmed",
    })) as ShownKey[];
  const p = r.plate;
  if (!p || ![p.t, p.x, p.y, p.r].every((v) => Number.isFinite(v)) || !(p.r! > 0)) return [];
  return [
    { t: p.t!, fx: p.x! / w, fy: p.y! / h, fa: p.r! / w, fb: p.r! / h, source: "confirmed" },
  ] as ShownKey[];
}
