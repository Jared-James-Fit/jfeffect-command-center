import { fallbackEmoji } from "@/lib/gif-fallback";
import type { MediaItem } from "@/lib/media/media";

/**
 * A picked GIF / sticker as a chat attachment (1:1 chats, group chats, story
 * replies). It carries everything needed to draw it later (shape, a light
 * preview, a still frame), so a bubble never asks the provider again.
 * The link is the provider's own: nothing is uploaded.
 */
export function mediaAttachment(m: MediaItem) {
  return {
    type: "image" as const,
    kind: m.kind,
    url: m.url,
    name: m.title,
    mime: m.kind === "sticker" ? "image/webp" : m.url.endsWith(".webp") ? "image/webp" : "image/gif",
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    preview: m.preview !== m.url ? m.preview : null,
    still: m.still,
    category: m.category ?? undefined,
    fallback_emoji: fallbackEmoji(m.title, m.category ?? (m.kind === "sticker" ? "Sticker" : null)),
  };
}

/** Is this attachment a GIF or sticker (drawn by SentMediaView)? */
export const isPickedMedia = (a: { kind?: string | null } | null | undefined) => a?.kind === "gif" || a?.kind === "sticker";
