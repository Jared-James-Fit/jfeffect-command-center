/**
 * Share to Instagram (a coach's ⋯ on any post): what goes out, and the one
 * tap that sends it.
 *
 * Instagram never takes a caption from another app (it drops shared text for
 * every app, not just ours), so the tap copies the caption and hands the
 * picture or clip to the phone's share sheet, where Instagram opens its own
 * composer with it; the caption is a paste away. A computer has no Instagram
 * in its share sheet: there the files download and the caption is copied.
 *
 * What goes out:
 *  - a post with its own photos / clips: those files, in order, as posted
 *    (already framed 4:5, 1:1 or 16:9 in the studio, all shapes Instagram's
 *    feed takes);
 *  - a lesson: its card (title + diagram, the belief struck out, the week's
 *    three things), then any photo the coach put on it;
 *  - Wins, the Recap, a holiday, Saturday's scene, a workout, words: a card
 *    painted from the post (instagram-cards.ts), 4:5 for the feed or 9:16
 *    for a story.
 * The caption is the post's words, with anyone it tags as their plain first
 * name (an in-app @username would tag a stranger on Instagram).
 */
import { extraHoliday, extraScene, isRecapStats, isWinsStats, postSlides, splitMentions, type CommunityPost, type PostSlide } from "@/lib/community";
import { extraLesson, type LessonTrack } from "@/lib/lessons";

export type IgFormat = "feed" | "story";

/** A card painted from the post (instagram-cards.ts). */
export type IgCard = "lesson" | "wins" | "recap" | "workout" | "holiday" | "scene" | "words";

/** What goes to Instagram: a painted card (first), then the post's own photos / clips. */
export type IgPlan = { card: IgCard | null; slides: PostSlide[] };

export const IG_CAPTION_MAX = 2200;

export const IG_SIZES: Record<IgFormat, { w: number; h: number; safeTop: number; safeBottom: number }> = {
  feed: { w: 1080, h: 1350, safeTop: 88, safeBottom: 88 },
  // a story keeps its words clear of Instagram's own name row and reply bar
  story: { w: 1080, h: 1920, safeTop: 250, safeBottom: 280 },
};

export function instagramPlan(post: CommunityPost): IgPlan {
  const slides = postSlides(post);
  if (post.series === "lesson" && extraLesson(post)) return { card: "lesson", slides };
  if (slides.length) return { card: null, slides };
  if (post.series === "sunday_recap" && isRecapStats(post.series_data)) return { card: "recap", slides: [] };
  if (isWinsStats(post.series_data)) return { card: "wins", slides: [] };
  if (post.series === "holiday" && extraHoliday(post.series_extra)) return { card: "holiday", slides: [] };
  if (post.series === "saturday_spirit" && extraScene(post.series_extra)) return { card: "scene", slides: [] };
  if (post.kind !== "note" && post.stats) return { card: "workout", slides: [] };
  return { card: "words", slides: [] };
}

/** Only a painted card comes in two shapes; a photo or clip goes as posted (Instagram's composer picks feed or story). */
export function hasFormatChoice(plan: IgPlan): boolean {
  return plan.card !== null;
}

/* ------------------------------------------------------------------ */
/*  Caption                                                            */
/* ------------------------------------------------------------------ */

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A caption's tags as plain first names: "@marc_lifts hit 405" → "Marc hit 405". */
export function plainMentions(text: string, mentions: CommunityPost["mentions"]): string {
  return splitMentions(text, mentions)
    .map((p) => (p.mention ? firstName(p.mention.name) : p.text))
    .join("");
}

const TRACK_TAGS: Record<LessonTrack, string[]> = {
  strength: ["powerlifting", "strengthtraining", "strengthcoach"],
  hypertrophy: ["hypertrophy", "musclebuilding", "bodybuilding"],
  truth: ["strengthtraining", "fitnessmindset", "gymtruths"],
  methods: ["bodybuilding", "hypertrophy", "gymtips"],
  mind: ["fitnessmindset", "recovery", "strengthtraining"],
  fix: ["powerlifting", "liftingtechnique", "strengthcoach"],
  reset: ["sundayreset", "weeklyplanning", "consistency"],
};

/** A few tags that fit the post, then the brand's. Shown in the caption, where the coach can change them. */
export function instagramTags(post: CommunityPost): string[] {
  const lesson = extraLesson(post);
  const base = lesson
    ? TRACK_TAGS[lesson.track]
    : isWinsStats(post.series_data)
      ? ["strengthcommunity", "powerlifting", "strengthtraining"]
      : post.stats
        ? ["powerlifting", "strengthtraining", "personalrecord"]
        : ["strengthtraining", "fitnessmotivation"];
  return [...base, "jfeffect"].map((t) => `#${t}`);
}

/** The post's words, as Instagram should get them: a quote and who said it, then the caption. */
export function instagramCaptionBody(post: CommunityPost): string {
  const parts: string[] = [];
  const quote = post.quote?.trim();
  if (quote) parts.push(`“${quote}”${post.quote_author?.trim() ? `\n${post.quote_author.trim()}` : ""}`);
  const caption = post.caption?.trim();
  if (caption) parts.push(plainMentions(caption, post.mentions));
  return parts.join("\n\n");
}

/** The whole caption, hashtags on their own line at the end when they're on. Never over Instagram's 2,200. */
export function instagramCaption(post: CommunityPost, opts: { tags: boolean }): string {
  const body = instagramCaptionBody(post);
  const tags = opts.tags ? instagramTags(post).join(" ") : "";
  return withTags(body, tags);
}

/** `body` with `tags` after a blank line (or alone), trimmed to fit. */
export function withTags(body: string, tags: string): string {
  const b = body.trim();
  if (!tags) return b.slice(0, IG_CAPTION_MAX);
  const room = IG_CAPTION_MAX - tags.length - 2;
  return b ? `${b.slice(0, Math.max(0, room)).trimEnd()}\n\n${tags}` : tags;
}

/** Turn the tag line on or off in a caption the coach may have edited (his words stay as they are). */
export function toggleTags(caption: string, tags: string, on: boolean): string {
  const t = caption.replace(/\s+$/, "");
  const has = t.endsWith(tags);
  if (on) return has ? t : withTags(t, tags);
  return has ? t.slice(0, t.length - tags.length).replace(/\s+$/, "") : t;
}

/**
 * A heads-up when the post shows someone other than the coach: their post,
 * or names in it. Instagram is public, the crew isn't.
 */
export function instagramHeadsUp(post: CommunityPost): string | null {
  if (!post.is_mine && !post.author.is_coach) return `This is ${firstName(post.author.name)}'s post. Make sure they're good with it going on your Instagram.`;
  const names = [...(post.collaborators ?? []), ...(post.mentions ?? [])]
    .filter((p) => !p.is_coach)
    .map((p) => firstName(p.name))
    .filter((n, i, a) => a.indexOf(n) === i);
  if (names.length) return `It names ${listNames(names)}. Make sure they're good with it going public.`;
  if (isRecapStats(post.series_data) && post.series_data.top.length) return "Its biggest moments name people from the crew. Make sure they're good with it going public.";
  return null;
}

function listNames(n: string[]): string {
  if (n.length <= 2) return n.join(" and ");
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/*  Files                                                              */
/* ------------------------------------------------------------------ */

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/** "jfeffect-2026-10-21-2.jpg" */
export function instagramFileName(post: Pick<CommunityPost, "created_at">, index: number, type: string): string {
  const day = (post.created_at || new Date().toISOString()).slice(0, 10);
  return `jfeffect-${day}-${index + 1}.${EXT[type.split(";")[0]] ?? (type.startsWith("video/") ? "mp4" : "jpg")}`;
}

/** The type a file should carry: the server's, else what its path says. */
export function mediaType(blobType: string, path: string, kind: "image" | "video"): string {
  if (blobType && blobType !== "application/octet-stream") return blobType;
  const ext = path.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const found = Object.entries(EXT).find(([, e]) => e === ext || (ext === "jpeg" && e === "jpg"));
  return found ? found[0] : kind === "video" ? "video/mp4" : "image/jpeg";
}

/* ------------------------------------------------------------------ */
/*  The tap                                                            */
/* ------------------------------------------------------------------ */

/** A phone or tablet: its share sheet is where Instagram lives. */
export function isTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  // iPadOS reports itself as a Mac
  return /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || !files.length) return false;
  try {
    return !navigator.canShare || navigator.canShare({ files });
  } catch {
    return false;
  }
}

/** Copy with a hidden box: works where the async clipboard doesn't (older WebViews), as long as it runs in the tap. */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  // 16px so iOS doesn't zoom; off screen so nothing moves
  box.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
  document.body.appendChild(box);
  const active = document.activeElement as HTMLElement | null;
  try {
    box.select();
    box.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
    active?.focus?.({ preventScroll: true });
  }
}

/** Copy text. Starts inside the tap (both ways need it), resolves to whether it landed. */
export function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => legacyCopy(text),
      );
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(legacyCopy(text));
}

export function downloadFiles(files: File[]): boolean {
  if (typeof document === "undefined") return false;
  try {
    files.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      // a beat apart, or browsers keep only the first
      window.setTimeout(() => {
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, i * 250);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * shared: the share sheet took it · cancelled: closed without picking ·
 * again: the phone wouldn't open the sheet from this tap (the caption is
 * copied; one more tap shares) · saved: downloaded (a computer) · failed.
 */
export type IgOutcome = "shared" | "cancelled" | "again" | "saved" | "failed";

/**
 * The one tap: copy the caption, then open the share sheet with the files
 * (both started in the tap itself, before anything is awaited, or iOS
 * refuses them). `caption: null` shares without copying (the second tap).
 */
export async function sendToInstagram(files: File[], caption: string | null): Promise<{ outcome: IgOutcome; copied: boolean }> {
  const copying = caption != null ? copyText(caption) : Promise.resolve(false);
  if (isTouchDevice() && canShareFiles(files)) {
    let outcome: IgOutcome;
    try {
      await navigator.share({ files });
      outcome = "shared";
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      outcome = name === "AbortError" ? "cancelled" : name === "NotAllowedError" ? "again" : downloadFiles(files) ? "saved" : "failed";
    }
    return { outcome, copied: await copying };
  }
  const saved = downloadFiles(files);
  return { outcome: saved ? "saved" : "failed", copied: await copying };
}
