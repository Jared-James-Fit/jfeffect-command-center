/**
 * Quick story (pure, tested): the story a finished workout is shared to from
 * its recap. It's painted for them straight away from the workout (the same
 * cards the studio paints, `paintShareCard`), at most one photo goes under it,
 * and nothing is posted until they tap Share to Story. The full Crew composer
 * (carousel, clips, GIF, voice memo, audience) stays the studio's.
 */
import { TEMPLATE_LABEL, type ShareTemplate } from "@/lib/workout-share-card";

/** A story's words show over its bottom (the viewer clamps them to three lines). */
export const QUICK_STORY_CAPTION_MAX = 140;
/** The look they last shared a workout story in, per login on this phone (a convenience, never needed). */
export const STORY_LOOK_KEY = "jf.story-look.v1";

/**
 * The looks a quick story offers: never the transparent sticker, and "No
 * filter" only once there's a photo (on its own it's an empty backdrop).
 */
export function storyLooks(looks: readonly ShareTemplate[], hasPhoto: boolean): ShareTemplate[] {
  return Array.from(new Set(looks.filter((t) => t !== "sticker" && (hasPhoto || t !== "plain"))));
}

/** What a look is called here: what it shows, in a word or two. */
export function storyLookLabel(t: ShareTemplate, hasPhoto: boolean): string {
  switch (t) {
    case "pr":
      return "PR";
    case "photo":
      return hasPhoto ? "Photo" : "Clean";
    case "stats":
      return "Summary";
    case "progress":
      return "vs last time";
    case "plain":
      return "Photo only";
    default:
      return TEMPLATE_LABEL[t];
  }
}

export type StoryLookFacts = {
  /** The session set a record. */
  isPr: boolean;
  /** Its featured lift carried a load (a strength day, not a run, a walk or bodyweight work). */
  liftLoaded: boolean;
};

/**
 * The look a story opens on: a PR day leads with the record; else the look
 * they shared in last time (when this workout has it); else a strength day's
 * summary of its lifts; else the clean card (time and sets: a run, cardio,
 * bodyweight work). Never a look the workout can't fill.
 */
export function defaultStoryLook(looks: readonly ShareTemplate[], f: StoryLookFacts, remembered: ShareTemplate | null): ShareTemplate | null {
  if (!looks.length) return null;
  if (f.isPr && looks.includes("pr")) return "pr";
  if (remembered && remembered !== "pr" && remembered !== "plain" && looks.includes(remembered)) return remembered;
  if (f.liftLoaded && looks.includes("stats")) return "stats";
  if (looks.includes("photo")) return "photo";
  return looks[0];
}

/**
 * The row of looks: the one it opened on first, then the rest in the card's
 * own order. Stable while they tap through (a chip never jumps under the
 * finger); the first few fit on screen and the rest scroll.
 */
export function storyLookOrder(looks: readonly ShareTemplate[], first: ShareTemplate | null): ShareTemplate[] {
  if (!first || !looks.includes(first)) return [...looks];
  return [first, ...looks.filter((t) => t !== first)];
}

/** Read / keep the look they last shared in (try/catch: private windows and blocked storage just forget). */
export function readStoryLook(userId: string | null | undefined): ShareTemplate | null {
  if (!userId) return null;
  try {
    const v = window.localStorage.getItem(`${STORY_LOOK_KEY}:${userId}`);
    return v && v in TEMPLATE_LABEL ? (v as ShareTemplate) : null;
  } catch {
    return null;
  }
}
export function keepStoryLook(userId: string | null | undefined, look: ShareTemplate): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${STORY_LOOK_KEY}:${userId}`, look);
  } catch {
    /* it just opens on the default next time */
  }
}

/** Fit a 9:16 frame into a box, as big as it goes. */
export function fitStoryFrame(box: { w: number; h: number }): { w: number; h: number } {
  if (box.w <= 0 || box.h <= 0) return { w: 0, h: 0 };
  const w = Math.min(box.w, (box.h * 9) / 16);
  return { w: Math.floor(w), h: Math.floor((w * 16) / 9) };
}
