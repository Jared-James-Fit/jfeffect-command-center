/**
 * Sharing a workout outside the app (Nov 22 2026): one list of where it can
 * go and one caption, the same from the recap, a PR and the story camera.
 * Pure and tested.
 *
 * What a web app can and can't do, said honestly in the sheet: it hands the
 * picture to the phone's own share sheet (the person picks Instagram, TikTok,
 * Messages…) in the right shape for where it's going (9:16 for a story or
 * TikTok, 4:5 for an Instagram post). Instagram and TikTok drop any text
 * shared with a picture, so the caption is copied, only when the person taps
 * something that says it copies, ready to paste. Nothing is ever posted for
 * them and nothing is prefilled in another app.
 */

export const JF_HANDLE = "@jfeffect";

export type ShareFormat = "story" | "feed";
export type ShareDestinationKey = "ig_story" | "ig_post" | "tiktok" | "more" | "save" | "copy";

export type ShareDestination = {
  key: ShareDestinationKey;
  label: string;
  /** One line under it: the shape, or what else the tap does. */
  sub: string;
  /** The picture it gets; null: no picture (Copy caption). */
  format: ShareFormat | null;
  /** The tap also copies the caption (the app drops shared text, so it's pasted there). */
  copies: boolean;
  /** The caption goes along with the picture (apps that keep shared text). */
  withText: boolean;
};

export const SHARE_DESTINATIONS: ShareDestination[] = [
  { key: "ig_story", label: "Instagram Story", sub: "9:16", format: "story", copies: false, withText: false },
  { key: "ig_post", label: "Instagram post", sub: "4:5 · copies caption", format: "feed", copies: true, withText: false },
  { key: "tiktok", label: "TikTok", sub: "9:16 · copies caption", format: "story", copies: true, withText: false },
  { key: "more", label: "More apps", sub: "Messages, WhatsApp…", format: "story", copies: false, withText: true },
  { key: "save", label: "Save", sub: "To your photos", format: "story", copies: false, withText: false },
  { key: "copy", label: "Copy caption", sub: "Ready to paste", format: null, copies: true, withText: false },
];

/** What the caption is written from: the workout's public title and its featured lift (already formatted). */
export type CaptionSource = {
  workoutTitle: string | null;
  lift: { name: string; detail: string; prLabel: string | null } | null;
  isPr: boolean;
  /** A post that hides its weights: the lift is named, never its numbers. */
  hideLoads?: boolean;
};

/** The removable last line: "Tracked with @jfeffect" under a PR, the handle on its own otherwise. */
export function promoLine(src: Pick<CaptionSource, "isPr" | "lift">): string {
  return src.isPr && src.lift?.prLabel ? `Tracked with ${JF_HANDLE}` : JF_HANDLE;
}

/**
 * The caption, written from the workout:
 *   "Block 1 · Week 1\n\n2-Count Pause Bench Press\n107.5 kg × 6\n\n@jfeffect"
 *   "New PR. 107.5 kg × 6.\n\n2-Count Pause Bench Press\n\nTracked with @jfeffect"
 * `promo` off leaves the last line out.
 */
export function workoutShareCaption(src: CaptionSource, opts: { promo?: boolean } = {}): string {
  const promo = opts.promo ?? true;
  const lift = src.lift;
  const parts: string[] = [];
  const detail = lift && !src.hideLoads ? lift.detail.trim() : "";
  if (src.isPr && lift?.prLabel && detail) {
    parts.push(`New PR. ${detail.replace(/\.$/, "")}.`);
    parts.push(lift.name);
  } else {
    if (src.workoutTitle?.trim()) parts.push(src.workoutTitle.trim());
    if (lift) parts.push(detail ? `${lift.name}\n${detail}` : lift.name);
  }
  if (promo) parts.push(promoLine(src));
  return parts.join("\n\n");
}

/** The same caption with the promo line put back or taken off, whatever else was typed into it. */
export function withPromo(text: string, line: string, on: boolean): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const isPromo = (l: string) => l.trim() === JF_HANDLE || l.trim() === `Tracked with ${JF_HANDLE}`;
  while (lines.length && (isPromo(lines[lines.length - 1]) || (lines.length > 1 && lines[lines.length - 1].trim() === "" && isPromo(lines[lines.length - 2] ?? "")))) lines.pop();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const body = lines.join("\n");
  if (!on) return body;
  return body ? `${body}\n\n${line}` : line;
}

/** A file's name for where it's going ("jf-effect-story.jpg"). */
export function shareFileName(format: ShareFormat, look?: string | null): string {
  return `jf-effect-${format === "feed" ? "post" : "story"}${look ? `-${look}` : ""}.jpg`;
}
