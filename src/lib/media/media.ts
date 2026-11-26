/**
 * One shape for every GIF and sticker in the app, whoever serves it.
 *
 * A provider (KLIPY, the app's own library, any future one) turns its own
 * results into `MediaItem`s; the picker, the composers and every renderer only
 * ever see this. Media is always referenced by its provider's public link,
 * never re-uploaded or copied into our storage.
 *
 * Pure: no network, no React. Tested in media.test.ts.
 */

export type MediaKind = "gif" | "sticker";
export type MediaProvider = "klipy" | "library";

export type MediaItem = {
  /** `${provider}:${kind}:${providerId}`: stable across sessions (favourites, recents). */
  ref: string;
  provider: MediaProvider;
  kind: MediaKind;
  /** The provider's own id or slug (KLIPY's slug, the library row's uuid). */
  providerId: string;
  title: string;
  /** What's sent and shown in a bubble / comment (~300px animated). */
  url: string;
  /** A light animated rendition for the picker grid. */
  preview: string;
  /** A still frame for reduced motion and offscreen tiles (may equal preview). */
  still: string | null;
  /** Video rendition (smaller than GIF for big animations), if the provider has one. */
  mp4: string | null;
  width: number | null;
  height: number | null;
  /** A tiny base64 placeholder, when the provider sends one. */
  blur: string | null;
  /** Library-only: the old category label (emoji fallback). */
  category?: string | null;
};

/** What a message attachment / comment carries to draw it later without the provider. */
export type SentMedia = {
  kind: MediaKind;
  url: string;
  preview: string | null;
  still: string | null;
  width: number | null;
  height: number | null;
  title: string;
  ref: string;
};

export const toSent = (m: MediaItem): SentMedia => ({
  kind: m.kind,
  url: m.url,
  preview: m.preview !== m.url ? m.preview : null,
  still: m.still,
  width: m.width,
  height: m.height,
  title: m.title,
  ref: m.ref,
});

/**
 * Hosts whose media may be referenced directly. Anything else is refused on
 * the server too (`public.is_allowed_media_url`), so a comment can never carry
 * an arbitrary link. Keep in step with the SQL.
 */
export const ALLOWED_MEDIA_DOMAIN = "klipy.com";

/** A KLIPY CDN link (https, klipy.com or a subdomain). Library links are checked against the library itself. */
export function isAllowedMediaUrl(url: string | null | undefined): boolean {
  if (!url || url.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return u.hostname === ALLOWED_MEDIA_DOMAIN || u.hostname.endsWith(`.${ALLOWED_MEDIA_DOMAIN}`);
}

/**
 * The picker's categories, in order. Each is a search on the live provider;
 * `library` matches the app's own library rows (old category names and tags)
 * so the picker still has something when the provider is down.
 */
export const MEDIA_CATEGORIES: { label: string; q: string; library: string[] }[] = [
  { label: "Gym", q: "gym workout", library: ["gym", "Gym Pain", "Cardio"] },
  { label: "Powerlifting", q: "powerlifting deadlift", library: ["powerlifting", "deadlift", "squat", "bench"] },
  { label: "Bodybuilding", q: "bodybuilding flex", library: ["bodybuilding", "flex", "pump"] },
  { label: "Motivation", q: "motivation lets go", library: ["motivation", "Hype"] },
  { label: "Discipline", q: "discipline grind", library: ["discipline", "grind"] },
  { label: "Hype", q: "hype lets go", library: ["Hype"] },
  { label: "PRs", q: "new record winning", library: ["PR / Wins", "pr"] },
  { label: "Celebration", q: "celebration", library: ["Celebration"] },
  { label: "Respect", q: "respect salute", library: ["respect", "Coach Reactions"] },
  { label: "Encouragement", q: "you got this", library: ["Support"] },
  { label: "Funny", q: "funny", library: ["Funny"] },
  { label: "Memes", q: "meme", library: ["meme", "Funny"] },
  { label: "Reactions", q: "reaction", library: ["Coach Reactions", "Reviewed"] },
  { label: "Relatable", q: "mood relatable", library: ["Excuses", "Deload / Dead"] },
  { label: "Shocked", q: "shocked omg", library: ["shocked", "wow"] },
  { label: "Laughing", q: "laughing lol", library: ["laugh", "lol"] },
  { label: "Sarcasm", q: "sarcastic sure", library: ["sarcasm", "sure"] },
  { label: "Fail", q: "fail", library: ["fail", "Deload / Dead"] },
  { label: "Yes", q: "yes agree", library: ["yes", "agree"] },
  { label: "No", q: "no nope", library: ["no", "nope"] },
  { label: "Love", q: "love heart", library: ["love", "heart"] },
  { label: "Thanks", q: "thank you", library: ["thanks"] },
  { label: "Tired", q: "tired exhausted", library: ["tired", "Deload / Dead"] },
  { label: "Food", q: "hungry food", library: ["Food / Diet"] },
];

/** Search ideas shown under an empty search box (and as the box's examples). */
export const SEARCH_SUGGESTIONS = ["lets go", "PR", "deadlift", "leg day", "beast mode", "proud of you", "lol", "bruh", "cardio", "rest day"];

/** Live suggestions while typing: the user's own past searches first, then known ideas. */
export function suggestFor(q: string, history: string[], limit = 6): string[] {
  const t = q.trim().toLowerCase();
  const pool = [...history, ...SEARCH_SUGGESTIONS, ...MEDIA_CATEGORIES.map((c) => c.label.toLowerCase())];
  const out: string[] = [];
  for (const s of pool) {
    const v = s.trim();
    if (!v) continue;
    const lv = v.toLowerCase();
    if (t && (!lv.startsWith(t) && !lv.includes(` ${t}`))) continue;
    if (lv === t) continue;
    if (out.some((o) => o.toLowerCase() === lv)) continue;
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/** Remember a search (most recent first, no repeats, short). */
export function pushHistory(history: string[], q: string, max = 8): string[] {
  const v = q.trim();
  if (v.length < 2) return history;
  return [v, ...history.filter((h) => h.toLowerCase() !== v.toLowerCase())].slice(0, max);
}

/** Merge pages without repeats (a provider can return an item on two pages). */
export function mergeUnique(pages: MediaItem[][]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const p of pages) for (const m of p) {
    if (seen.has(m.ref) || seen.has(m.url)) continue;
    seen.add(m.ref);
    seen.add(m.url);
    out.push(m);
  }
  return out;
}

/** A sensible box for a sent GIF / sticker: its own shape, never cropped, never wider than `max`. */
export function displayBox(width: number | null | undefined, height: number | null | undefined, max = 220, kind: MediaKind = "gif") {
  const cap = kind === "sticker" ? Math.round(max * 0.72) : max;
  if (!width || !height || width <= 0 || height <= 0) return { width: cap, height: cap };
  const r = width / height;
  if (r >= 1) return { width: cap, height: Math.max(40, Math.round(cap / r)) };
  return { width: Math.max(40, Math.round(cap * r)), height: cap };
}

/**
 * A post stores one link (`gif_url`). A sticker is marked with `#sticker` so
 * it's drawn without a tile; the fragment never reaches the CDN.
 */
export const postMediaUrl = (m: Pick<MediaItem, "url" | "kind">) => (m.kind === "sticker" ? `${m.url.split("#")[0]}#sticker` : m.url.split("#")[0]);
export const postMediaKind = (url: string | null | undefined): MediaKind => (url?.endsWith("#sticker") ? "sticker" : "gif");

/* ---- provider parsers (pure) -------------------------------------------- */

type KFormat = { url?: string; width?: number; height?: number; size?: number };
type KSize = { gif?: KFormat; webp?: KFormat; mp4?: KFormat; webm?: KFormat; jpg?: KFormat; png?: KFormat };
type KItem = { id?: number | string; slug?: string; title?: string; type?: string; blur_preview?: string; file?: Record<string, KSize> };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const good = (f?: KFormat) => (f?.url && isAllowedMediaUrl(f.url) ? f : undefined);

/**
 * KLIPY's search / trending response → MediaItems. Tolerant of shape changes:
 * ads and anything without a usable https link on KLIPY's CDN are dropped.
 * Stickers keep transparency (webp / png / gif, never jpg or mp4 as the main link).
 */
export function parseKlipy(json: unknown, kind: MediaKind): { items: MediaItem[]; hasNext: boolean } {
  const root = (json ?? {}) as { data?: { data?: KItem[]; has_next?: boolean } | KItem[] };
  const data = Array.isArray(root.data) ? root.data : root.data?.data;
  const hasNext = !Array.isArray(root.data) && !!root.data?.has_next;
  const items: MediaItem[] = [];
  for (const it of data ?? []) {
    if (!it || (it.type && it.type !== "gif" && it.type !== "sticker" && it.type !== "clip")) continue;
    const f = it.file ?? {};
    const md = f.md ?? f.hd ?? f.sm ?? {};
    const sm = f.sm ?? f.xs ?? md;
    const xs = f.xs ?? sm;
    const main = kind === "sticker" ? good(md.webp) ?? good(md.png) ?? good(md.gif) : good(md.gif) ?? good(md.webp);
    if (!main?.url) continue;
    const preview = kind === "sticker" ? good(sm.webp) ?? good(sm.png) ?? main : good(sm.webp) ?? good(sm.gif) ?? main;
    const still = kind === "sticker" ? good(xs.png) ?? null : good(xs.jpg) ?? good(sm.jpg) ?? null;
    const id = String(it.slug ?? it.id ?? "");
    if (!id) continue;
    items.push({
      ref: `klipy:${kind}:${id}`,
      provider: "klipy",
      kind,
      providerId: id,
      title: (it.title ?? "").trim().slice(0, 120) || (kind === "sticker" ? "Sticker" : "GIF"),
      url: main.url,
      preview: preview.url!,
      still: still?.url ?? null,
      mp4: kind === "gif" ? good(md.mp4)?.url ?? null : null,
      width: num(main.width),
      height: num(main.height),
      blur: typeof it.blur_preview === "string" && it.blur_preview.startsWith("data:image/") ? it.blur_preview : null,
    });
  }
  return { items, hasNext };
}

/** A row of the app's own library (`chat_gifs`) → MediaItem. */
export type LibraryRow = {
  id: string;
  title: string;
  category: string;
  tags: string[] | null;
  media_url: string;
  media_type: string | null;
  thumb_url: string | null;
  kind?: string | null;
  width?: number | null;
  height?: number | null;
  is_featured?: boolean | null;
};

export function fromLibrary(r: LibraryRow): MediaItem {
  const kind: MediaKind = r.kind === "sticker" ? "sticker" : "gif";
  return {
    ref: `library:${kind}:${r.id}`,
    provider: "library",
    kind,
    providerId: r.id,
    title: r.title,
    url: r.media_url,
    preview: r.thumb_url || r.media_url,
    still: null,
    mp4: r.media_type?.startsWith("video/") ? r.media_url : null,
    width: r.width ?? null,
    height: r.height ?? null,
    blur: null,
    category: r.category,
  };
}

/** Library search: title, category and tags, optionally limited to a picker category. */
export function filterLibrary(rows: LibraryRow[], kind: MediaKind, q: string, category?: string | null): LibraryRow[] {
  const t = q.trim().toLowerCase();
  const cat = category ? MEDIA_CATEGORIES.find((c) => c.label === category) : null;
  const words = cat ? cat.library.map((w) => w.toLowerCase()) : [];
  return rows.filter((r) => {
    if ((r.kind === "sticker" ? "sticker" : "gif") !== kind) return false;
    const hay = [r.title, r.category, ...(r.tags ?? [])].map((s) => s.toLowerCase());
    if (words.length && !words.some((w) => hay.some((h) => h.includes(w)))) return false;
    if (t && !hay.some((h) => h.includes(t))) return false;
    return true;
  });
}
