/**
 * The review's pain step as state (pure, tested): the places picked on the
 * map or the list, each with its own answers, and how they become the reports
 * the server saves. Kept apart from the sheet so the rules are tested once.
 */
import { regionFromName, regionOf, type PainSide } from "@/lib/pain/regions";
import { cleanReports, severityFromScore, severityLevel, severityOf, type Change, type PainReportInput, type Severity } from "@/lib/pain/report";
import { siteOf } from "@/lib/pain/sites";
import type { FollowUp, PainEntry } from "@/lib/pain/history";
import type { DescribedPlace } from "@/lib/pain/describe";
import { symptomClass, limitsTraining } from "@/lib/pain/symptoms";

export type PainPick = Omit<PainReportInput, "severity"> & {
  uid: string;
  severity: Severity | null;
  /** The optional details are showing. */
  open?: boolean;
};

let seq = 0;
const uid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export type PainPlace = { region: string; side: PainSide | null; site?: string | null; symptom?: PainPick["symptom"] };

export function newPick(region: string, side: PainSide | null, site: string | null = null, symptom: PainPick["symptom"] = null): PainPick {
  return { uid: uid(), region, side, site, symptom, severity: null, score: null, timing: [], feel: [], open: region === "other" };
}

/** The same place: region, side, spot and (for a general symptom) which one. */
export function samePlace(p: PainPlace, q: PainPlace): boolean {
  return p.region === q.region && (p.side ?? null) === (q.side ?? null) && (p.site ?? null) === (q.site ?? null) && (p.symptom ?? null) === (q.symptom ?? null);
}

/**
 * A tap on a spot of the body map or a row of the list: the place is added (or,
 * if it's there already, found), and its id comes back so its details open.
 * A tap never takes a place off: that's the ✕ on it (a slip of the thumb
 * shouldn't throw away what was rated).
 */
export function addPick(picks: PainPick[], place: PainPlace): { picks: PainPick[]; uid: string } {
  const site = siteOf(place.site);
  const norm: PainPlace = { region: place.region, side: site?.midline ? null : place.side ?? null, site: site ? site.key : null, symptom: place.symptom ?? null };
  const found = picks.find((p) => samePlace(p, norm));
  if (found) return { picks, uid: found.uid };
  const p = newPick(norm.region, norm.side, norm.site ?? null, norm.symptom ?? null);
  return { picks: [...picks, p], uid: p.uid };
}

/** How bad, 0–10: the stored band follows it. */
export function scorePatch(score: number): Partial<PainPick> {
  return { score, severity: severityFromScore(score) };
}

/** The 0–10 to show for a place: its own, else its band's (an older report). */
export function pickScore(p: Pick<PainPick, "score" | "severity">): number | null {
  if (typeof p.score === "number") return p.score;
  return p.severity ? severityLevel(p.severity) : null;
}

/** A tap on the map or the list: add the place, or take it off if it's there. */
export function togglePick(picks: PainPick[], place: PainPlace): PainPick[] {
  const i = picks.findIndex((p) => samePlace(p, place));
  if (i >= 0) return picks.filter((_, j) => j !== i);
  // a midline place is one pick whatever side its details say
  const r = regionOf(place.region);
  if (r && !r.sided && place.region !== "other" && picks.some((p) => p.region === place.region)) return picks.filter((p) => p.region !== place.region);
  return [...picks, newPick(place.region, place.side, place.site ?? null)];
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

/**
 * Does how bad (0–10) change what happens with this place? Only for pain, a
 * joint or tendon, or numbness (it decides the safety notice, recovery's cap
 * and whether the coach is asked to look). Soreness, tightness, tired muscles
 * and a general symptom are kept without one: never a question that changes
 * nothing.
 */
export function needsRating(p: Pick<PainPick, "region" | "site" | "feel" | "timing" | "symptom" | "score" | "severity">): boolean {
  return limitsTraining(symptomClass({ ...p, score: null, severity: null }));
}

/** The picks to send (rated, or a kind that needs no rating; the review won't finish with one missing). */
export function picksToReports(picks: PainPick[]): PainReportInput[] {
  return cleanReports(
    picks
      .filter((p) => p.severity || typeof p.score === "number" || !needsRating(p))
      .map(({ uid: _uid, open: _open, ...p }) => ({ ...p, severity: typeof p.score === "number" ? severityFromScore(p.score) : p.severity ?? null })),
  );
}

/** A place still waiting for how bad (only when it matters: needsRating). */
export function unrated(p: Pick<PainPick, "score" | "severity"> & Partial<Pick<PainPick, "region" | "site" | "feel" | "timing" | "symptom">>): boolean {
  if (typeof p.score === "number" || p.severity) return false;
  // older callers pass only the rating: it's waiting
  if (p.region == null) return true;
  return needsRating(p as PainPick);
}

/** Editing a review: its saved places. */
export function picksFromEntries(entries: PainEntry[], feedbackId: string): PainPick[] {
  return entries
    .filter((e) => e.stored && e.feedbackId === feedbackId)
    .map((e) => ({
      uid: uid(),
      region: e.region,
      side: e.side,
      site: e.site,
      severity: e.severity,
      score: e.score,
      timing: e.timing,
      trigger: e.trigger,
      exerciseName: e.exerciseName,
      feel: e.feel,
      impact: e.impact,
      sameIssue: e.sameIssue,
      change: e.change,
      continuesId: e.continuesId,
      note: e.note,
      symptom: (e.symptom ?? null) as PainPick["symptom"],
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

/** "site:side" keys of spots reported recently (the map's dots). */
export function recentSites(entries: PainEntry[], feedbackId?: string | null): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (feedbackId && e.feedbackId === feedbackId) continue;
    if (!e.site) continue;
    out.add(`${e.site}:${siteOf(e.site)?.midline ? "-" : e.side ?? "-"}`);
  }
  return out;
}

// ── Left · Right · Both ─────────────────────────────────────────────────
//
// A spot that comes in pairs can be one side or both. Both is two places
// (each its own report, rated on its own: "Left knee 5/10, Right knee
// 3/10") that share everything else they said; a change to what it feels
// like, when it hurts, which exercise or a note goes to both.

export type SideChoice = "L" | "R" | "both";

/** What both sides share; how bad and "since last time" stay each side's own. */
export const SHARED_FIELDS = ["feel", "timing", "trigger", "exerciseName", "exerciseId", "impact", "note"] as const;

export function oppositeSide(side: PainSide): PainSide {
  return side === "L" ? "R" : "L";
}

/** Does this place come in a left and a right? (A midline spot never does.) */
export function pickSided(p: Pick<PainPick, "region" | "site">): boolean {
  const s = siteOf(p.site);
  if (s) return !s.midline && !!regionOf(p.region)?.sided;
  return !!regionOf(p.region)?.sided;
}

/** The same spot on the other side, when it's picked too. */
export function mirrorOf(picks: PainPick[], p: PainPick): PainPick | null {
  if (!p.side || !pickSided(p)) return null;
  return picks.find((q) => q.uid !== p.uid && q.region === p.region && (q.site ?? null) === (p.site ?? null) && q.side === oppositeSide(p.side!)) ?? null;
}

/** What the side control shows for a place (null when it has no sides). */
export function sideChoiceOf(picks: PainPick[], p: PainPick): SideChoice | null {
  if (!pickSided(p)) return null;
  if (!p.side) return null;
  return mirrorOf(picks, p) ? "both" : p.side;
}

function shared(p: PainPick): Partial<PainPick> {
  const out: Partial<PainPick> = {};
  for (const k of SHARED_FIELDS) (out as any)[k] = Array.isArray(p[k]) ? [...(p[k] as any[])] : p[k];
  return out;
}

/**
 * Left, Right or Both for one place. Both adds the other side with what this
 * one said (and its rating as a starting point, changed with one tap); a
 * single side takes the other off, or moves this place there when it's the
 * only one. Returns the place whose details stay open.
 */
export function setSideChoice(picks: PainPick[], id: string, choice: SideChoice): { picks: PainPick[]; uid: string; removed: PainPick | null } {
  const p = picks.find((x) => x.uid === id);
  if (!p || !pickSided(p)) return { picks, uid: id, removed: null };
  const mirror = mirrorOf(picks, p);
  if (choice === "both") {
    if (!p.side) {
      // a place with no side yet: it's the left, and the right comes with it
      const left = { ...p, side: "L" as PainSide };
      const right: PainPick = { ...newPick(p.region, "R", p.site ?? null), ...shared(p), score: p.score ?? null, severity: p.severity ?? null };
      return { picks: [...picks.map((x) => (x.uid === id ? left : x)), right], uid: id, removed: null };
    }
    if (mirror) return { picks, uid: id, removed: null };
    const other: PainPick = { ...newPick(p.region, oppositeSide(p.side), p.site ?? null), ...shared(p), score: p.score ?? null, severity: p.severity ?? null };
    return { picks: [...picks, other], uid: id, removed: null };
  }
  if (p.side === choice) {
    if (!mirror) return { picks, uid: id, removed: null };
    return { picks: picks.filter((x) => x.uid !== mirror.uid), uid: id, removed: mirror };
  }
  // the other side
  if (mirror) return { picks: picks.filter((x) => x.uid !== id), uid: mirror.uid, removed: p };
  // a follow-up answer belonged to the side it was asked about
  return { picks: picks.map((x) => (x.uid === id ? { ...x, side: choice, sameIssue: null, change: null, continuesId: null } : x)), uid: id, removed: null };
}

/** A change to one place; the shared fields go to its other side too while both are picked. */
export function updatePaired(picks: PainPick[], id: string, patch: Partial<PainPick>): PainPick[] {
  const p = picks.find((x) => x.uid === id);
  const mirror = p ? mirrorOf(picks, p) : null;
  const sharedPatch: Partial<PainPick> = {};
  for (const k of SHARED_FIELDS) if (k in patch) (sharedPatch as any)[k] = (patch as any)[k];
  return picks.map((x) => (x.uid === id ? { ...x, ...patch } : mirror && x.uid === mirror.uid && Object.keys(sharedPatch).length ? { ...x, ...sharedPatch } : x));
}

/** Put a removed place back exactly where it was (Undo). */
export function restorePick(picks: PainPick[], removed: PainPick, index: number): PainPick[] {
  if (picks.some((p) => p.uid === removed.uid)) return picks;
  const at = Math.max(0, Math.min(index, picks.length));
  return [...picks.slice(0, at), removed, ...picks.slice(at)];
}

/**
 * What "Describe it" read, as the review's places: each one added (or, when
 * it's picked already, filled in where it's still empty), its rating only when
 * they said one, their words kept as its note. "Getting worse" counts only as
 * an answer to "since last time" when there is a last time (`prior`).
 */
export function applyDescribed(
  picks: PainPick[],
  places: DescribedPlace[],
  prior?: (place: { region: string; side: PainSide | null; site: string | null; symptom?: string | null }) => FollowUp | null,
): { picks: PainPick[]; uids: string[] } {
  let next = picks;
  const uids: string[] = [];
  for (const d of places) {
    const res = addPick(next, { region: d.region, side: d.side, site: d.site, symptom: d.symptom ?? null });
    next = res.picks;
    const p = next.find((x) => x.uid === res.uid)!;
    const patch: Partial<PainPick> = {};
    if (d.score != null && typeof p.score !== "number") Object.assign(patch, scorePatch(d.score));
    const feel = [...new Set([...(p.feel ?? []), ...d.feel])];
    if (feel.length !== (p.feel ?? []).length) patch.feel = feel;
    const timing = [...new Set([...(p.timing ?? []), ...d.timing])];
    if (timing.length !== (p.timing ?? []).length) patch.timing = timing;
    if (d.exerciseName && !p.exerciseName) {
      patch.exerciseName = d.exerciseName;
      patch.exerciseId = d.exerciseId;
    }
    if (d.impact && !p.impact) patch.impact = d.impact;
    const words = d.note.trim();
    if (words && !(p.note ?? "").includes(words)) patch.note = (p.note ? `${p.note} ${words}` : words).slice(0, 300);
    if (d.change && p.sameIssue == null && prior) {
      const f = prior({ region: p.region, side: p.side ?? null, site: p.site ?? null, symptom: p.symptom ?? null });
      if (f) Object.assign(patch, answerFollowUp({ ...p, ...patch }, d.change, f));
    }
    next = updatePick(next, res.uid, patch);
    if (!uids.includes(res.uid)) uids.push(res.uid);
  }
  return { picks: next, uids };
}
