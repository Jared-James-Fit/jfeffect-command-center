/**
 * Smart quick-tap selector options for the workout set logger.
 *
 * All parsing is local — no database queries. Prescriptions like "8-10",
 * "3", "12-15", "8+", "AMRAP", "RPE 7-8", "@8" are turned into a short list
 * of one-tap chip options so clients rarely need the keyboard.
 */

export type QuickTarget = {
  exact?: number;
  min?: number;
  max?: number;
  /** AMRAP / "8+" / "as many reps as possible" style prescriptions. */
  amrap?: boolean;
};

function uniqSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** Parse a reps prescription ("8-10", "3", "8+", "AMRAP", "10–12") into a target. */
export function parseRepQuickTarget(text?: string | null): QuickTarget {
  if (!text) return {};
  const s = String(text).trim().toLowerCase();
  if (!s) return {};
  const amrap = /amrap|as many reps/.test(s) || /\d\s*\+/.test(s);
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]), amrap };
  const plus = s.match(/(\d+)\s*\+/);
  if (plus) return { min: Number(plus[1]), amrap: true };
  const single = s.match(/^(\d+)$/);
  if (single) return { exact: Number(single[1]), amrap };
  const any = s.match(/(\d+)/);
  if (any) return amrap ? { min: Number(any[1]), amrap: true } : { exact: Number(any[1]), amrap };
  return amrap ? { amrap: true } : {};
}

/** Parse an RPE/RIR prescription ("RPE 7-8", "@8", "7.5", "rir: 1-2") into a target. */
export function parseEffortQuickTarget(text?: string | null): QuickTarget {
  if (!text) return {};
  const s = String(text).replace(/rpe|rir|[@~:]/gi, " ").trim();
  if (!s) return {};
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = s.match(/^(\d+(?:\.\d+)?)$/);
  if (single) return { exact: Number(single[1]) };
  const any = s.match(/(\d+(?:\.\d+)?)/);
  if (any) return { exact: Number(any[1]) };
  return {};
}

export const REPS_FALLBACK_OPTIONS = [1, 2, 3, 5, 8, 10, 12, 15];
export const RPE_FALLBACK_OPTIONS = [6, 7, 8, 9, 10];
/** Full tappable RPE range including half values. */
export const RPE_FULL_OPTIONS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
export const RIR_FULL_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Primary quick chips for reps, derived from the prescription. */
export function repQuickOptions(target: QuickTarget): number[] {
  if (target.amrap) {
    const base = target.min ?? target.exact ?? 8;
    return uniqSorted([base, base + 1, base + 2, base + 3, base + 4, base + 7].filter((x) => x > 0 && x <= 30));
  }
  if (target.exact != null) {
    return uniqSorted([target.exact - 1, target.exact, target.exact + 1].filter((x) => x > 0));
  }
  if (target.min != null && target.max != null) {
    const out: number[] = [];
    for (let v = target.min; v <= target.max && out.length < 10; v++) out.push(v);
    return out.length > 0 ? out : REPS_FALLBACK_OPTIONS;
  }
  if (target.min != null) {
    return uniqSorted([target.min, target.min + 1, target.min + 2].filter((x) => x > 0 && x <= 30));
  }
  return REPS_FALLBACK_OPTIONS;
}

/** Primary quick chips for RPE, derived from the prescription. Half values included. */
export function rpeQuickOptions(target: QuickTarget): number[] {
  if (target.exact != null) {
    return [target.exact - 0.5, target.exact, target.exact + 0.5].filter((x) => x >= 5 && x <= 10);
  }
  if (target.min != null && target.max != null) {
    const out: number[] = [];
    for (let v = target.min; v <= target.max + 1e-9 && out.length < 6; v += 0.5) {
      out.push(Math.round(v * 2) / 2);
    }
    return out.length > 0 ? out : RPE_FALLBACK_OPTIONS;
  }
  if (target.min != null) {
    return [target.min, target.min + 0.5, target.min + 1].filter((x) => x >= 5 && x <= 10);
  }
  return RPE_FALLBACK_OPTIONS;
}

/** Primary quick chips for RIR, derived from the prescription. */
export function rirQuickOptions(target: QuickTarget): number[] {
  if (target.exact != null) {
    return [target.exact - 1, target.exact, target.exact + 1].filter((x) => x >= 0 && x <= 10);
  }
  if (target.min != null && target.max != null) {
    const out: number[] = [];
    for (let v = Math.ceil(target.min); v <= target.max && out.length < 6; v++) out.push(v);
    return out.length > 0 ? out : [0, 1, 2, 3, 4];
  }
  return [0, 1, 2, 3, 4];
}

/** Expanded "more options" list: full range minus the primary chips. */
export function moreOptions(full: number[], primary: number[]): number[] {
  const primarySet = new Set(primary);
  return full.filter((v) => !primarySet.has(v));
}

/** Format a chip value: integers stay plain, halves show ".5". */
export function formatQuickValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}