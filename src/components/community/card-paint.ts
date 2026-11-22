import { paintShareCard, type ShareCardData, type ShareCardMedia, type ShareFormat } from "@/lib/workout-share-card";
import type { CameraCard } from "@/components/community/share-studio";

/** Paint a card (its own painter when it's a story filter) over a picture. */
export function paintCard(canvas: HTMLCanvasElement, c: CameraCard, media: ShareCardMedia | null, format: ShareFormat | { w: number; h: number }, lockedIn: ShareCardData["lockedIn"], logo: HTMLImageElement | null, scale: number) {
  if (c.paint) return c.paint(canvas, media, format, scale, logo);
  // a share card is a story's 9:16 or the feed's 4:5 (the composer only puts one on those shapes)
  const fmt: ShareFormat = typeof format === "string" ? format : Math.abs(format.w / format.h - 9 / 16) < 0.02 ? "story" : "feed";
  paintShareCard(canvas, { ...c.data, format: fmt, lockedIn, template: c.look, media }, logo, scale);
}
