/**
 * Recovery automation's rules (pure, tested): how risky a pain report is,
 * which modes a coach can pick, when a follow-up is due, and what an
 * automatically sent message may never say. The database holds the settings
 * and decides who may use them (cleo_has_feature, coach_automation_mode_for);
 * this file decides what a report means.
 *
 * Risk is deterministic, never a model:
 *   urgent  a warning sign that needs medical help now (safety.ts `urgent`)
 *   review  anything that could be an injury or needs the coach's judgment:
 *           any warning sign, a 6/10 or worse, a stopped session, "worse",
 *           pain that keeps coming back or limits training, a pop, swelling,
 *           numbness, a place they couldn't name
 *   routine everything else (mild to moderate, nothing alarming)
 * Only routine ever goes out by itself; review and urgent always wait for the
 * coach, whatever the settings say.
 */
import type { PainArea, PainEntry } from "@/lib/pain/history";
import { draftProblems } from "@/lib/pain/ai";
import type { RedFlag } from "@/lib/pain/safety";

export type AutomationCategory = "recovery_reply" | "recovery_follow_up";
export type AutomationMode = "off" | "manual" | "approval" | "automatic";
export type Risk = "routine" | "review" | "urgent";

export const CATEGORIES: { key: AutomationCategory; label: string; line: string }[] = [
  { key: "recovery_reply", label: "Replies to pain reports", line: "When a client reports pain in a workout review." },
  { key: "recovery_follow_up", label: "Follow-ups", line: "A short check before the next session that loads the area." },
];

export const MODES: { key: AutomationMode; label: string; line: string }[] = [
  { key: "off", label: "Off", line: "Nothing happens until you open their pain sheet." },
  { key: "manual", label: "Draft only", line: "A reply waits in their pain sheet. You send it yourself." },
  { key: "approval", label: "Ask me first", line: "A reply is queued. Approve it in one tap, or edit it." },
  { key: "automatic", label: "Send routine ones", line: "Routine reports get a reply right away. Anything that could be an injury still waits for you." },
];

/** The capability each mode needs (mirrors coach_automation_mode_allowed). */
export function modeNeeds(category: AutomationCategory, mode: AutomationMode): string[] {
  if (mode === "off") return [];
  const out = ["automation.approval_queue"];
  if (category === "recovery_follow_up") out.push("automation.follow_ups");
  if (mode === "automatic") out.push("automation.auto_send");
  return out;
}

export function modeAllowed(features: readonly string[], category: AutomationCategory, mode: AutomationMode): boolean {
  return modeNeeds(category, mode).every((f) => features.includes(f));
}

/** The default until a coach chooses: nothing is ever sent without them. */
export const DEFAULT_MODE: AutomationMode = "approval";

export function effectiveMode(opts: {
  features: readonly string[];
  category: AutomationCategory;
  paused: boolean;
  setting: AutomationMode | null | undefined;
  clientRule: AutomationMode | null | undefined;
}): AutomationMode {
  if (opts.paused) return "off";
  let m: AutomationMode = opts.clientRule ?? opts.setting ?? DEFAULT_MODE;
  if (m === "automatic" && !modeAllowed(opts.features, opts.category, "automatic")) m = "approval";
  if (m !== "off" && !modeAllowed(opts.features, opts.category, m)) m = "off";
  return m;
}

// ── risk ────────────────────────────────────────────────────────────────

const REASON: Record<string, string> = {
  urgent: "a warning sign that needs medical help now",
  red_flag: "a warning sign",
  score: "rated 6/10 or worse",
  stopped: "had to stop the session",
  worse: "getting worse",
  persistent: "keeps coming back",
  limiting: "changing their sessions",
  feel: "a pop, swelling or numbness",
  unplaced: "a place they couldn't name",
};

export function riskReasonWords(key: string): string {
  return REASON[key] ?? key;
}

/**
 * How a review's pain reads. `reports`: this review's places; `areas`: their
 * history for those regions (buildPainHistory); `flags`: safety.ts redFlags
 * over the same reports.
 */
export function classifyRecovery(reports: PainEntry[], areas: PainArea[], flags: RedFlag[]): { risk: Risk; reasons: string[] } {
  const reasons = new Set<string>();
  if (flags.some((f) => f.urgent)) reasons.add("urgent");
  if (flags.length) reasons.add("red_flag");
  for (const r of reports) {
    if ((r.score ?? 0) >= 6 || r.severity === "severe") reasons.add("score");
    if (r.impact === "stopped") reasons.add("stopped");
    if (r.change === "worse") reasons.add("worse");
    if (r.feel.some((f) => f === "pop" || f === "swollen" || f === "numb")) reasons.add("feel");
    if (r.region === "other") reasons.add("unplaced");
  }
  const regions = new Set(reports.map((r) => r.region));
  for (const a of areas) {
    if (!regions.has(a.region)) continue;
    if (a.reasons.includes("persistent")) reasons.add("persistent");
    if (a.reasons.includes("limiting")) reasons.add("limiting");
    if (a.reasons.includes("worse")) reasons.add("worse");
    if (a.reasons.includes("stopped")) reasons.add("stopped");
  }
  const list = [...reasons];
  if (reasons.has("urgent")) return { risk: "urgent", reasons: list };
  if (list.length) return { risk: "review", reasons: list };
  return { risk: "routine", reasons: [] };
}

/** What actually happens to a drafted reply, given the mode and the risk. */
export function routeItem(mode: AutomationMode, risk: Risk): "draft" | "awaiting_approval" | "send" | "off" {
  if (mode === "off") return "off";
  if (mode === "manual") return risk === "routine" ? "draft" : "awaiting_approval";
  if (mode === "approval") return "awaiting_approval";
  return risk === "routine" ? "send" : "awaiting_approval";
}

// ── what an automatic message may never say ────────────────────────────

/**
 * An automatic message goes out under the coach's name without him reading it,
 * so it never claims he looked at something, never says the program changed,
 * and keeps to the pain-draft rules (no diagnosis, medication or wellness lines).
 */
const CLAIMS = [
  /\b(i|i've|i have|just)\s+(saw|seen|looked|noticed|checked|reviewed|went through|read)\b/i,
  /\b(looked at|went over|went through|reviewed) your\b/i,
  /\bi (changed|adjusted|updated|modified|swapped|removed|cut|lowered|dropped)\b/i,
  /\b(i've|i have|i'll|i will|ill|i'm going to|im going to|gonna) (change|changed|adjust|adjusted|update|updated|modify|modified|swap|swapped|remove|removed|lower|lowered|drop|dropped|cut)\b/i,
  /\byour (program|plan|session|workout)s? (is|has been|was) (changed|adjusted|updated|modified)\b/i,
];

export function autoMessageProblems(text: string): string[] {
  const out = draftProblems(text);
  for (const re of CLAIMS) {
    const m = text.match(re);
    if (m) out.push(m[0].toLowerCase());
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) out.push("empty");
  else if (words > 80) out.push("too long");
  return out;
}

// ── follow-ups ─────────────────────────────────────────────────────────

/** Manitoba kept UTC-5 from Nov 1 2026; older zone rules would read UTC-6 (posts-schedule.ts). */
const MANITOBA_FIXED_FROM = Date.parse("2026-11-01T07:00:00Z");
const MANITOBA_ZONES = new Set(["America/Winnipeg", "America/Rainy_River", "Canada/Central"]);

function localOffsetMinutes(at: number, tz: string): number {
  if (MANITOBA_ZONES.has(tz) && at >= MANITOBA_FIXED_FROM) return -300;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}

/** A wall-clock time in a zone as an instant (twice round, so a clock change is honoured). */
export function localToInstant(day: string, minute: number, tz: string): Date {
  const wall = Date.parse(`${day}T00:00:00Z`) + minute * 60_000;
  let at = wall - localOffsetMinutes(wall, tz) * 60_000;
  at = wall - localOffsetMinutes(at, tz) * 60_000;
  return new Date(at);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Evening before the session (18:00), or the fixed fallback's morning (10:00). */
export const FOLLOW_UP_EVENING = 18 * 60;
export const FOLLOW_UP_MORNING = 10 * 60;
/** Never sooner than this after the reply (the reply already covers the next day). */
export const FOLLOW_UP_MIN_HOURS = 20;
/** Only a session this close is worth timing to; further out, no training-timed follow-up. */
export const FOLLOW_UP_LOOKAHEAD_DAYS = 10;
/** The fixed follow-up (automation without the owner's training-aware timing). */
export const FOLLOW_UP_FIXED_DAYS = 3;

export type UpcomingSession = { date: string; title: string | null; loads: boolean; exercises: string[] };

/**
 * When to check back in. Training-aware (the owner's): the evening before the
 * next session in the lookahead that loads the area, named; with no such
 * session, or when it's too soon after the reply, none. Fixed (a paid plan):
 * three days later at 10:00.
 */
export function planFollowUp(opts: {
  /** The reply's send time (or now when it's waiting). */
  after: Date;
  today: string;
  tz: string;
  trainingAware: boolean;
  sessions: UpcomingSession[];
}): { dueAt: Date; reason: string; session: UpcomingSession | null } | null {
  const minAt = opts.after.getTime() + FOLLOW_UP_MIN_HOURS * 3_600_000;
  if (opts.trainingAware) {
    const last = addDays(opts.today, FOLLOW_UP_LOOKAHEAD_DAYS);
    const next = [...opts.sessions].sort((a, b) => a.date.localeCompare(b.date)).find((s) => s.loads && s.date > opts.today && s.date <= last);
    if (!next) return null;
    const dueAt = localToInstant(addDays(next.date, -1), FOLLOW_UP_EVENING, opts.tz);
    if (dueAt.getTime() < minAt) return null;
    return { dueAt, reason: `Before ${next.title ? `${next.title} ` : "their next session "}on ${next.date}`, session: next };
  }
  const dueAt = localToInstant(addDays(opts.today, FOLLOW_UP_FIXED_DAYS), FOLLOW_UP_MORNING, opts.tz);
  if (dueAt.getTime() < minAt) return null;
  return { dueAt, reason: `${FOLLOW_UP_FIXED_DAYS} days after their report`, session: null };
}

/**
 * Whether a follow-up still makes sense when it comes due: never after they've
 * reported that area again (that report gets its own reply), and never once
 * the coach has written to them himself since the reply (he's on it; it goes
 * to him for approval instead of out by itself).
 */
export function followUpStillRelevant(opts: {
  regions: string[];
  replyAt: string;
  laterReports: { region: string; at: string }[];
  coachWroteSince: boolean;
  clientActive: boolean;
}): "send" | "ask" | "cancel" {
  if (!opts.clientActive) return "cancel";
  const regions = new Set(opts.regions);
  if (opts.laterReports.some((r) => regions.has(r.region) && r.at > opts.replyAt)) return "cancel";
  if (opts.coachWroteSince) return "ask";
  return "send";
}

/** Status words for the queue. */
export const STATUS_WORDS: Record<string, string> = {
  queued: "Waiting a moment",
  working: "Writing it",
  sending: "Sending",
  draft: "Draft ready",
  awaiting_approval: "Needs your OK",
  sent: "Sent",
  dismissed: "Dismissed",
  cancelled: "No longer needed",
  failed: "Couldn't write it",
};
