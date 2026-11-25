/**
 * The checks every deck passes before it's published (Nov 20 2026): a hook
 * with tension (a claim, never a question or a template opener), slides that
 * fit a phone (each part's own limit, the whole deck's words), real variety
 * (no carousel of one kind of slide, a takeaway that lands somewhere the
 * hook didn't), a caption that's the coach's take and not the slides again
 * (`captionOverlap`), no engagement bait, no number or name that isn't in
 * the source (a deck never adds a fact), no research said bigger than it is,
 * and none of the phrases that read as AI, a script or a motivation page.
 * Pure: the writer (post-decks.server.ts) runs them on every draft, and the
 * editor's notes ride on top.
 */
import { designProblems } from "@/lib/post-design";
import { AI_TELLS, GENERIC_PHRASES, SCRIPTED_PHRASES } from "@/lib/daily-visuals";
import { voiceProblems } from "@/lib/plain-words";
import { DECK_LIMITS, deckText, slideTexts, stripEmphasis, type DeckSlide, type PostDeck } from "@/lib/post-decks";

const wordCount = (t: string | null | undefined) => (t ? stripEmphasis(t).split(/\s+/).filter(Boolean).length : 0);

/** Hooks that read as a template or clickbait, never his. */
const BORING_HOOK = /^(did you know|ever (?:wonder|wondered|notice)|are you|do you|have you|want to|here'?s|let'?s talk|the secret|this one|you won'?t believe|why you should|stop doing this|everything you need|the ultimate|a quick|quick tip|tip:|reminder)\b/i;

/** Endings that ask for engagement instead of earning it. */
const GENERIC_ASK = [
  "what's yours",
  "what about you",
  "thoughts?",
  "let me know",
  "drop a",
  "comment below",
  "tag a",
  "tag someone",
  "who else",
  "agree?",
  "save this",
  "share this",
  "follow for more",
  "double tap",
  "can you relate",
  "sound familiar",
  "which one are you",
  "are you guilty",
] as const;

/** Openers that are a formula, not a person talking ("I care about this because…" on every post). */
const CAPTION_PREAMBLE = /^(i care\b|i really care|this matters\b|here'?s why|the reason (?:i|this)|let me\b|real quick|quick one|so here'?s|i want to talk|i wanted to)/i;

/** Office words a coach doesn't use about training. */
const CORPORATE = ["bandwidth", "actionable", "low-hanging fruit", "move the needle", "level set", "unpack", "synergy", "holistic", "leverage your", "circle back", "value add", "best practices", "key learnings"] as const;

/** The first two words of a caption, lowercased: how it opens. */
export const captionOpening = (t: string) => t.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' ]+/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");

/** Research said bigger than it is. */
const OVERSTATED = /\b(proves?|proven|science says|science proves|guarantee[sd]?|never fails|always works|miracle|the best way to|the only way to|research proves|studies prove)\b/i;

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100",
  half: "50", once: "1", twice: "2", single: "1", double: "2",
};

/** The numbers a text says: digits (commas dropped), and number words as digits. */
export function numbersIn(text: string): string[] {
  const t = text.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  const out = new Set<string>();
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  for (const w of t.match(/[a-z]+/g) ?? []) if (NUMBER_WORDS[w]) out.add(NUMBER_WORDS[w]);
  return [...out];
}

/** Small counts anyone can say (reps left, sets, a few weeks): only other numbers must come from the source. */
const FREE_NUMBER = (n: string) => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 12;

/** Names of people the deck gives (two or more capitalized words together, mid-sentence). */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?:\n])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 1; i < words.length - 1; i++) {
      const a = words[i].replace(/[^\p{L}.'-]/gu, "");
      const b = words[i + 1].replace(/[^\p{L}.'-]/gu, "");
      if (/^\p{Lu}\p{Ll}+$/u.test(a) && /^\p{Lu}\p{Ll}+$/u.test(b)) out.add(`${a} ${b}`);
    }
  }
  return [...out];
}

const norm = (t: string) =>
  stripEmphasis(t)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9%' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every run of `n` words in a text. */
function shingles(text: string, n: number): Set<string> {
  const w = norm(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * How much of the caption the slides already say: the share of its 4-word
 * runs that are on a slide, and its sentences mostly on one (6+ words, 70% of
 * their 3-word runs on the slides).
 */
export function captionOverlap(caption: string, deck: Pick<PostDeck, "slides">): { share: number; sentences: string[] } {
  const slides = deckText(deck);
  const cap4 = shingles(caption, 4);
  const sl4 = shingles(slides, 4);
  let hit = 0;
  for (const s of cap4) if (sl4.has(s)) hit++;
  const share = cap4.size ? hit / cap4.size : 0;
  const sl3 = shingles(slides, 3);
  const sentences: string[] = [];
  for (const sentence of caption.split(/(?<=[.!?])\s+|\n+/)) {
    if (norm(sentence).split(" ").length < 6) continue;
    const s3 = shingles(sentence, 3);
    let h = 0;
    for (const s of s3) if (sl3.has(s)) h++;
    if (s3.size && h / s3.size >= 0.7) sentences.push(sentence.trim());
  }
  return { share, sentences };
}

const contentWords = (t: string) => new Set(norm(t).split(" ").filter((w) => w.length > 3));
/** How alike two lines are, by the words that carry meaning (0 to 1). */
export function likeness(a: string, b: string): number {
  const A = contentWords(a);
  const B = contentWords(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

function over(label: string, text: string | null | undefined, lim: { words: number; chars: number }): string[] {
  if (!text) return [];
  const plain = stripEmphasis(text);
  const w = wordCount(text);
  return w > lim.words || plain.length > lim.chars ? [`${label} is too long for a phone (${w} words, keep it to ${lim.words})`] : [];
}

/** What a slide holds that doesn't fit, by its own limits. */
function slideFit(s: DeckSlide, i: number): string[] {
  const at = `slide ${i + 1}`;
  const L = DECK_LIMITS;
  switch (s.type) {
    case "cover":
      return [...over(`${at}'s kicker`, s.kicker, L.kicker), ...over(`${at}'s hook`, s.title, L.coverTitle), ...over(`${at}'s line under the hook`, s.sub, L.coverSub)];
    case "point":
      return [...over(`${at}'s title`, s.title, L.pointTitle), ...over(`${at}'s words`, s.body, L.pointBody)];
    case "stat":
      return [
        ...over(`${at}'s number`, s.value, L.statValue),
        ...over(`${at}'s label`, s.label, L.statLabel),
        ...over(`${at}'s note`, s.note, L.statNote),
        ...(s.bars ?? []).flatMap((b, j) => [...over(`${at}'s bar ${j + 1} number`, b.value, L.statValue), ...over(`${at}'s bar ${j + 1} label`, b.label, L.barLabel)]),
      ];
    case "compare":
      return [
        ...over(`${at}'s left label`, s.left.label, L.compareLabel),
        ...over(`${at}'s right label`, s.right.label, L.compareLabel),
        ...over(`${at}'s left side`, s.left.text, L.compareText),
        ...over(`${at}'s right side`, s.right.text, L.compareText),
      ];
    case "list":
      return [
        ...over(`${at}'s title`, s.title, L.listTitle),
        ...(s.items.length < L.listItems.min || s.items.length > L.listItems.max ? [`${at} has ${s.items.length} items (2 to 4 read on a phone)`] : []),
        ...s.items.flatMap((it, j) => over(`${at}'s item ${j + 1}`, it, L.listItem)),
      ];
    case "quote":
      return [...over(`${at}'s quote`, s.text, L.quoteText), ...over(`${at}'s name`, s.by, L.quoteBy)];
    case "diagram":
      return [...over(`${at}'s title`, s.title, L.diagramTitle), ...over(`${at}'s note`, s.note, L.diagramNote)];
    case "takeaway":
      return [...over(`${at}'s takeaway`, s.title, L.takeawayTitle), ...over(`${at}'s line under it`, s.body, L.takeawayBody)];
  }
}

export type DeckContext = {
  /** Everything the deck was written from: its facts, numbers and names must be in here. */
  source: string;
  /** The captions of the decks around it: a caption never opens the way one of them did. */
  recentCaptions?: readonly string[];
  /** The lesson has a diagram the deck can show (a `diagram` slide). */
  diagram?: boolean;
  /** The covers of the posts around it: a hook too close to one is the same post again. */
  recentCovers?: readonly string[];
};

const lowerHas = (text: string, list: readonly string[]) => {
  const t = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  return list.filter((p) => t.includes(p));
};

/**
 * Everything wrong with a deck, in words the writer can act on (empty when
 * it's ready to publish). See the header for what's checked.
 */
export function deckProblems(deck: PostDeck, ctx: DeckContext): string[] {
  const out: string[] = [];
  const { slides, caption } = deck;
  const cover = slides[0];
  const n = slides.length;

  // shape: one sharp slide, or a carousel that opens on a hook and lands on a takeaway
  if (!cover || cover.type !== "cover") out.push("the first slide must be the cover (the hook)");
  if (n === 2) out.push("2 slides is neither a single post nor a carousel: make it 1, or 3 to 7");
  if (n > DECK_LIMITS.maxSlides) out.push(`${n} slides is too many (7 at most; cut what doesn't earn a swipe)`);
  if (n >= DECK_LIMITS.minSlides && slides[n - 1].type !== "takeaway") out.push("a carousel ends on a takeaway slide");
  slides.forEach((s, i) => {
    if (i > 0 && s.type === "cover") out.push(`slide ${i + 1} is a second cover`);
    if (s.type === "takeaway" && i !== n - 1) out.push(`slide ${i + 1} is a takeaway before the end`);
    if (n === 1 && s.type === "cover" && !s.sub) out.push("a single slide needs its line under the hook");
  });

  // the hook
  if (cover?.type === "cover") {
    const hook = stripEmphasis(cover.title);
    if (/\?\s*$/.test(hook)) out.push("the hook is a question: make it a claim with tension");
    if (BORING_HOOK.test(hook)) out.push(`the hook opens like a template ("${hook.split(/\s+/).slice(0, 3).join(" ")}…")`);
    if (hook === hook.toUpperCase() && /[A-Z]{4}/.test(hook)) out.push("the hook is in capitals");
    if (wordCount(hook) < 3) out.push("the hook is too short to say anything");
    for (const c of ctx.recentCovers ?? []) if (likeness(hook, c) >= 0.7) out.push(`the hook is too close to a recent post ("${c}")`);
  }

  // the design: the cover's headline has to read in the three-across profile grid (post-design.ts)
  out.push(...designProblems(slides));

  // fit and density
  slides.forEach((s, i) => out.push(...slideFit(s, i)));
  const words = slides.slice(1).reduce((t, s) => t + slideTexts(s).reduce((a, x) => a + wordCount(x), 0), 0);
  if (words > DECK_LIMITS.totalWords) out.push(`the slides hold ${words} words (keep it under ${DECK_LIMITS.totalWords}: a carousel is swiped, not read)`);
  for (const s of slides) {
    const marks = (JSON.stringify(s).match(/\*/g) ?? []).length;
    if (marks > 2) out.push("only one accent (*word*) a slide");
    if (marks && s.type !== "cover" && s.type !== "takeaway") out.push("accents (*word*) only on the cover or the takeaway");
  }

  // variety: a carousel that's the same slide over and over reads as a template
  if (n >= 4) {
    const kinds = new Set(slides.map((s) => s.type));
    if (kinds.size < 3) out.push("the slides are all one kind: mix points with a number, a comparison, a list or a quote where they fit");
    for (let i = 0; i + 3 < n; i++) if (slides[i].type === slides[i + 1].type && slides[i].type === slides[i + 2].type && slides[i].type === slides[i + 3].type) out.push("four slides of one kind in a row");
  }
  const last = slides[n - 1];
  if (n > 1 && last.type === "takeaway" && cover?.type === "cover" && likeness(last.title, cover.title) >= 0.75) out.push("the takeaway only repeats the hook: land somewhere the cover didn't");

  // a number has to say what it is
  for (const [i, sl] of slides.entries()) if (sl.type === "stat" && wordCount(sl.label) < 3) out.push(`slide ${i + 1}'s number needs a label that says what it means ("${sl.label}" doesn't)`);

  // the diagram
  const diagrams = slides.filter((s) => s.type === "diagram").length;
  if (diagrams && !ctx.diagram) out.push("there's no diagram for this post: drop the diagram slide");
  if (diagrams > 1) out.push("one diagram slide at most");
  if (ctx.diagram && n >= DECK_LIMITS.minSlides && !diagrams) out.push("the lesson has a diagram: give it a slide");

  // the caption: his take, not the slides again
  const capLen = caption.length;
  if (capLen < DECK_LIMITS.caption.min) out.push(`the caption is too thin (${capLen} characters): add the take the slides don't`);
  if (capLen > DECK_LIMITS.caption.max) out.push(`the caption is too long (${capLen} characters, ${DECK_LIMITS.caption.max} at most)`);
  const { share, sentences } = captionOverlap(caption, deck);
  if (share > 0.2) out.push(`the caption repeats the slides (${Math.round(share * 100)}% of it is on them)`);
  for (const s of sentences.slice(0, 2)) out.push(`the caption says what a slide says: "${s.slice(0, 80)}"`);
  if (cover?.type === "cover" && likeness(caption.split(/(?<=[.!?])\s+|\n+/)[0] ?? "", cover.title) >= 0.8) out.push("the caption opens with the hook again");
  if (CAPTION_PREAMBLE.test(caption.trim())) out.push(`the caption opens with a formula ("${caption.trim().split(/\s+/).slice(0, 5).join(" ")}…"): open with the thought itself`);
  const opening = captionOpening(caption);
  if (opening && (ctx.recentCaptions ?? []).some((c) => captionOpening(c) === opening)) out.push(`the caption opens the way a recent one did ("${opening}…")`);
  for (const w of lowerHas(caption, CORPORATE)) out.push(`says "${w}" (office talk, not a coach)`);
  const ask = lowerHas(caption, GENERIC_ASK);
  if (ask.length) out.push(`the caption asks for engagement ("${ask[0]}"): end on something worth answering or nothing`);
  if (/#\w/.test(caption)) out.push("no hashtags");
  // the shape it reads in on a phone: a few short paragraphs, never a poem of one-line sentences
  const paras = caption.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 4) out.push(`the caption is ${paras.length} paragraphs: two or three short ones read better`);
  else if (paras.length === 4 && paras.every((p) => !/[.!?…]\S*\s+\S/.test(p))) out.push("the caption is one sentence a line all the way down: join the ones that belong together");

  // voice: his, not a writer's or a motivation page's
  const all = `${deckText(deck)}\n${caption}`;
  for (const p of lowerHas(all, GENERIC_PHRASES)) out.push(`says "${p}" (a slogan)`);
  for (const p of lowerHas(all, AI_TELLS)) out.push(`says "${p}" (reads like AI)`);
  for (const p of lowerHas(all, SCRIPTED_PHRASES)) out.push(`says "${p}" (scripted)`);
  out.push(...voiceProblems(all));
  if (OVERSTATED.test(all)) out.push(`overstates the research ("${OVERSTATED.exec(all)?.[0]}"): say what was found and its limits`);
  if (/!{2,}|🔥.*🔥/.test(all)) out.push("hype (!!, 🔥🔥)");

  // facts: every number and name from the source
  const known = new Set(numbersIn(ctx.source));
  const unknown = numbersIn(all).filter((x) => !known.has(x) && !FREE_NUMBER(x));
  if (unknown.length) out.push(`numbers that aren't in the source: ${unknown.slice(0, 4).join(", ")} (never add a fact)`);
  const src = ctx.source.toLowerCase();
  const names = namesIn(all).filter((x) => !src.includes(x.toLowerCase()));
  if (names.length) out.push(`names that aren't in the source: ${names.slice(0, 3).join(", ")}`);

  return [...new Set(out)];
}
