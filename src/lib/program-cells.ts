import type { PlanExercise, WeightUnit } from "@/lib/program-plan";

/**
 * The builder's cells: what each shows and how what's typed into it becomes
 * the exercise's numbers (pure, tested). A cell never invents a value: what
 * it can't read leaves the exercise as it was.
 */
export type CellField = "sets" | "reps" | "effort" | "load" | "rest";
export const CELL_FIELDS: CellField[] = ["sets", "reps", "effort", "load", "rest"];

export const CELL_LABEL: Record<CellField, string> = {
  sets: "Sets",
  reps: "Reps",
  effort: "RPE",
  load: "Load",
  rest: "Rest",
};

/** How the load cell reads what's typed: a weight in lb or kg, or a % of a max or of the top set. */
export type LoadMode = WeightUnit | "pct_1rm" | "pct_top";

export function loadModeOf(e: Pick<PlanExercise, "pct" | "pct_of" | "unit" | "load">, fallback: WeightUnit = "lb"): LoadMode {
  if (e.pct != null) return e.pct_of === "top_set" ? "pct_top" : "pct_1rm";
  if (e.load != null) return e.unit ?? fallback;
  return fallback;
}

export const LOAD_MODE_LABEL: Record<LoadMode, string> = {
  lb: "lb",
  kg: "kg",
  pct_1rm: "% max",
  pct_top: "% top set",
};

const num = (n: number) => String(Number(n.toFixed(2)));

/** What a cell shows, and the small word beside it ("RIR", "kg", "% max"). */
export function cellText(e: PlanExercise, f: CellField): { value: string; unit?: string } {
  switch (f) {
    case "sets":
      // a set count the file didn't give (an import) is an empty cell to fill, never "0"
      return { value: e.sets ? String(e.sets) : "" };
    case "reps":
      return { value: e.reps ?? "" };
    case "effort":
      if (e.rir) return { value: e.rir, unit: "RIR" };
      return { value: e.rpe ?? "" };
    case "load":
      if (e.pct != null) return { value: num(e.pct), unit: e.pct_of === "top_set" ? "% top" : "% max" };
      if (e.load != null) return { value: num(e.load), unit: e.unit ?? "lb" };
      return { value: "" };
    case "rest":
      return { value: restText(e.rest_seconds) };
  }
}

export function restText(s: number | null | undefined): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

/**
 * Rest as typed: "2:30" is 2½ minutes, a number up to 10 is minutes ("2",
 * "1.5"), anything bigger is seconds ("90"); blank clears it. Null when it
 * can't be read.
 */
export function parseRest(raw: string): { ok: true; seconds: number | null } | { ok: false } {
  const t = raw.trim().replace(",", ".");
  if (!t) return { ok: true, seconds: null };
  const mmss = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (mmss) return clampRest(Number(mmss[1]) * 60 + Number(mmss[2]));
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return clampRest(n <= 10 ? Math.round(n * 60) : Math.round(n));
  }
  return { ok: false };
}
function clampRest(s: number): { ok: true; seconds: number | null } {
  return { ok: true, seconds: s <= 0 ? null : Math.min(900, s) };
}

/**
 * What typing `raw` into a cell does to the exercise: the patch to apply, or
 * null when it's not a value the cell can hold yet (the cell keeps showing
 * what's typed and the exercise keeps its last good value).
 */
export function cellPatch(
  e: PlanExercise,
  f: CellField,
  raw: string,
  mode?: LoadMode,
): Partial<PlanExercise> | null {
  const t = raw.trim();
  switch (f) {
    case "sets": {
      if (!/^\d{1,2}$/.test(t)) return null;
      const n = Number(t);
      return n >= 1 && n <= 20 ? { sets: n } : null;
    }
    case "reps":
      return { reps: t.slice(0, 20) };
    case "effort": {
      const v = t.replace(",", ".");
      // the scale the exercise uses; a blank clears it
      return e.rir ? { rir: v || null, rpe: null } : { rpe: v || null, rir: null };
    }
    case "load": {
      if (!t) return { load: null, pct: null, pct_of: null, unit: null };
      const v = t.replace(",", ".");
      if (!/^\d{1,4}(\.\d{0,2})?$/.test(v)) return null;
      const n = Number(v);
      if (!(n > 0)) return null;
      const m = mode ?? loadModeOf(e);
      if (m === "pct_1rm" || m === "pct_top") {
        return n <= 150 ? { pct: n, pct_of: m === "pct_top" ? "top_set" : "1rm", load: null, unit: null } : null;
      }
      return n <= 1500 ? { load: n, unit: m, pct: null, pct_of: null } : null;
    }
    case "rest": {
      const r = parseRest(t);
      return r.ok ? { rest_seconds: r.seconds } : null;
    }
  }
}

/** Whether a cell's value would stop a save (shown outlined, never blocked while typing). */
export function cellInvalid(e: PlanExercise, f: CellField): boolean {
  if (f === "reps") return !String(e.reps ?? "").trim();
  if (f === "effort") {
    if (e.rpe) return !/^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$/.test(e.rpe.trim());
    if (e.rir) return !/^(10|[0-9](\.5)?)(-(10|[0-9](\.5)?))?$/.test(e.rir.trim());
  }
  return false;
}

/** The keyboard for each cell: numbers where only numbers go; reps take "8-10". */
export const CELL_INPUT_MODE: Record<CellField, "numeric" | "decimal" | "text"> = {
  sets: "numeric",
  reps: "text",
  effort: "decimal",
  load: "decimal",
  rest: "decimal",
};
