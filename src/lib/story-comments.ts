/**
 * Story comments, Instagram's way (Nov 26 2026): a story's newest public
 * comments float over its bottom-left as small overlays (avatar, name, words),
 * and a tap opens every comment in a light panel that's part of the story,
 * never the feed's comment sheet. Comments are public (everyone who can see
 * the story); the "Message …" field under it is a private reply. Pure, tested
 * (story-comments.test.ts).
 */
import type { CommentPreview, CommunityAuthor, CommunityComment } from "@/lib/community";

/** How many comments float over a story at once (the newest, oldest first so the newest sits lowest). */
export const STORY_PEEK_MAX = 2;

/** How long a moment has to be on screen before its comments are read live (quick taps through never fetch). */
export const STORY_COMMENTS_DWELL_MS = 600;

export type StoryPeekItem = {
  id: string;
  author: CommunityAuthor;
  /** Its words ("" when it's only a photo / GIF / voice memo). */
  body: string;
  /** "a GIF", "a photo"…: said when there are no words. */
  media: string | null;
  /** Just sent from this phone, not saved yet. */
  pending: boolean;
};

const MEDIA_WORD: Record<string, string> = { video: "a video", gif: "a GIF", audio: "a voice memo", image: "a photo" };

/**
 * What floats over a story: the newest top-level comments that are showing,
 * from the live thread when it's loaded (with what you just sent), else the
 * post's own preview (which came with the story, so nothing waits on a fetch).
 */
export function peekComments(
  preview: CommentPreview[] | null | undefined,
  live: CommunityComment[] | null | undefined,
  max = STORY_PEEK_MAX,
): StoryPeekItem[] {
  if (live) {
    return live
      .filter((c) => !c.parent_id && !c.hidden)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-max)
      .map((c) => ({
        id: c.id,
        author: c.author,
        body: (c.body ?? "").trim(),
        media: c.media ? MEDIA_WORD[c.media.type] ?? "a photo" : null,
        pending: !!c.pending,
      }));
  }
  return [...(preview ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-max)
    .map((c) => ({ id: c.id, author: c.author, body: (c.body ?? "").trim(), media: c.media ? "a photo" : null, pending: false }));
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|[#*0-9]️?⃣|\s)+$/u;

/** How many emoji (whole, with their skin tones and joins) a string is. */
function graphemes(s: string): number {
  const seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<unknown> } }).Segmenter;
  if (seg) return Array.from(new seg(undefined, { granularity: "grapheme" }).segment(s.replace(/\s+/g, ""))).length;
  return Array.from(s.replace(/\s+/g, "")).length;
}

/**
 * A comment that's only one to three emoji reads as a sticker (shown big, no
 * bubble), Instagram's way. Numbers and words never are.
 */
export function isStickerText(body: string | null | undefined): boolean {
  const t = (body ?? "").trim();
  if (!t || !EMOJI_ONLY.test(t) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t)) return false;
  return graphemes(t) <= 3;
}

/** "Comments", "1 comment", "12 comments": the panel's header and the overlay's label. */
export function commentCountWords(n: number): string {
  if (n <= 0) return "Comments";
  return n === 1 ? "1 comment" : `${n} comments`;
}

/** The stickers a story comment can be in one tap (the training ones first). */
export const STORY_COMMENT_STICKERS = ["🔥", "💪", "👏", "🙌", "😤", "🐐", "💯", "😍"] as const;
