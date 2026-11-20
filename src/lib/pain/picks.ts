/**
 * The review's pain step as state (pure, tested): the places picked on the
 * map or the list, each with its own answers, and how they become the reports
 * the server saves. Kept apart from the sheet so the rules are tested once.
 */
import { regionFromName, regionOf, type PainSide } from "@/lib/pain/regions";
import { cleanReports, severityOf, type Change, type PainReportInput, type Severity } from "@/lib/pain/report";
import type { FollowUp, PainEntry } from "@/lib/pain/history";

export type PainPick = Omit<PainReportInput, "severity"> & {
  uid: string;
  severity: Severity | null;
  /** The optional details are showing. */
  open?: boolean;
};

let seq = 0;
const uid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newPick(region: string, side: PainSide | null): PainPick {
  return { uid: uid(), region, side, severity: null, feel: [], open: region === "other" };
}

/** A tap on the map or the list: add the place, or take it off if it's there. */
export function togglePick(picks: PainPick[], place: { region: string; side: PainSide | null }): PainPick[] {
  const i = picks.findIndex((p) => p.region === place.region && (p.side ?? null) === (place.side ?? null));
  if (i >= 0) return picks.filter((_, j) => j !== i);
  // a midline place is one pick whatever side its details say
  const r = regionOf(place.region);
  if (r && !r.sided && place.region !== "other" && picks.some((p) => p.region === place.region)) return picks.filter((p) => p.region !== place.region);
  return [...picks, newPick(place.region, place.side)];
}

export function updatePick(picks: PainPick[], id: string, patch: Partial<PainPick>): PainPick[] {
  return picks.map((p) => (p.uid === id ? { ...p, ...patch } : p));
}

/**
 * "Since <date>?": better / same / worse means it's the same issue (linked to
 * that report, and what they said then fills in what they haven't said now);
 * "new" means it isn't; tapping the chosen answer again clears it.
 */
export function answerFollowUp(p: PainPick, choice: Change | "new", prior: FollowUp): Partial<PainPick> {
  const current = p.sameIssue === false ? "new" : p.sameIssue ? p.change : null;
  if (current === choice) return { sameIssue: null, change: null, continuesId: null };
  if (choice === "new") return { sameIssue: false, change: null, continuesId: null };
  return {
    sameIssue: true,
    change: choice,
    continuesId: prior.stored ? prior.id : null,
    trigger: p.trigger ?? prior.trigger ?? null,
    exerciseName: p.exerciseName ?? prior.exerciseName ?? null,
    feel: p.feel?.length ? p.feel : prior.feel,
  };
}

/** The picks to send (places with a severity; the sheet won't finish with one missing). */
export function picksToReports(picks: PainPick[]): PainReportInput[] {
  return cleanReports(picks.filter((p) => p.severity).map(({ uid: _uid, open: _open, ...p }) => ({ ...p, severity: p.severity! })));
}

/** Editing a review: its saved places. */
export function picksFromEntries(entries: PainEntry[], feedbackId: string): PainPick[] {
  return entries
    .filter((e) => e.stored && e.feedbackId === feedbackId)
    .map((e) => ({
      uid: uid(),
      region: e.region,
      side: e.side,
      severity: e.severity,
      trigger: e.trigger,
      exerciseName: e.exerciseName,
      feel: e.feel,
      impact: e.impact,
      sameIssue: e.sameIssue,
      change: e.change,
      continuesId: e.continuesId,
      note: e.note,
    }));
}

/** Editing an older review that has only its pain_area text: its places, each at the review's level. */
export function picksFromLegacy(painArea: string | null | undefined, level: number | null | undefined): PainPick[] {
  const out: PainPick[] = [];
  const sev = severityOf(level ?? null);
  for (const token of (painArea ?? "").split(",")) {
    const t = token.trim();
    if (!t) continue;
    const m = /^(.+?)\s*\((L|R)\)$/.exec(t);
    const region = regionFromName((m ? m[1] : t).trim());
    const side: PainSide | null = m?.[2] === "L" ? "L" : m?.[2] === "R" ? "R" : null;
    if (region) {
      if (!out.some((p) => p.region === region && p.side === side)) out.push({ ...newPick(region, side), severity: sev, open: false });
    } else if (!/^general$/i.test(t)) {
      out.push({ ...newPick("other", null), severity: sev, note: /^other$/i.test(t) ? null : t, open: false });
    }
  }
  return out;
}

/** "region:side" keys of places reported recently, for the map's dots (a sided place with no side marks both). */
export function recentPlaces(entries: PainEntry[], feedbackId?: string | null): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (feedbackId && e.feedbackId === feedbackId) continue;
    const r = regionOf(e.region);
    if (!r || e.region === "other") continue;
    if (r.sided && !e.side) {
      out.add(`${e.region}:L`);
      out.add(`${e.region}:R`);
    } else out.add(`${e.region}:${r.sided ? e.side : "-"}`);
  }
  return out;
}
