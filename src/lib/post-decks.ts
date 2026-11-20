/**
 * Decks: an automated post's slides (Nov 20 2026). A lesson, a Tuesday tip or
 * an older series post is a set of slides painted as its picture
 * (instagram-cards.ts `paintDeckSlide`) with a caption of its own: a
 * carousel when the idea earns several screens (a hook, the slides that build
 * it, a takeaway), one slide when it's one sharp idea. The slides carry the
 * teaching; the caption is the coach talking about it (his take, when it
 * applies, who it doesn't), never the slides again.
 *
 * Pure and small (the feed reads it): the shape, how a deck is read off a
 * post, and the look it gets (a theme other than the posts just before it).
 * The checks a deck passes before it's published are post-deck-checks.ts,
 * the painter deck-cards.ts, the writer post-decks.server.ts.
 */
export const DECK_VERSION = 1;

/* ------------------------------------------------------------------ */
/*  The shape                                                          */
/* ------------------------------------------------------------------ */

/**
 * The looks a deck can take: the brand's paper, ink and red, arranged
 * differently, never the feed's near-black (a dark card sinks into the dark
 * feed). A carousel opens and ends on its theme's bold side and builds on
 * its calm side (deckPalette).
 */
export const DECK_THEMES = ["paper", "red", "slate", "blush", "bone"] as const;
export type DeckTheme = (typeof DECK_THEMES)[number];

export type DeckSlideType = "cover" | "point" | "stat" | "compare" | "list" | "quote" | "diagram" | "takeaway";

export type DeckCover = { type: "cover"; kicker?: string | null; title: string; sub?: string | null };
export type DeckPoint = { type: "point"; n?: number | null; title: string; body?: string | null };
/** A number that carries the point, optionally as two bars against the number it's compared with (`bars`: exactly two, short labels). */
export type DeckStat = { type: "stat"; value: string; label: string; bars?: { label: string; value: string }[] | null; note?: string | null };
/** Two sides: the belief and what's true (`myth`, the left struck out), or two options side by side. */
export type DeckCompare = { type: "compare"; myth?: boolean; left: { label: string; text: string }; right: { label: string; text: string } };
export type DeckList = { type: "list"; title: string; items: string[]; style?: "check" | "number" | "cross" | null };
export type DeckQuote = { type: "quote"; text: string; by: string };
/** The lesson's own diagram (its visual), with a line over it. */
export type DeckDiagram = { type: "diagram"; title: string; note?: string | null };
export type DeckTakeaway = { type: "takeaway"; title: string; body?: string | null };

export type DeckSlide = DeckCover | DeckPoint | DeckStat | DeckCompare | DeckList | DeckQuote | DeckDiagram | DeckTakeaway;

export type PostDeck = {
  v: number;
  theme: DeckTheme;
  slides: DeckSlide[];
  /** The post's words under the slides: the coach's take, never the slides again. */
  caption: string;
  /** The take in a line (for the coach, and so the next deck isn't the same idea). */
  angle?: string | null;
  model?: string | null;
  made_at?: string | null;
};

/** How much each part may hold: a slide is read at about a third of its size on a phone. */
export const DECK_LIMITS = {
  minSlides: 3,
  maxSlides: 7,
  kicker: { words: 4, chars: 28 },
  coverTitle: { words: 10, chars: 64 },
  coverSub: { words: 16, chars: 100 },
  pointTitle: { words: 9, chars: 60 },
  pointBody: { words: 28, chars: 175 },
  statValue: { words: 3, chars: 10 },
  statLabel: { words: 14, chars: 90 },
  statNote: { words: 9, chars: 60 },
  barLabel: { words: 3, chars: 22 },
  compareLabel: { words: 3, chars: 22 },
  compareText: { words: 16, chars: 100 },
  listTitle: { words: 8, chars: 52 },
  listItem: { words: 9, chars: 56 },
  listItems: { min: 2, max: 4 },
  quoteText: { words: 26, chars: 165 },
  quoteBy: { words: 5, chars: 40 },
  diagramTitle: { words: 10, chars: 64 },
  diagramNote: { words: 16, chars: 100 },
  takeawayTitle: { words: 12, chars: 80 },
  takeawayBody: { words: 22, chars: 140 },
  /** Every slide's words together, the cover's aside: more than this is a lesson to read, not swipe. */
  totalWords: 130,
  caption: { min: 120, max: 650 },
} as const;

/* ------------------------------------------------------------------ */
/*  Reading one                                                        */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const opt = (v: unknown): string | null => str(v) || null;

function readSlide(raw: unknown): DeckSlide | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = str(r.type) as DeckSlideType;
  switch (type) {
    case "cover":
      return str(r.title) ? { type, kicker: opt(r.kicker), title: str(r.title), sub: opt(r.sub) } : null;
    case "point": {
      const n = typeof r.n === "number" && Number.isFinite(r.n) ? Math.round(r.n) : null;
      return str(r.title) ? { type, n, title: str(r.title), body: opt(r.body) } : null;
    }
    case "stat": {
      const bars = Array.isArray(r.bars)
        ? r.bars.map((b) => (b && typeof b === "object" ? { label: str((b as Record<string, unknown>).label), value: str((b as Record<string, unknown>).value) } : null)).filter((b): b is { label: string; value: string } => !!b?.label && !!b.value)
        : [];
      return str(r.value) && str(r.label) ? { type, value: str(r.value), label: str(r.label), bars: bars.length === 2 ? bars : null, note: opt(r.note) } : null;
    }
    case "compare": {
      const side = (s: unknown) => (s && typeof s === "object" ? { label: str((s as Record<string, unknown>).label), text: str((s as Record<string, unknown>).text) } : null);
      const left = side(r.left);
      const right = side(r.right);
      return left?.text && right?.text ? { type, myth: r.myth === true, left, right } : null;
    }
    case "list": {
      const items = Array.isArray(r.items) ? r.items.map(str).filter(Boolean) : [];
      const style = str(r.style);
      return str(r.title) && items.length ? { type, title: str(r.title), items, style: style === "check" || style === "number" || style === "cross" ? style : null } : null;
    }
    case "quote":
      return str(r.text) && str(r.by) ? { type, text: str(r.text), by: str(r.by) } : null;
    case "diagram":
      return str(r.title) ? { type, title: str(r.title), note: opt(r.note) } : null;
    case "takeaway":
      return str(r.title) ? { type, title: str(r.title), body: opt(r.body) } : null;
    default:
      return null;
  }
}

export function isDeckTheme(t: unknown): t is DeckTheme {
  return typeof t === "string" && (DECK_THEMES as readonly string[]).includes(t);
}

/**
 * A deck from stored or model JSON: its slides that read, the cover first.
 * Null when there's no cover or no caption. Words are kept as written (the
 * checks say what's too long; nothing is cut silently).
 */
export function parseDeck(raw: unknown, fallbackTheme: DeckTheme = "paper"): PostDeck | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slides = (Array.isArray(r.slides) ? r.slides : []).map(readSlide).filter((s): s is DeckSlide => !!s);
  if (!slides.length || slides[0].type !== "cover") return null;
  const caption = typeof r.caption === "string" ? r.caption.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (!caption) return null;
  return {
    v: typeof r.v === "number" ? r.v : DECK_VERSION,
    theme: isDeckTheme(r.theme) ? r.theme : fallbackTheme,
    slides,
    caption,
    angle: opt(r.angle),
    model: opt(r.model),
    made_at: opt(r.made_at),
  };
}

type DeckHolder = { deck?: unknown; series_extra?: unknown; series_data?: unknown };

/** The post's deck, wherever it rides (the post's own, its series data), or null. */
export function deckOf(post: DeckHolder | null | undefined): PostDeck | null {
  if (!post) return null;
  const from = (v: unknown) => (v && typeof v === "object" ? (v as { deck?: unknown }).deck : undefined);
  const raw = post.deck ?? from(post.series_extra) ?? from(post.series_data);
  return raw ? parseDeck(raw) : null;
}

/* ------------------------------------------------------------------ */
/*  Words                                                              */
/* ------------------------------------------------------------------ */

/** "*Lower* than you think" → the words without the marks. */
export const stripEmphasis = (t: string) => t.replace(/\*([^*]+)\*/g, "$1").replace(/\*/g, "");

/** A line split into plain and accented runs ("*" marks the accent). */
export function emphasisRuns(t: string): { text: string; accent: boolean }[] {
  const out: { text: string; accent: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let at = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m.index > at) out.push({ text: t.slice(at, m.index), accent: false });
    out.push({ text: m[1], accent: true });
    at = m.index + m[0].length;
  }
  if (at < t.length) out.push({ text: t.slice(at).replace(/\*/g, ""), accent: false });
  return out.filter((r) => r.text);
}


/** Every piece of text on a slide, in reading order. */
export function slideTexts(s: DeckSlide): string[] {
  switch (s.type) {
    case "cover":
      return [s.kicker ?? "", s.title, s.sub ?? ""].filter(Boolean).map(stripEmphasis);
    case "point":
      return [s.title, s.body ?? ""].filter(Boolean).map(stripEmphasis);
    case "stat":
      return [s.value, s.label, ...(s.bars ?? []).flatMap((b) => [b.label, b.value]), s.note ?? ""].filter(Boolean);
    case "compare":
      return [s.left.label, s.left.text, s.right.label, s.right.text];
    case "list":
      return [s.title, ...s.items];
    case "quote":
      return [s.text, s.by];
    case "diagram":
      return [s.title, s.note ?? ""].filter(Boolean).map(stripEmphasis);
    case "takeaway":
      return [s.title, s.body ?? ""].filter(Boolean).map(stripEmphasis);
  }
}

/** All the slides' words, one slide a line (what's on the picture, for screen readers and the checks). */
export function deckText(deck: Pick<PostDeck, "slides">): string {
  return deck.slides.map((s) => slideTexts(s).join(". ")).join("\n");
}

/** The cover's headline without marks: the post's picture in a line (alt text, the grid). */
export function deckHeadline(deck: Pick<PostDeck, "slides">): string {
  const c = deck.slides[0];
  return c?.type === "cover" ? stripEmphasis(c.title) : "";
}

/* ------------------------------------------------------------------ */
/*  The look                                                           */
/* ------------------------------------------------------------------ */

/** FNV-1a: the same seed always picks the same theme. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A deck's theme: never one of `recent` (the decks just before it, newest
 * first, three at most), else the seed's pick, so a run of posts never looks
 * the same twice in a row.
 */
export function pickDeckTheme(seed: string, recent: readonly (DeckTheme | null | undefined)[] = []): DeckTheme {
  const avoid = new Set(recent.slice(0, 3).filter(Boolean));
  const open = DECK_THEMES.filter((t) => !avoid.has(t));
  const pool = open.length ? open : [...DECK_THEMES];
  return pool[hash(seed) % pool.length];
}

/** Whether a deck is a carousel (several slides) or one slide. */
export const isCarousel = (deck: Pick<PostDeck, "slides"> | null | undefined) => (deck?.slides.length ?? 0) > 1;

/** A deck's slide as words (for the picture's alt text): what it says, in order. */
export function deckSlideAlt(deck: Pick<PostDeck, "slides">, index: number): string {
  const s: DeckSlide | undefined = deck.slides[index];
  if (!s) return "";
  switch (s.type) {
    case "cover":
      return [s.kicker, s.title, s.sub].filter(Boolean).map((t) => stripEmphasis(t!)).join(". ");
    case "point":
      return [s.title, s.body].filter(Boolean).join(". ");
    case "stat":
      return [s.value, s.label, ...(s.bars ?? []).map((b) => `${b.label}: ${b.value}`), s.note].filter(Boolean).join(". ");
    case "compare":
      return `${s.left.label}: ${s.left.text}. ${s.right.label}: ${s.right.text}`;
    case "list":
      return `${s.title}. ${s.items.join(". ")}`;
    case "quote":
      return `“${s.text}” ${s.by}`;
    case "diagram":
      return [s.title, s.note].filter(Boolean).join(". ");
    case "takeaway":
      return [stripEmphasis(s.title), s.body].filter(Boolean).join(". ");
  }
}
