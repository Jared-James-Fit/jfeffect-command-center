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
 *   - workout logging is felt and heard, softly: a set a medium tap and a
 *     woody tock, an exercise's last set a warmer cue, a PR the success tap
 *     and a short sparkle, the workout done the success tap and the success
 *     chime, a milestone the strongest tap and its bell;
 *   - saving and submitting are a success tap and the quick "sent" tick, a
 *     chat message a light tap and the same tick, a task done a light tap and
 *     the tick, a failure the error tap and the low error tone;
 *   - picking, switching and swipes crossing their point are the selection
 *     tick (the iPhone's own), a checkbox adds its soft tick sound;
 *   - a timer going off is the one long buzz and its chime;
 *   - typing, scrolling and navigating say nothing.
 * Sounds follow their own switch, the silent switch and the spacing in
 * app-sounds.ts; haptics their own switch and the spacing in haptics.ts
 * (Settings → Notifications → Sounds & haptics, each per device).
 */
import { haptic, type HapticStyle } from "@/platform/haptics";
import { playAppSound, type AppSound } from "@/lib/app-sounds";

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
  /** a working set logged */
  | "set"
  /** an exercise's last set */
  | "exercise"
  | "pr"
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
  | "reply";

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
  set: { haptic: "medium", sound: "set" },
  exercise: { haptic: "medium", sound: "exercise" },
  pr: { haptic: "success", sound: "pr" },
  workout: { haptic: "success", sound: "success" },
  milestone: { haptic: "heavy", sound: "milestone" },
  success: { haptic: "success", sound: "sent" },
  complete: { haptic: "light", sound: "sent" },
  warning: { haptic: "warning", sound: "error" },
  error: { haptic: "error", sound: "error" },
  timer: { haptic: "alarm", sound: "timer" },
  message: { haptic: null, sound: "message" },
  notify: { haptic: null, sound: "notify" },
  reply: { haptic: null, sound: "reply" },
};

/**
 * Give a moment its feedback. `sound: false` / `haptic: false` leave one out
 * (a screen that plays its own longer music, or a tap whose haptic a
 * HapticTap already gave). Never throws.
 */
export function feedback(event: FeedbackEvent, opts: { sound?: boolean; haptic?: boolean } = {}): void {
  const f = FEEDBACK[event];
  if (!f) return;
  try {
    if (f.haptic && opts.haptic !== false) haptic(f.haptic);
    if (f.sound && opts.sound !== false) playAppSound(f.sound);
  } catch {
    /* never let feedback break the UI */
  }
}
