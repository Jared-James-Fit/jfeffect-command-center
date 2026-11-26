/**
 * Client goal updates (pure, tested in goal-intel.test.ts): when the coach
 * approves a target the client should know about, one short message is
 * prepared for their coach chat and waits out a review window (30 minutes by
 * default) the coach can preview, edit, hold, cancel or send now. Related
 * changes join the waiting message and restart the window. It goes by itself
 * only when every rule below says yes, checked again right before sending:
 *
 *  - every change in it is still approved and still says what the message
 *    says (an outdated or withdrawn change drops out; nothing current left =
 *    nothing sent);
 *  - the client is offline: no app heartbeat or activity in the last few
 *    minutes. Presence nobody can read (no heartbeat on record lately) is
 *    unknown, and an unknown is never treated as offline: it waits, then
 *    holds for the coach;
 *  - not in their quiet hours (their own notification settings);
 *  - not edited by the coach after a newer change arrived (that holds it).
 *
 * The words come only from the approved targets: never a feasibility score,
 * a projection, a quote, the coach's notes or any internal analysis.
 */
import { LB_PER_KG, fromKg, type GoalKind, type Lift, type Unit } from "./types";

export const DEFAULT_REVIEW_MINUTES = 30;
export const MIN_REVIEW_MINUTES = 5;
export const MAX_REVIEW_MINUTES = 24 * 60;
/** A heartbeat this recent means they're in the app right now (beats come once a minute). */
export const ONLINE_MS = 4 * 60_000;
/** Without a heartbeat in this long, presence can't be read (analytics off, a new phone…). */
export const PRESENCE_KNOWN_MS = 14 * 86_400_000;
/** Online: try again this much later. */
export const ONLINE_RETRY_MS = 10 * 60_000;
/** Unknown presence: try again this often, and hand it to the coach after this long. */
export const UNKNOWN_RETRY_MS = 60 * 60_000;
export const UNKNOWN_HOLD_AFTER_MS = 24 * 60 * 60_000;

export type OutboxChange = {
  goalId: string;
  /** client_goals.version the line was written from (an older one is outdated) */
  version: number;
  kind: GoalKind;
  lift: Lift | null;
  title: string;
  eventTitle: string | null;
  deadline: string | null;
  /** the approved target, kg (null for a goal in words) */
  targetKg: number | null;
  /** the approved goal in words, for one with no number */
  targetText: string | null;
  /** the unit the client sees it in */
  unit: Unit;
  /** what it was before, kg (null when it's new) */
  beforeKg: number | null;
};

export type Presence = "online" | "offline" | "unknown";

/** Are they in the app right now? From the app's heartbeat and their last activity. */
export function presenceOf(x: { lastBeatAt: string | null; lastActiveAt: string | null; now: number }): Presence {
  const beat = Date.parse(x.lastBeatAt ?? "") || 0;
  const active = Date.parse(x.lastActiveAt ?? "") || 0;
  if ((beat && x.now - beat < ONLINE_MS) || (active && x.now - active < ONLINE_MS)) return "online";
  if (!beat || x.now - beat > PRESENCE_KNOWN_MS) return "unknown";
  // active in the app well after the last heartbeat: the heartbeat isn't covering them (switched off)
  if (active && active - beat > 15 * 60_000) return "unknown";
  return "offline";
}

/** Is this hour inside their quiet hours (start > end wraps midnight)? */
export function inQuiet(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type SendDecision =
  | { send: true }
  | { send: false; wait: "window" | "online" | "quiet" | "presence_unknown"; retryAt: number; line: string }
  | { send: false; hold: "presence_unknown" | "auto_off" | "changed_after_edit" | "nothing_current"; line: string };

/** May the waiting message go by itself now? */
export function sendDecision(x: {
  now: number;
  sendAfter: number;
  createdAt: number;
  autoSend: boolean;
  presence: Presence;
  quiet: { now: boolean; endsAt: number | null };
  /** changes still current (approved and matching) */
  currentChanges: number;
  editedThenChanged: boolean;
}): SendDecision {
  if (x.currentChanges === 0) return { send: false, hold: "nothing_current", line: "Nothing in it is current any more." };
  if (x.editedThenChanged) return { send: false, hold: "changed_after_edit", line: "A newer change came in after your edit: check it and send." };
  if (x.now < x.sendAfter) return { send: false, wait: "window", retryAt: x.sendAfter, line: "In your review window" };
  if (!x.autoSend) return { send: false, hold: "auto_off", line: "Automatic sending is off: send it when you're ready." };
  if (x.quiet.now) return { send: false, wait: "quiet", retryAt: x.quiet.endsAt ?? x.now + ONLINE_RETRY_MS, line: "Their quiet hours: it waits until they end." };
  if (x.presence === "online") return { send: false, wait: "online", retryAt: x.now + ONLINE_RETRY_MS, line: "They're in the app: it waits until they're not." };
  if (x.presence === "unknown") {
    if (x.now - x.sendAfter >= UNKNOWN_HOLD_AFTER_MS) return { send: false, hold: "presence_unknown", line: "Can't tell when they're offline: send it yourself." };
    return { send: false, wait: "presence_unknown", retryAt: x.now + UNKNOWN_RETRY_MS, line: "Can't tell if they're in the app yet: it waits." };
  }
  return { send: true };
}

/** A target as the client reads it, in their unit, to what can be loaded. */
export function clientWeight(kg: number, unit: Unit, kind: GoalKind): string {
  if (unit === "lb") {
    const v = kg * LB_PER_KG;
    void kind;
    return `${Math.round(v)} lb`;
  }
  const v = fromKg(kg, "kg");
  const shown = kind === "bodyweight" ? Math.round(v * 10) / 10 : Math.round(v * 2) / 2;
  return `${Number.isInteger(shown) ? shown : shown.toFixed(1)} kg`;
}

const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

/** One line per change, newest wording only: "Squat: 225 lb (was 215 lb)". */
export function changeLine(c: OutboxChange): string {
  const what = c.kind === "lift" && c.lift ? LIFT_NAME[c.lift] : c.kind === "total" ? "Total" : c.kind === "bodyweight" ? "Bodyweight" : c.title;
  if (c.targetKg == null) return `${what}: ${c.targetText ?? "updated"}`;
  const now = clientWeight(c.targetKg, c.unit, c.kind);
  const was = c.beforeKg != null ? clientWeight(c.beforeKg, c.unit, c.kind) : null;
  return `${what}: ${now}${was && was !== now ? ` (was ${was})` : ""}`;
}

/** What they need to do, by what changed (one line, never more). */
export function whatToDo(changes: OutboxChange[]): string {
  const kinds = new Set(changes.map((c) => c.kind));
  const meet = changes.some((c) => c.eventTitle && (c.kind === "lift" || c.kind === "total"));
  if (kinds.has("bodyweight") && (kinds.has("lift") || kinds.has("total")))
    return "Your training stays the same. Keep logging every set with its RPE, and weigh in most mornings so we follow the trend, not single days.";
  if (kinds.has("bodyweight")) return "Weigh in most mornings so we follow the trend, not single days.";
  if (meet) return "Your training stays the same. Keep logging every set with its RPE so the attempts are called off real numbers.";
  if (kinds.has("lift") || kinds.has("total")) return "Your training stays the same for now. Keep logging every set with its RPE so we can track it.";
  return "Nothing changes in your training right now.";
}

/** The message: a greeting, what changed, what to do. Plain, short, no internal analysis. */
export function buildUpdateMessage(x: { firstName: string | null; changes: OutboxChange[] }): string {
  const cs = latestPerGoal(x.changes);
  if (!cs.length) return "";
  const events = Array.from(new Set(cs.map((c) => c.eventTitle).filter(Boolean))) as string[];
  const dates = Array.from(new Set(cs.map((c) => c.deadline).filter(Boolean))) as string[];
  const about =
    events.length === 1
      ? ` for ${events[0]}${dates.length === 1 ? ` (${day(dates[0])})` : ""}`
      : !events.length && dates.length === 1
        ? ` for ${day(dates[0])}`
        : "";
  const hi = x.firstName ? `Hey ${x.firstName}, ` : "";
  const head = `${hi}quick update on your ${cs.length === 1 ? "target" : "targets"}${about}:`;
  return [head, ...cs.map((c) => `• ${changeLine(c)}`), "", whatToDo(cs)].join("\n");
}

/** A newer change to the same goal replaces the older one. */
export function latestPerGoal(changes: OutboxChange[]): OutboxChange[] {
  const by = new Map<string, OutboxChange>();
  for (const c of changes) {
    const prev = by.get(c.goalId);
    if (!prev || c.version >= prev.version) by.set(c.goalId, { ...c, beforeKg: prev?.beforeKg ?? c.beforeKg });
  }
  return Array.from(by.values());
}

/** Add a change to the waiting message's list (one line per goal, the newest wins). */
export function mergeChanges(existing: OutboxChange[], incoming: OutboxChange): OutboxChange[] {
  return latestPerGoal([...existing, incoming]);
}

/** What the outbox needs of a goal to judge a waiting change against it. */
export type CurrentGoal = {
  id: string;
  status: string;
  version: number;
  approved_kg: number | null;
  approved_text?: string | null;
  deadline?: string | null;
  event_title?: string | null;
  client_facing: boolean;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * Which changes still say what the approved goal says now: still approved,
 * still for the client, and the same approved target. Only the approved
 * target decides: the client's own number moving, a read, a note or the
 * goal's version never makes an approved change outdated. The meet's date and
 * name are taken as they are now (a moved meet is said with its new date).
 */
export function currentChanges(changes: OutboxChange[], goals: CurrentGoal[]): OutboxChange[] {
  const by = new Map(goals.map((g) => [g.id, g]));
  const out: OutboxChange[] = [];
  for (const c of latestPerGoal(changes)) {
    const g = by.get(c.goalId);
    if (!g || g.status !== "active" || !g.client_facing) continue;
    const same =
      c.targetKg != null
        ? g.approved_kg != null && Math.abs(Number(g.approved_kg) - c.targetKg) < 0.05
        : g.approved_kg == null && (g.approved_text === undefined || norm(g.approved_text) === norm(c.targetText));
    if (!same) continue;
    out.push({
      ...c,
      deadline: g.deadline !== undefined ? g.deadline : c.deadline,
      eventTitle: g.event_title !== undefined ? g.event_title : c.eventTitle,
    });
  }
  return out;
}

/** Did anything the message says move (a line dropped, a date or a meet's name)? Then the words are rebuilt. */
export function changesMoved(before: OutboxChange[], now: OutboxChange[]): boolean {
  const a = latestPerGoal(before);
  if (a.length !== now.length) return true;
  const by = new Map(now.map((c) => [c.goalId, c]));
  return a.some((c) => {
    const n = by.get(c.goalId);
    return !n || n.deadline !== c.deadline || n.eventTitle !== c.eventTitle;
  });
}

/** Send failures before a waiting update is handed to the coach (waits never count). */
export const MAX_SEND_FAILURES = 3;
/** A claim this old with no send recorded was cut off part way: pick it up again. */
export const STALE_SENDING_MS = 10 * 60_000;
