/**
 * The review's pain step as state (pure, tested): the places picked on the
 * map or the list, each with its own answers, and how they become the reports
 * the server saves. Kept apart from the sheet so the rules are tested once.
 */
import { regionFromName, regionOf, type PainSide } from "@/lib/pain/regions";
import { cleanReports, severityFromScore, severityLevel, severityOf, type Change, type PainReportInput, type Severity } from "@/lib/pain/report";
import { siteOf } from "@/lib/pain/sites";
import type { FollowUp, PainEntry } from "@/lib/pain/history";
import type { DescribedDetail, DescribedPlace } from "@/lib/pain/describe";

export type PainPick = Omit<PainReportInput, "severity"> & {
  uid: string;
  severity: Severity | null;
  /** The optional details are showing. */
  open?: boolean;
  /** They said they're not sure how bad (no number stands in for it). */
  unsure?: boolean;
  /** The 0–10 came from what they said or typed (a later description may change it); a tapped one is never overwritten. */
  scoreSaid?: boolean;
};

let seq = 0;
const uid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export type PainPlace = { region: string; side: PainSide | null; site?: string | null };

export function newPick(region: string, side: PainSide | null, site: string | null = null): PainPick {
  return { uid: uid(), region, side, site, severity: null, score: null, timing: [], feel: [], open: region === "other" };
}

/** The same place: region, side and spot. */
export function samePlace(p: PainPlace, q: PainPlace): boolean {
  return p.region === q.region && (p.side ?? null) === (q.side ?? null) && (p.site ?? null) === (q.site ?? null);
}

/**
 * A tap on a spot of the body map or a row of the list: the place is added (or,
 * if it's there already, found), and its id comes back so its details open.
 * A tap never takes a place off: that's the ✕ on it (a slip of the thumb
 * shouldn't throw away what was rated).
 */
export function addPick(picks: PainPick[], place: PainPlace): { picks: PainPick[]; uid: string } {
  const site = siteOf(place.site);
  const norm: PainPlace = { region: place.region, side: site?.midline ? null : place.side ?? null, site: site ? site.key : null };
  const found = picks.find((p) => samePlace(p, norm));
  if (found) return { picks, uid: found.uid };
  const p = newPick(norm.region, norm.side, norm.site ?? null);
  return { picks: [...picks, p], uid: p.uid };
}

/** How bad, 0–10, tapped: the stored band follows it. */
export function scorePatch(score: number): Partial<PainPick> {
  return { score, severity: severityFromScore(score), unsure: false, scoreSaid: false };
}

/** "Unsure": no number, and nothing stands in for one. */
export function unsurePatch(): Partial<PainPick> {
  return { score: null, severity: null, unsure: true, scoreSaid: false };
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

/** The picks to send (places rated 0–10, a band, or "not sure"; the review won't finish with one unanswered). */
export function picksToReports(picks: PainPick[]): PainReportInput[] {
  return cleanReports(
    picks
      .filter((p) => p.severity || typeof p.score === "number" || p.unsure)
      .map(({ uid: _uid, open: _open, unsure: _unsure, scoreSaid: _said, ...p }) => ({
        ...p,
        severity: typeof p.score === "number" ? severityFromScore(p.score) : p.severity ?? null,
      })),
  );
}

/** A place with no number or band (it may still be answered "not sure"). */
export function unrated(p: Pick<PainPick, "score" | "severity">): boolean {
  return typeof p.score !== "number" && !p.severity;
}

/** A place still waiting for how bad: no number and not "not sure". */
export function needsScore(p: Pick<PainPick, "score" | "severity" | "unsure">): boolean {
  return unrated(p) && !p.unsure;
}

export type PickGap = "where" | "side" | "score";

/**
 * What a place still needs before the review can finish, in the order it's
 * asked: where (somewhere else, with nothing said), which side (a knee, an
 * elbow), how bad (or "not sure"). Everything else is optional.
 */
export function pickGaps(p: PainPick): PickGap[] {
  const out: PickGap[] = [];
  if (p.region === "other" && !p.note?.trim()) out.push("where");
  if (pickSided(p) && !p.side) out.push("side");
  if (needsScore(p)) out.push("score");
  return out;
}

/** The first thing missing across the places (null: the pain report is complete). */
export function firstGap(picks: PainPick[]): { uid: string; gap: PickGap } | null {
  for (const p of picks) {
    const g = pickGaps(p)[0];
    if (g) return { uid: p.uid, gap: g };
  }
  return null;
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
      // a stored place with neither was answered "not sure"
      unsure: e.score == null && !e.severity,
      timing: e.timing,
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

/** Two descriptions of one place that can't be the same thing: different numbers, symptoms or lifts. */
function differs(p: PainPick, d: DescribedPlace): boolean {
  if (typeof p.score === "number" && d.score != null && p.score !== d.score && !p.scoreSaid) return true;
  if ((p.feel ?? []).length && d.feel.length && !d.feel.some((f) => (p.feel ?? []).includes(f))) return true;
  if (p.exerciseName && d.exerciseName && p.exerciseName !== d.exerciseName) return true;
  return false;
}

/**
 * The places a description is about, among those already picked: the same
 * place, or the same region where one side of it is less specific (no spot,
 * no side yet) and nothing said contradicts it. "My knee" then "it's below
 * the kneecap, the left one" is one place: the left patellar tendon.
 */
export function matchingPicks(picks: PainPick[], d: DescribedPlace): PainPick[] {
  if (d.region === "other") return [];
  const site = siteOf(d.site);
  const side = site?.midline ? null : d.side ?? null;
  const same = picks.filter((p) => p.region === d.region && (p.site ?? null) === (d.site ?? null) && (p.side ?? null) === side);
  if (same.length) return same;
  return picks.filter(
    (p) =>
      p.region === d.region &&
      ((p.site ?? null) === (d.site ?? null) || p.site == null || d.site == null) &&
      (p.side == null || side == null || p.side === side) &&
      !differs(p, d),
  );
}

function fill(p: PainPick, d: { score: number | null; feel: PainPick["feel"]; timing: PainPick["timing"]; exerciseName: string | null; exerciseId: string | null; impact: PainPick["impact"]; note: string }, opts: { score: boolean }): Partial<PainPick> {
  const patch: Partial<PainPick> = {};
  // a number they said fills an empty place, or replaces one they said before (never one they tapped)
  if (opts.score && d.score != null && (needsScore(p) || p.unsure || p.scoreSaid)) Object.assign(patch, scorePatch(d.score), { scoreSaid: true });
  const feel = [...new Set([...(p.feel ?? []), ...(d.feel ?? [])])];
  if (feel.length !== (p.feel ?? []).length) patch.feel = feel;
  const timing = [...new Set([...(p.timing ?? []), ...(d.timing ?? [])])];
  if (timing.length !== (p.timing ?? []).length) patch.timing = timing;
  if (d.exerciseName && !p.exerciseName) {
    patch.exerciseName = d.exerciseName;
    patch.exerciseId = d.exerciseId;
  }
  if (d.impact && !p.impact) patch.impact = d.impact;
  const words = d.note.trim();
  if (words && !(p.note ?? "").includes(words)) patch.note = (p.note ? `${p.note} ${words}` : words).slice(0, 300);
  return patch;
}

/**
 * What a description read (typed or said), as the review's places: each one
 * joins the place it's about when it's already there (filling what's empty,
 * a spot or a side making it more exact), else it's added. A rating only when
 * they said one; their words kept as its note. Saying more later ("and it's
 * sharp", "actually the right") never makes a second place for the same
 * thing. "Getting worse" counts only as an answer to "since last time" when
 * there is a last time (`prior`).
 */
export function applyDescribed(
  picks: PainPick[],
  places: DescribedPlace[],
  prior?: (place: { region: string; side: PainSide | null; site: string | null }) => FollowUp | null,
): { picks: PainPick[]; uids: string[] } {
  let next = picks;
  const uids: string[] = [];
  for (const d of places) {
    let targets = matchingPicks(next, d);
    if (!targets.length) {
      const res = addPick(next, { region: d.region, side: d.side, site: d.site });
      next = res.picks;
      targets = next.filter((p) => p.uid === res.uid);
    }
    for (const p of targets) {
      const patch = fill(p, d, { score: targets.length === 1 || needsScore(p) });
      // more exact: a spot for a place that had none, a side for one that had none (never one that's already picked)
      const site = siteOf(d.site);
      const exactSite = targets.length === 1 && p.site == null && site ? site.key : null;
      const exactSide = targets.length === 1 && p.side == null && d.side && !site?.midline ? d.side : null;
      if (exactSite || exactSide) {
        const want = { region: p.region, site: exactSite ?? p.site ?? null, side: exactSide ?? p.side ?? null };
        if (!next.some((q) => q.uid !== p.uid && samePlace(q, want))) {
          if (exactSite) patch.site = exactSite;
          if (exactSide) patch.side = exactSide;
        }
      }
      if (d.change && p.sameIssue == null && prior) {
        const merged = { ...p, ...patch };
        const f = prior({ region: merged.region, side: merged.side ?? null, site: merged.site ?? null });
        if (f) Object.assign(patch, answerFollowUp(merged, d.change, f));
      }
      next = updatePick(next, p.uid, patch);
      if (!uids.includes(p.uid)) uids.push(p.uid);
    }
  }
  return { picks: next, uids };
}

/**
 * Something said about no place of its own ("it's sharp, about a 6"): it's
 * about the places it's given (the one open, else the only one, else the
 * ones just described). A number goes only to one place.
 */
export function applyDetail(picks: PainPick[], detail: DescribedDetail, uids: string[]): PainPick[] {
  const targets = picks.filter((p) => uids.includes(p.uid));
  let next = picks;
  for (const p of targets) next = updatePick(next, p.uid, fill(p, detail, { score: targets.length === 1 }));
  return next;
}

/**
 * Move a place somewhere else on the body (picked again on the map): what was
 * said about it stays; if that place is already picked, the two become one.
 */
export function replacePlace(picks: PainPick[], id: string, place: PainPlace): { picks: PainPick[]; uid: string } {
  const p = picks.find((x) => x.uid === id);
  if (!p) return addPick(picks, place);
  const site = siteOf(place.site);
  const norm = { region: place.region, side: site?.midline ? null : place.side ?? null, site: site ? site.key : null };
  const other = picks.find((x) => x.uid !== id && samePlace(x, norm));
  // "since last time" was asked about the old place
  const moved: Partial<PainPick> = { ...norm, sameIssue: null, change: null, continuesId: null };
  if (other) {
    const merged = fill(other, { score: pickScore(p), feel: p.feel, timing: p.timing, exerciseName: p.exerciseName ?? null, exerciseId: p.exerciseId ?? null, impact: p.impact ?? null, note: p.note ?? "" }, { score: needsScore(other) });
    return { picks: updatePick(picks.filter((x) => x.uid !== id), other.uid, merged), uid: other.uid };
  }
  return { picks: updatePick(picks, id, moved), uid: id };
}
