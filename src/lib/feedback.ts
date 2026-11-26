/**
 * The app's feedback, one call per moment: `feedback("like")`, `feedback("pr")`.
 * Each moment has its haptic (platform/haptics.ts) and its sound
 * (app-sounds.ts), decided here once, so a like, a set or a PR feels the same
 * wherever it happens, and the screen fires it in the same handler as its
 * animation (the heart's pop, the set's green, the PR chip).
 *
 * What gets what (a native app's restraint, not a website's jingles):
 *   - everyday social taps (like, follow, save, repost, a comment) are a
 *     light tap and silent: they happen dozens of times a visit, and a sound
 *     on each would be noise (Instagram's and TikTok's are silent too); a
 *     post or story going up is the success tap and the "sent" tick;
 *   - workout logging is felt and heard, softly: a rep count, weight or RPE
 *     confirmed the selection tick and a dry, quiet tick (never a keystroke);
 *     a set a medium tap and a round pop; an exercise's last set its pop and
 *     a short ascending chime; footage that genuinely finished uploading the
 *     success tap and a warm "da-ding"; a genuine PR the success tap and a
 *     short celebratory run; the rest over two gentle bells; the workout done
 *     the JF Effect signature (the recap plays its longer sting instead); a
 *     milestone the strongest tap and its bell;
 *   - saving and submitting are a success tap and the quick "sent" tick, a
 *     chat message a light tap and the same tick, a task done a light tap and
 *     the tick, a failed action a soft low warning (never an alarm);
 *   - picking, switching and swipes crossing their point are the selection
 *     tick (the iPhone's own), a checkbox adds its soft tick sound;
 *   - a timer going off is the one long buzz and its chime;
 *   - Rankings: switching boards is the selection tick and a soft swish,
 *     two lifters squaring up a medium tap and a short iron hit, a lifter's
 *     breakdown opening a light tap and one plate tap;
 *   - typing, scrolling and navigating say nothing.
 *
 * A moment that comes from data rather than a tap names itself (`key`) and
 * says when it happened (`at`): it's felt once per key (a re-render, a
 * refetch, a remount, an offline write syncing, a retry never repeat it) and
 * only while it's fresh (opening an old workout never replays its PRs).
 * Sounds follow their own switch, volume, the silent switch, the spacing and
 * priority in app-sounds.ts; haptics their own switch and the spacing in
 * haptics.ts (Settings → Notifications → Sounds & haptics, each per device).
 */
import { haptic, type HapticStyle } from "@/platform/haptics";
import { playAppSound, preloadAppSounds, type AppSound } from "@/lib/app-sounds";

export type FeedbackEvent =
  /** a value picked, a view switched, a rating, a switch flipped */
  | "tap"
  /** a checkbox ticked or unticked */
  | "toggle"
  /** a swipe crossing its commit point, a snap, a pull that will refresh */
  | "detent"
  /** a long press opened something (reactions, a menu, recording) */
  | "press"
  | "like"
  | "follow"
  | "save"
  | "repost"
  /** a Crew post or story went up */
  | "post"
  /** a comment or reply went up */
  | "comment"
  /** a chat message sent */
  | "send"
  /** a rep count, a weight or an RPE confirmed in a set (a value committed, never a keystroke) */
  | "confirm"
  /** a working set logged */
  | "set"
  /** an exercise's last set */
  | "exercise"
  /** a genuine PR (an all-time record worth leading with, isGenuineSetPr) */
  | "pr"
  /** footage that genuinely finished uploading (on the set and with the coach) */
  | "upload"
  /** a rest between sets ran out */
  | "rest"
  /** a workout finished */
  | "workout"
  /** an achievement unlocked, a level up */
  | "milestone"
  /** saved, submitted */
  | "success"
  /** a task ticked off (unticking is the plain toggle) */
  | "complete"
  | "warning"
  | "error"
  /** a timer went off */
  | "timer"
  /** a message came in (the open thread) */
  | "message"
  /** something new came in (a notification while the app is open) */
  | "notify"
  /** Cleo's answer is in */
  | "reply"
  /** Rankings: Monthly League ⇄ Hall of Strength */
  | "board"
  /** Rankings: two lifters side by side */
  | "versus"
  /** Rankings: a lifter's breakdown opened */
  | "reveal";

export type FeedbackSpec = { haptic: HapticStyle | null; sound: AppSound | null };

export const FEEDBACK: Record<FeedbackEvent, FeedbackSpec> = {
  tap: { haptic: "selection", sound: null },
  toggle: { haptic: "selection", sound: "tick" },
  detent: { haptic: "selection", sound: null },
  press: { haptic: "medium", sound: null },
  like: { haptic: "light", sound: null },
  follow: { haptic: "light", sound: null },
  save: { haptic: "light", sound: null },
  repost: { haptic: "light", sound: null },
  post: { haptic: "success", sound: "sent" },
  comment: { haptic: "light", sound: null },
  send: { haptic: "light", sound: "sent" },
  confirm: { haptic: "selection", sound: "confirm" },
  set: { haptic: "medium", sound: "set" },
  exercise: { haptic: "medium", sound: "exercise" },
  pr: { haptic: "success", sound: "pr" },
  upload: { haptic: "success", sound: "upload" },
  rest: { haptic: "success", sound: "rest" },
  workout: { haptic: "success", sound: "workout" },
  milestone: { haptic: "heavy", sound: "milestone" },
  success: { haptic: "success", sound: "sent" },
  complete: { haptic: "light", sound: "sent" },
  warning: { haptic: "warning", sound: "warning" },
  error: { haptic: "error", sound: "error" },
  timer: { haptic: "alarm", sound: "timer" },
  message: { haptic: null, sound: "message" },
  notify: { haptic: null, sound: "notify" },
  reply: { haptic: null, sound: "reply" },
  board: { haptic: "selection", sound: "whoosh" },
  versus: { haptic: "medium", sound: "clash" },
  reveal: { haptic: "light", sound: "clang" },
};

export type FeedbackOptions = {
  /** Leave the sound out (a screen that plays its own longer music). */
  sound?: boolean;
  /** Leave the haptic out (a tap whose haptic a HapticTap already gave). */
  haptic?: boolean;
  /** This moment's identity: felt once per key ("set:<row>:<n>:<completed_at>"). */
  key?: string;
  /** When it happened (ISO, ms or Date): older than its freshness, it's history and says nothing. */
  at?: string | number | Date | null;
  /** How old `at` may be (ms); defaults per moment (FRESH_MS). */
  maxAgeMs?: number;
};

/** How old a moment may be and still be felt (it happened just now, here). */
export const FRESH_MS: Partial<Record<FeedbackEvent, number>> = {
  confirm: 60_000,
  // a long timed set, or a set logged offline that the screen shows a beat later
  set: 5 * 60_000,
  exercise: 5 * 60_000,
  // the server's records can trail the set by a few seconds; the chip pops within 2 minutes
  pr: 2 * 60_000,
  upload: 10 * 60_000,
  rest: 5_000,
  workout: 30 * 60_000,
  milestone: 10 * 60_000,
};
const DEFAULT_FRESH_MS = 2 * 60_000;
/** A clock a little ahead (another device's, the server's) still counts as now. */
const FUTURE_SLACK_MS = 10 * 60_000;

/** Whether a moment that happened `at` is still news `now` (pure, tested). Unknown times count as news. */
export function isFreshMoment(at: FeedbackOptions["at"], now: number, maxAgeMs: number): boolean {
  if (at == null) return true;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return true;
  if (ms - now > FUTURE_SLACK_MS) return true;
  return now - ms <= maxAgeMs;
}

// ── once per moment ────────────────────────────────────────────────────────

const LEDGER_KEY = "jf-feedback-seen";
/** Long enough to outlast a workout; short enough to stay small. */
const LEDGER_TTL_MS = 6 * 60 * 60_000;
const LEDGER_MAX = 400;
let ledger: Map<string, number> | null = null;

function loadLedger(now: number): Map<string, number> {
  if (ledger) return ledger;
  ledger = new Map();
  try {
    const raw = window.sessionStorage?.getItem(LEDGER_KEY);
    if (raw) {
      for (const [k, t] of JSON.parse(raw) as Array<[string, number]>) {
        if (typeof k === "string" && typeof t === "number" && now - t < LEDGER_TTL_MS) ledger.set(k, t);
      }
    }
  } catch { /* private mode or nothing kept */ }
  return ledger;
}

function saveLedger() {
  if (!ledger) return;
  try {
    window.sessionStorage?.setItem(LEDGER_KEY, JSON.stringify([...ledger.entries()].slice(-LEDGER_MAX)));
  } catch { /* private mode */ }
}

/**
 * Claim a moment's key: true the first time (this tab's session, across
 * remounts and reloads), false after. Kept in sessionStorage so a reload of
 * the logger never replays a set or a PR, and gone when the app is closed.
 */
export function claimFeedbackKey(key: string, now: number = Date.now()): boolean {
  if (typeof window === "undefined") return true;
  const l = loadLedger(now);
  if (l.has(key)) return false;
  l.set(key, now);
  if (l.size > LEDGER_MAX) {
    const drop = l.size - LEDGER_MAX;
    let i = 0;
    for (const k of l.keys()) { if (i++ >= drop) break; l.delete(k); }
  }
  saveLedger();
  return true;
}

/** For tests: forget every claimed moment. */
export function resetFeedbackLedger() {
  ledger = new Map();
  try { window.sessionStorage?.removeItem(LEDGER_KEY); } catch { /* fine */ }
}

/**
 * Give a moment its feedback. Returns whether the moment counted (fresh and
 * not felt before), whatever the switches say, so a screen can tie something
 * else to it (a rest starting with its set). Never throws.
 */
export function feedback(event: FeedbackEvent, opts: FeedbackOptions = {}): boolean {
  const f = FEEDBACK[event];
  if (!f) return false;
  try {
    const now = Date.now();
    if (opts.at !== undefined && !isFreshMoment(opts.at, now, opts.maxAgeMs ?? FRESH_MS[event] ?? DEFAULT_FRESH_MS)) return false;
    if (opts.key && !claimFeedbackKey(`${event}:${opts.key}`, now)) return false;
    if (f.haptic && opts.haptic !== false) haptic(f.haptic);
    if (f.sound && opts.sound !== false) playAppSound(f.sound);
    return true;
  } catch {
    /* never let feedback break the UI */
    return false;
  }
}

/**
 * Get a screen's cues ready before they're needed (the workout logger on
 * open): the audio set up and the hot cues rendered in idle time, so the
 * first set's pop is as quick as the tenth. Never makes a sound.
 */
export function primeFeedback(): void {
  try {
    preloadAppSounds();
  } catch {
    /* fine */
  }
}
