/**
 * Pictures for automated posts, made by an image model (pure parts: the
 * prompts and reading an image's size). Saturday Spirit's scenes go out as a
 * real picture instead of the app's own drawing; the server side is
 * post-pictures.server.ts.
 */
import type { SpiritSceneKey } from "@/components/community/spirit-scenes";

/** How every post picture looks: one style, so the feed reads as one account. */
export const PICTURE_STYLE = [
  "Style: cinematic, photorealistic, editorial quality, like a premium strength brand's Instagram.",
  "Moody, dramatic natural light, deep shadows and rich blacks, warm red (#ef3340) and gold (#fbbf24) highlights used sparingly.",
  "One clear subject, simple uncluttered background, shallow depth of field, vertical portrait composition (4:5) with the subject centred and room around it.",
  "Absolutely no text, letters, numbers, logos or watermarks anywhere in the image.",
].join(" ");

/** Each Saturday scene as a picture: the same idea as the drawing, shot for real. */
export const SCENE_PICTURE: Record<SpiritSceneKey, string> = {
  keep_digging:
    "A lone miner deep in a dark rock tunnel, mid-swing with a pickaxe, lit only by his headlamp; just beyond the rock face in front of him, unseen by him, a thick vein of glowing gold.",
  bamboo_roots:
    "A single tiny bamboo sprout breaking through dark soil at sunrise, shown in a cross-section of the earth: underneath it an enormous, intricate root system spreads far and wide, softly glowing, many times bigger than the sprout above.",
  stonecutter:
    "A stonecutter's hammer striking a huge granite boulder at the exact moment it splits cleanly in two, stone dust hanging in a beam of light, countless chips and marks from earlier blows all over the rock.",
  iceberg:
    "A split-level view of an iceberg in a calm dark sea at dusk: a small tip above the waterline and, below the surface, a colossal mass of blue ice disappearing into the deep.",
  stairs_fog:
    "A lone athlete climbing a long stone staircase that disappears into thick fog, seen from behind, warm light breaking through the fog above.",
  water_stone:
    "Close-up of a single drop of water falling onto a dark stone, a smooth deep hollow worn into the rock by years of drops, light glinting on the water.",
  year_dots:
    "A worn leather training journal lying open on a gym bench, pages full of handwritten entries too small and blurred to read, chalk dust and a pencil beside it, early morning light.",
  switchback:
    "A zigzag switchback trail up a steep mountain at night under a sky full of stars, a single headlamp most of the way up, the summit edged with the first light of dawn.",
  sunrise_rack:
    "An empty, quiet strength gym at sunrise, golden light streaming through tall windows onto a loaded barbell resting in a squat rack, dust in the air.",
  seed_to_tree:
    "A row across dark soil in soft morning light showing a seed, a sprout, a young sapling and a full-grown tree, like a time-lapse in a single frame.",
};

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The prompt for a Saturday scene's picture; the post's own words set the mood. */
export function scenePicturePrompt(scene: SpiritSceneKey, caption?: string | null): string {
  const words = clean(caption).slice(0, 200);
  return [
    `A picture for a strength coach's Saturday post. ${SCENE_PICTURE[scene]}`,
    words ? `The post says: "${words}". The picture should make that feeling land without any words.` : "",
    PICTURE_STYLE,
  ]
    .filter(Boolean)
    .join(" ");
}

/** An image file's type and size from its first bytes (PNG, JPEG, WebP), or null. */
export function imageSize(bytes: Uint8Array): { mime: string; width: number; height: number } | null {
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
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { mime: "image/webp", width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: "image/webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
