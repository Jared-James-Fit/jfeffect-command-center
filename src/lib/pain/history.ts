/**
 * Pain over time: every report an athlete made, read as one history (pure,
 * tested). The coach's sheet and dashboard card, the chat card's line, the
 * weekly check-in AI and the training AI's health profile all read this, so
 * they never disagree.
 *
 * What it says is what was reported, never what it is: a place that keeps
 * coming up is "recurring", never "the same injury". Two reports are one issue
 * only when the athlete said so ("Same as Nov 16?": `sameIssue`). Trends come
 * from what they said first (better / same / worse), then from how bad each
 * report was.
 *
 * Sources: `pain_reports` (the review's body map and the check-in, Nov 2026
 * on), and older reports read as they were stored: the review's pain_area
 * chips with its note, and the weekly check-in's typed "pain details". A place
 * read from someone's words is marked `inferred`; the first review's "General"
 * (v1 "Need attention", which was mostly sickness, periods and stress) counts
 * only when its note names a body part.
 */
import { areaLabel, regionFromName, regionOf, regionsInText, type PainSide } from "@/lib/pain/regions";
import { severityOf, severityRank, type Change, type Feel, type Impact, type Severity, type Timing, type Trigger } from "@/lib/pain/report";
import { siteOf } from "@/lib/pain/sites";

export type PainEntry = {
  /** pain_reports.id, or a made-up id for an older report ("fb:<feedback id>:0"). */
  id: string;
  /** Real pain_reports row (can be linked to by a later report). */
  stored: boolean;
  /** YYYY-MM-DD in the athlete's clock. */
  date: string;
  /** When it was reported (orders two on one day). */
  at: string;
  source: "review" | "checkin" | "legacy";
  feedbackId: string | null;
  dayId: string | null;
  region: string;
  side: PainSide | null;
  /** The exact spot on the body map (sites.ts), when they picked one. */
  site: string | null;
  severity: Severity | null;
  /** 0–10 (the review from Nov 21 2026). */
  score: number | null;
  /** When it hurts: during exercise, after training, at rest, certain movements. */
  timing: Timing[];
  trigger: Trigger | null;
  exerciseName: string | null;
  feel: Feel[];
  impact: Impact | null;
  sameIssue: boolean | null;
  change: Change | null;
  continuesId: string | null;
  note: string | null;
  /** The place was read from their words, not picked. */
  inferred: boolean;
};

export const WINDOW_DAYS = 84;
export const RECENT_DAYS = 42;
/** A place not reported for this long has gone quiet. */
export const QUIET_DAYS = 21;

// ── reading what's stored ────────────────────────────────────────────────

export type PainReportRow = {
  id: string;
  client_id?: string;
  feedback_id: string | null;
  checkin_id?: string | null;
  day_id: string | null;
  reported_on: string;
  reported_at: string;
  source: string;
  region: string;
  side: string | null;
  site?: string | null;
  severity: string;
  score?: number | null;
  timing?: string[] | null;
  trigger: string | null;
  exercise_name: string | null;
  feel: string[] | null;
  impact: string | null;
  same_issue: boolean | null;
  change: string | null;
  continues_id: string | null;
  note: string | null;
};

const asSide = (s: string | null | undefined): PainSide | null => (s === "L" || s === "R" ? s : null);

export function entriesFromReports(rows: PainReportRow[]): PainEntry[] {
  return rows.map((r) => ({
    id: r.id,
    stored: true,
    date: String(r.reported_on).slice(0, 10),
    at: r.reported_at,
    source: r.source === "checkin" ? "checkin" : "review",
    feedbackId: r.feedback_id,
    dayId: r.day_id,
    region: regionOf(r.region) ? r.region : "other",
    side: asSide(r.side),
    site: siteOf(r.site) ? r.site! : null,
    severity: (["mild", "moderate", "severe"] as const).includes(r.severity as Severity) ? (r.severity as Severity) : null,
    score: typeof r.score === "number" ? r.score : null,
    timing: ((r.timing ?? []) as Timing[]).filter((t) => ["during", "after", "rest", "movement"].includes(t)),
    trigger: (r.trigger as Trigger) ?? null,
    exerciseName: r.exercise_name ?? null,
    feel: (r.feel ?? []) as Feel[],
    impact: (r.impact as Impact) ?? null,
    sameIssue: r.same_issue ?? null,
    change: (r.change as Change) ?? null,
    continuesId: r.continues_id ?? null,
    note: r.note ?? null,
    inferred: false,
  }));
}

export type LegacyFeedbackRow = {
  id: string;
  day_id: string | null;
  created_at: string;
  pain_area: string | null;
  pain_level: number | null;
  client_note: string | null;
  pain_note?: string | null;
  review_version?: number | null;
};

/** A date in the athlete's clock (falls back to UTC). */
export function localDay(iso: string, tz?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Older reviews (pain_area text) that have no structured reports. Each chip is
 * a place; "Other" and "General" read their note for the place, and a note
 * that names none keeps the report as "somewhere else" (Other) or drops it
 * (General: the first review's catch-all for feeling off).
 */
export function entriesFromLegacyFeedback(rows: LegacyFeedbackRow[], opts: { tz?: string | null; covered?: Set<string> } = {}): PainEntry[] {
  const out: PainEntry[] = [];
  for (const f of rows) {
    if (opts.covered?.has(f.id)) continue;
    const note = [f.pain_note, f.client_note].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ") || null;
    const places: { region: string; side: PainSide | null; inferred: boolean }[] = [];
    let general = false;
    let other = false;
    for (const token of (f.pain_area ?? "").split(",")) {
      const t = token.trim();
      if (!t) continue;
      const m = /^(.+?)\s*\((L|R)\)$/.exec(t);
      const name = (m ? m[1] : t).trim();
      if (/^general$/i.test(name)) { general = true; continue; }
      if (/^other$/i.test(name)) { other = true; continue; }
      const region = regionFromName(name);
      if (region) places.push({ region, side: asSide(m?.[2]), inferred: false });
      else other = true;
    }
    if (general || other) {
      const named = regionsInText(note).map((p) => ({ ...p, inferred: true }));
      if (named.length) places.push(...named);
      else if (other) places.push({ region: "other", side: null, inferred: false });
    }
    const date = localDay(f.created_at, opts.tz);
    places.forEach((p, i) =>
      out.push({
        id: `fb:${f.id}:${i}`,
        stored: false,
        date,
        at: f.created_at,
        source: "legacy",
        feedbackId: f.id,
        dayId: f.day_id,
        region: p.region,
        side: p.side,
        site: null,
        severity: severityOf(f.pain_level),
        score: null,
        timing: [],
        trigger: null,
        exerciseName: null,
        feel: [],
        impact: null,
        sameIssue: null,
        change: null,
        continuesId: null,
        note,
        inferred: p.inferred,
      }),
    );
  }
  return out;
}

export type LegacyCheckinRow = { id: string; created_at: string; submitted_at?: string | null; pain_details: string | null };

/** The weekly check-in's typed "where does it hurt" (before it had the body map). */
export function entriesFromCheckinText(rows: LegacyCheckinRow[], opts: { tz?: string | null; covered?: Set<string> } = {}): PainEntry[] {
  const out: PainEntry[] = [];
  for (const c of rows) {
    if (opts.covered?.has(c.id)) continue;
    const text = (c.pain_details ?? "").trim();
    if (!text) continue;
    const at = c.submitted_at ?? c.created_at;
    const places = regionsInText(text);
    (places.length ? places : [{ region: "other", side: null }]).forEach((p, i) =>
      out.push({
        id: `ci:${c.id}:${i}`,
        stored: false,
        date: localDay(at, opts.tz),
        at,
        source: "checkin",
        feedbackId: null,
        dayId: null,
        region: p.region,
        side: p.side,
        site: null,
        severity: null,
        score: null,
        timing: [],
        trigger: null,
        exerciseName: null,
        feel: [],
        impact: null,
        sameIssue: null,
        change: null,
        continuesId: null,
        note: text,
        inferred: places.length > 0,
      }),
    );
  }
  return out;
}

// ── the history ──────────────────────────────────────────────────────────

export type AreaStatus = "new" | "recurring" | "persistent" | "quiet";
export type Trend = "better" | "same" | "worse" | null;

export type CoachReason =
  | "red_flag"
  | "severe"
  | "stopped"
  | "worse"
  | "persistent"
  | "limiting"
  | "exercise";

export type PainArea = {
  /** The region (one thread per region: both sides and "side not said" together, each counted). */
  region: string;
  label: string;
  /** Reports per side: { L: 2, R: 3, none: 5 }. */
  sides: { L: number; R: number; none: number };
  entries: PainEntry[];
  /** Distinct days it was reported, whole window / last RECENT_DAYS. */
  days: number;
  recentDays: number;
  /** Distinct weeks it came up in the last RECENT_DAYS. */
  recentWeeks: number;
  first: string;
  last: string;
  /** First report in the last RECENT_DAYS (or the first ever). */
  recentFirst: string;
  latest: PainEntry;
  latestSeverity: Severity | null;
  worstRecent: Severity | null;
  status: AreaStatus;
  trend: Trend;
  /** Where the trend came from: what they said, or how bad each report was. */
  trendFrom: "client" | "severity" | null;
  /** Changed or stopped a session in the last 4 weeks. */
  limiting: { modified: number; stopped: number };
  /** Exercises they named for it, most named first. */
  named: { name: string; count: number }[];
  feel: Feel[];
  /** The spots they picked in it, most reported first ("side_delt" 3×). */
  sites: { site: string; count: number }[];
  /** The latest 0–10 (when the latest report had one). */
  latestScore: number | null;
  /** When it hurts, across the recent reports. */
  timing: Timing[];
  /** Reasons the coach should look, most pressing first (empty = nothing to act on). */
  reasons: CoachReason[];
  /** One report, mild or sore, nothing else: an isolated discomfort. */
  minor: boolean;
};

export type PainHistory = {
  today: string;
  areas: PainArea[];
  /** Areas that want the coach, most pressing first. */
  flagged: PainArea[];
  /** Latest report anywhere (ISO), for "reviewed through". */
  latestAt: string | null;
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function weekOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

const REASON_ORDER: CoachReason[] = ["red_flag", "severe", "stopped", "worse", "persistent", "limiting", "exercise"];

/** Red flags in a set of reports (safety.ts words them). */
export function hasRedFlag(e: PainEntry): boolean {
  if (e.feel.includes("numb")) return true;
  if (e.feel.includes("pop") && (e.severity === "severe" || e.feel.includes("swollen") || e.impact === "stopped")) return true;
  if (e.feel.includes("swollen") && e.severity === "severe") return true;
  if (e.region === "chest" && (e.trigger === "daily" || e.trigger === "unsure") && severityRank(e.severity) >= 2) return true;
  if (severeAtRest(e)) return true;
  return false;
}

/** Severe pain that's there at rest, not only when training: worth an assessment. */
export function severeAtRest(e: Pick<PainEntry, "timing" | "severity" | "score">): boolean {
  return e.timing.includes("rest") && (e.score != null ? e.score >= 7 : e.severity === "severe");
}

function trendOf(list: PainEntry[]): { trend: Trend; from: "client" | "severity" | null } {
  const latest = list[list.length - 1];
  // what they said about it last, while it's the latest thing said
  if (latest?.sameIssue && latest.change) return { trend: latest.change, from: "client" };
  if (list.length < 2) return { trend: null, from: null };
  const prev = [...list].reverse().find((e) => e !== latest && e.severity && (!latest.side || !e.side || e.side === latest.side));
  if (!prev?.severity || !latest.severity) return { trend: null, from: null };
  const d = severityRank(latest.severity) - severityRank(prev.severity);
  return { trend: d > 0 ? "worse" : d < 0 ? "better" : "same", from: "severity" };
}

/**
 * The history. `entries` may hold anything; only the last WINDOW_DAYS count.
 * Ordered: areas that want the coach first, then the most reported.
 */
export function buildPainHistory(entries: PainEntry[], today: string): PainHistory {
  const from = addDays(today, -WINDOW_DAYS);
  const recentFrom = addDays(today, -RECENT_DAYS);
  const groups = new Map<string, PainEntry[]>();
  for (const e of entries) {
    if (e.date < from || e.date > today) continue;
    // "somewhere else" isn't one place: each one stands alone
    const key = e.region === "other" ? `other:${e.id}` : e.region;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const areas: PainArea[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
    const latest = list[list.length - 1];
    const recent = list.filter((e) => e.date >= recentFrom);
    const days = new Set(list.map((e) => e.date)).size;
    const recentDays = new Set(recent.map((e) => e.date)).size;
    const recentWeeks = new Set(recent.map((e) => weekOf(e.date))).size;
    const sides = { L: 0, R: 0, none: 0 };
    for (const e of list) sides[e.side ?? "none"]++;
    let worstRecent: Severity | null = null;
    for (const e of recent) if (severityRank(e.severity) > severityRank(worstRecent)) worstRecent = e.severity;
    const quietFor = daysBetween(latest.date, today);
    const span = recent.length ? daysBetween(recent[0].date, latest.date) : 0;
    const status: AreaStatus =
      quietFor > QUIET_DAYS ? "quiet"
      : recentDays >= 3 && (recentWeeks >= 3 || span >= 14) ? "persistent"
      : days >= 2 ? "recurring"
      : "new";
    const { trend, from: trendFrom } = trendOf(list);
    const limitFrom = addDays(today, -28);
    const limiting = { modified: 0, stopped: 0 };
    for (const e of list) {
      if (e.date < limitFrom) continue;
      if (e.impact === "modified") limiting.modified++;
      if (e.impact === "stopped") limiting.stopped++;
    }
    const namedMap = new Map<string, number>();
    for (const e of list) if (e.exerciseName) namedMap.set(e.exerciseName, (namedMap.get(e.exerciseName) ?? 0) + 1);
    const named = [...namedMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const feel = [...new Set(recent.flatMap((e) => e.feel))];
    const siteMap = new Map<string, number>();
    for (const e of list) if (e.site) siteMap.set(e.site, (siteMap.get(e.site) ?? 0) + 1);
    const sites = [...siteMap.entries()].map(([site, count]) => ({ site, count })).sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
    const timing = [...new Set(recent.flatMap((e) => e.timing))];

    // why the coach should look: only what's recent, and nothing for a place gone quiet
    const reasons = new Set<CoachReason>();
    if (status !== "quiet") {
      const fresh = addDays(today, -14);
      if (recent.some((e) => e.date >= fresh && hasRedFlag(e))) reasons.add("red_flag");
      if (recent.some((e) => e.date >= fresh && e.severity === "severe")) reasons.add("severe");
      if (recent.some((e) => e.date >= fresh && e.impact === "stopped")) reasons.add("stopped");
      if (trend === "worse" && (trendFrom === "client" || recentDays >= 2)) reasons.add("worse");
      if (status === "persistent") reasons.add("persistent");
      if (limiting.modified >= 2) reasons.add("limiting");
      if (named.some((n) => n.count >= 2) && recentDays >= 2) reasons.add("exercise");
    }
    const minor = days === 1 && reasons.size === 0 && (latest.severity === "mild" || latest.feel.every((f) => f === "sore" || f === "tight"));

    areas.push({
      region: latest.region,
      label: latest.region === "other" ? (latest.note?.slice(0, 40) || "Somewhere else") : regionLabel(latest.region, sides),
      sides,
      entries: list,
      days,
      recentDays,
      recentWeeks,
      first: list[0].date,
      last: latest.date,
      recentFirst: recent[0]?.date ?? list[0].date,
      latest,
      latestSeverity: latest.severity,
      worstRecent,
      status,
      trend,
      trendFrom,
      limiting,
      named,
      feel,
      sites,
      latestScore: latest.score,
      timing,
      reasons: REASON_ORDER.filter((r) => reasons.has(r)),
      minor,
    });
  }

  const weight = (a: PainArea) => (a.reasons.length ? 100 - REASON_ORDER.indexOf(a.reasons[0]) * 10 : 0);
  areas.sort((a, b) => weight(b) - weight(a) || b.recentDays - a.recentDays || b.last.localeCompare(a.last));
  const latestAt = entries.reduce<string | null>((m, e) => (e.date >= from && (!m || e.at > m) ? e.at : m), null);
  return { today, areas, flagged: areas.filter((a) => a.reasons.length > 0), latestAt };
}

/** "Shoulder" with one side when every report said the same one ("Left shoulder"). */
function regionLabel(region: string, sides: { L: number; R: number; none: number }): string {
  if (sides.L && !sides.R && !sides.none) return areaLabel(region, "L");
  if (sides.R && !sides.L && !sides.none) return areaLabel(region, "R");
  return areaLabel(region, null);
}

/** "left 2×, right 3×" — only when the sides differ. */
export function sidesLine(a: Pick<PainArea, "sides" | "region">): string | null {
  const r = regionOf(a.region);
  if (!r?.sided) return null;
  const parts = [a.sides.L ? `left ${a.sides.L}×` : null, a.sides.R ? `right ${a.sides.R}×` : null, a.sides.none ? `side not said ${a.sides.none}×` : null].filter(Boolean);
  return parts.length > 1 ? parts.join(", ") : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

export const REASON_WORDS: Record<CoachReason, string> = {
  red_flag: "a warning sign",
  severe: "severe",
  stopped: "stopped a session",
  worse: "getting worse",
  persistent: "keeps coming up",
  limiting: "changing sessions",
  exercise: "same exercise each time",
};

/**
 * One line for a card or row: "4× in 5 weeks · worse · bench 2×".
 * Reads the area as it stands, in the coach's words.
 */
export function areaSummary(a: PainArea): string {
  const parts: string[] = [];
  if (a.recentDays >= 2) parts.push(`${a.recentDays}× in ${weeksWord(daysBetween(a.recentFirst, a.last) + 1)}`);
  else if (a.days >= 2) parts.push(`${a.days}× since ${shortDay(a.first)}`);
  else parts.push(`first time · ${shortDay(a.last)}`);
  if (a.trend === "worse") parts.push("worse");
  else if (a.trend === "better") parts.push("better");
  if (a.latestSeverity === "severe") parts.push("severe");
  if (a.limiting.stopped) parts.push("stopped a session");
  else if (a.limiting.modified) parts.push(a.limiting.modified === 1 ? "changed a session" : `changed ${a.limiting.modified} sessions`);
  if (a.named[0]) parts.push(`${a.named[0].name}${a.named[0].count > 1 ? ` ${a.named[0].count}×` : ""}`);
  return parts.join(" · ");
}

function weeksWord(days: number): string {
  const w = Math.max(1, Math.ceil(days / 7));
  return w === 1 ? "a week" : `${w} weeks`;
}

export function reasonWords(r: CoachReason): string {
  return REASON_WORDS[r];
}

// ── the follow-up question in the review ────────────────────────────────

export type FollowUp = {
  /** The earlier report (a stored one can be linked to). */
  id: string;
  stored: boolean;
  date: string;
  /** The spot it was about, when they picked one. */
  site: string | null;
  score: number | null;
  severity: Severity | null;
  trigger: Trigger | null;
  exerciseName: string | null;
  feel: Feel[];
};

/**
 * The last time this place came up (in the last RECENT_DAYS, before this
 * review), so the review can ask "Same as Nov 16?" instead of the whole form.
 * A side must match, or either one not said.
 */
export function followUpFor(
  entries: PainEntry[],
  region: string,
  side: PainSide | null,
  opts: { today: string; feedbackId?: string | null; site?: string | null },
): FollowUp | null {
  if (region === "other") return null;
  const from = addDays(opts.today, -RECENT_DAYS);
  let best: PainEntry | null = null;
  let bestSame = false;
  for (const e of entries) {
    if (e.region !== region || e.date < from || e.date > opts.today) continue;
    if (opts.feedbackId && e.feedbackId === opts.feedbackId) continue;
    if (side && e.side && e.side !== side) continue;
    // the same spot beats another spot in the region; then the latest
    const same = !!opts.site && e.site === opts.site;
    if (!best || (same && !bestSame) || (same === bestSame && e.at > best.at)) {
      best = e;
      bestSame = same;
    }
  }
  if (!best) return null;
  return { id: best.id, stored: best.stored, date: best.date, site: best.site, score: best.score, severity: best.severity, trigger: best.trigger, exerciseName: best.exerciseName, feel: best.feel };
}
