/**
 * Pictures for automated posts, made by an image model (pure parts: the
 * prompts, which posts get one, and reading an image's size). Only a post
 * with nothing of its own to show gets one by itself: Saturday's scene. A
 * lesson leads with its diagram, Wins / the Recap / Tuesday's numbers /
 * Thursday's feature with their chart, quotes and tips as a clean type card,
 * a holiday with its own photo; the coach can still ask for a picture on any
 * of them (New picture). The server side is post-pictures.server.ts.
 */
import type { SpiritSceneKey } from "@/components/community/spirit-scenes";

/**
 * How every post picture looks: one style, so the feed reads as one account.
 * Bright and true to life on purpose: the feed is dark, and a dark, moody
 * picture sinks into it and reads as the app's art instead of a photo.
 */
export const PICTURE_STYLE = [
  "Style: a real photograph, like one a good photographer took on a modern camera for a strength coach's Instagram.",
  "Natural daylight, bright and airy, true-to-life colours, clean and uncluttered background, shallow depth of field. Not dark, not moody, no black background, no neon, not an illustration, not CGI.",
  "Real people only from behind, from the side or as hands, candid and never posed or looking at the camera.",
  "Vertical portrait composition (4:5) with the subject centred and room around it.",
  "Absolutely no text, letters, numbers, logos or watermarks anywhere in the image.",
].join(" ");

/** Each Saturday scene as a picture: the same idea as the drawing, shot for real. */
export const SCENE_PICTURE: Record<SpiritSceneKey, string> = {
  keep_digging:
    "A lone miner in a sunlit open quarry, mid-swing with a pickaxe at a rock face; just past the rock in front of him, unseen by him, a thick vein of gold catching the light.",
  bamboo_roots:
    "A single tiny bamboo sprout breaking through soil in morning sun, shown in a cross-section of the earth: underneath it an enormous, intricate root system spreads far and wide, many times bigger than the sprout above.",
  stonecutter:
    "A stonecutter's hammer striking a huge granite boulder at the exact moment it splits cleanly in two, stone dust in the sunlight, countless chips and marks from earlier blows all over the rock.",
  iceberg:
    "A split-level view of an iceberg in a calm blue sea under a bright sky: a small tip above the waterline and, below the surface, a colossal mass of blue ice going down into clear water.",
  stairs_fog:
    "A lone athlete climbing a long stone staircase that disappears into soft morning mist, seen from behind, sunlight breaking through the mist above.",
  water_stone:
    "Close-up of a single drop of water falling onto a stone in daylight, a smooth deep hollow worn into the rock by years of drops, light glinting on the water.",
  year_dots:
    "A worn leather training journal lying open on a gym bench, pages full of handwritten entries too small and blurred to read, chalk dust and a pencil beside it, bright morning light.",
  switchback:
    "A zigzag switchback trail up a steep green mountain at sunrise, a single hiker most of the way up, the summit lit gold.",
  sunrise_rack:
    "An empty, quiet strength gym at sunrise, golden light streaming through tall windows onto a loaded barbell resting in a squat rack.",
  seed_to_tree:
    "A row across rich soil in soft morning light showing a seed, a sprout, a young sapling and a full-grown tree, like a time-lapse in a single frame.",
};

/** What kind of automated post it is, for its picture (null: not one that gets a made picture). */
export type PictureKind =
  | "monday_motivation"
  | "tuesday_tips"
  | "wednesday_wins"
  | "try_it_thursday"
  | "finish_strong_friday"
  | "saturday_spirit"
  | "sunday_recap"
  | "lesson"
  | "holiday"
  | "birthday"
  /** A daily picture (daily-visuals.ts): made again from its own day's scene. */
  | "daily_visual";

const KINDS: PictureKind[] = [
  "monday_motivation",
  "tuesday_tips",
  "wednesday_wins",
  "try_it_thursday",
  "finish_strong_friday",
  "saturday_spirit",
  "sunday_recap",
  "lesson",
  "holiday",
  "daily_visual",
];

/** A post (or library item) the app makes, and so can get a made photo (the coach's New picture): its kind. */
export function pictureKind(p: {
  series?: string | null;
  series_data?: unknown;
}): PictureKind | null {
  if (p.series && (KINDS as string[]).includes(p.series)) return p.series as PictureKind;
  const d = p.series_data as { birthday?: unknown } | null | undefined;
  return !p.series && d && typeof d === "object" && d.birthday ? "birthday" : null;
}

/**
 * The kinds that get a made photo by themselves (post-pictures-tick): only
 * Saturday's scene, a picture idea with no chart, diagram or words card of
 * its own. Everything else already has a cover that says more than a stock
 * gym shot would, and a feed of made photos reads as AI.
 */
export const AUTO_PICTURE_KINDS: readonly PictureKind[] = ["saturday_spirit"];

export function picturedByItself(kind: PictureKind | null): boolean {
  return !!kind && AUTO_PICTURE_KINDS.includes(kind);
}

/** The shot for each kind of post (Saturday's comes from its scene). */
export const KIND_PICTURE: Record<Exclude<PictureKind, "saturday_spirit">, string> = {
  monday_motivation:
    "An athlete in a bright, clean strength gym getting ready to start the week's first session: chalking up, setting up a barbell or tightening a belt, morning light.",
  tuesday_tips:
    "A real close-up in a bright strength gym of exactly what the tip is about (the lift, the body position, the grip or the equipment it mentions), clear enough to teach from, like a coach's photo of a cue.",
  wednesday_wins:
    "A candid moment in a bright strength gym right after a big lift: a high five between training partners, chalky hands, a loaded barbell, everyone seen from behind or the side.",
  try_it_thursday:
    "An athlete checking their phone between sets in a bright gym, the screen turned away or too blurred to read, a barbell or dumbbells nearby.",
  finish_strong_friday:
    "An athlete finishing the last hard set of the week in a bright strength gym, racking the bar or catching their breath, sweat and chalk, warm late-day light.",
  sunday_recap:
    "A calm Sunday reset on a bright kitchen table in soft daylight: an open training journal, a water bottle, lifting shoes and a couple of meal-prep containers.",
  lesson:
    "A real, clear photo of what the lesson is about (the lift, the position, the habit or the idea), like the cover photo of a coach's educational post.",
  holiday:
    "The holiday's feeling in a real, warm everyday scene (people together, the food, the season), bright and joyful.",
  birthday:
    "A birthday cake with lit candles sitting on a bench in a bright strength gym, a few balloons, cheerful and warm.",
  // made again from the day's own scene (daily-visuals.server.ts repictureDailyPost); this is only the fallback
  daily_visual: "A calm, clean everyday scene that shows the post's feeling without words.",
};

const clean = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** The prompt for a Saturday scene's picture; the post's own words set the mood. */
export function scenePicturePrompt(scene: SpiritSceneKey, caption?: string | null): string {
  const words = clean(caption).slice(0, 200);
  return [
    `A picture for a strength coach's Saturday post. ${SCENE_PICTURE[scene]}`,
    words
      ? `The post says: "${words}". The picture should make that feeling land without any words.`
      : "",
    PICTURE_STYLE,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The prompt for any automated post's photo: its kind's shot, then what it says. */
export function postPicturePrompt(
  kind: PictureKind,
  caption?: string | null,
  opts: { scene?: SpiritSceneKey | null; title?: string | null } = {},
): string {
  if (kind === "saturday_spirit" && opts.scene) return scenePicturePrompt(opts.scene, caption);
  const shot =
    kind === "saturday_spirit"
      ? "A real, simple scene that makes the post's feeling land."
      : KIND_PICTURE[kind];
  const words = clean([opts.title, caption].filter(Boolean).join(". ")).slice(0, 320);
  return [
    `The cover photo for a strength coach's Instagram post. ${shot}`,
    words
      ? `The post says: "${words}". The photo should fit what it's about without showing any words.`
      : "",
    PICTURE_STYLE,
  ]
    .filter(Boolean)
    .join(" ");
}

/** An image file's type and size from its first bytes (PNG, JPEG, WebP), or null. */
export function imageSize(
  bytes: Uint8Array,
): { mime: string; width: number; height: number } | null {
  const b = bytes;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", width: u32be(16), height: u32be(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // start of frame (not DHT 0xc4, JPG 0xc8, DAC 0xcc)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { mime: "image/jpeg", width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (
    b.length >= 30 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8X")
      return {
        mime: "image/webp",
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    if (kind === "VP8 ")
      return { mime: "image/webp", width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: "image/webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
