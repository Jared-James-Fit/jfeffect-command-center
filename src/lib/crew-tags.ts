/**
 * Tagging people on a post or a story (Nov 22 2026). A tag is what the crew
 * has always used: "@username" in the caption, which the database reads into
 * the post's mentions (community_caption_mentions → community_post_mentions:
 * their @ is tappable, 1-3 of them make it a collab). Tag people only adds
 * the handles nobody typed, on a line of their own at the end, so a tag is
 * never doubled and the caption stays what they wrote.
 */
export type Taggable = { user_id: string; name: string; username?: string | null };

/** How a person is tagged: their @username (else their name, which the database also reads). */
export const tagHandle = (p: Taggable): string => (p.username?.trim() || p.name.trim()).replace(/^@/, "");

/** Is this person already tagged in the caption (as "@handle", whole, any case)? */
export function captionTags(caption: string, p: Taggable): boolean {
  const h = tagHandle(p).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w@])@${h}(?![\\w]|\\.[\\w])`, "i").test(caption);
}

/** The caption with every tagged person's @ in it: the ones not there yet go on a line at the end. */
export function withTags(caption: string, tags: Taggable[]): string {
  const missing = uniqueTags(tags).filter((p) => !captionTags(caption, p));
  if (!missing.length) return caption;
  const line = missing.map((p) => `@${tagHandle(p)}`).join(" ");
  const base = caption.trimEnd();
  return base ? `${base}\n\n${line}` : line;
}

/** Each person once, in the order tagged. */
export function uniqueTags<T extends Taggable>(tags: T[]): T[] {
  const seen = new Set<string>();
  return tags.filter((p) => (seen.has(p.user_id) ? false : (seen.add(p.user_id), true)));
}

/** "Marc" · "Marc and Dwayne" · "Marc, Dwayne and 2 others" (the Tag people row's value). */
export function tagSummary(tags: Taggable[]): string {
  const names = uniqueTags(tags).map((p) => p.name.split(/\s+/)[0]);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? "" : "s"}`;
}

/** Most people a post or story tags (more than that reads as a shout-out list, not a tag). */
export const MAX_TAGS = 10;
