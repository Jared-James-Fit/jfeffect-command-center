/**
 * Tightening an automated post's cover headline for the grid (Nov 25 2026):
 * the design system paints a deck's cover in capitals at a size the
 * three-across profile grid reads (post-design.ts), and a cover written for
 * the old look (up to 10 words, a serif at any size) can be too long for
 * it. A headline that won't read is rewritten shorter by the writer model,
 * keeping what it means, and only kept when code agrees nothing was added
 * (no new numbers, no new names, the words drawn from the deck itself) and
 * it fits. Pure: what needs it, the prompt, the checks. The job is
 * post-headlines.server.ts; the database writes it in place
 * (community_post_headline_apply), every old title kept.
 */
import { hookFit, type PaintReport } from "@/lib/post-design";
import { deckText, stripEmphasis, type PostDeck } from "@/lib/post-decks";

export const HEADLINE_VERSION = 1;

/** The most a grid headline holds, and the smallest it may paint (px on the 1080 card). */
export const HEADLINE_MAX_WORDS = 7;
export const HEADLINE_MIN_PX = 150;

const words = (t: string) => stripEmphasis(t).split(/\s+/).filter(Boolean);

/** Whether a cover needs a shorter headline: it only fits small (4+ lines) or not at all. */
export function needsHeadlinePolish(title: string): boolean {
  const fit = hookFit(title);
  return !fit || fit.px < HEADLINE_MIN_PX || words(title).length > 9;
}

/** Simple stem: lowercase, letters and digits, plurals and -ing / -ed off, so "lifts" matches "lifting". */
export function stem(w: string): string {
  let s = w.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%'+/.]/g, "").replace(/'s$/, "");
  s = s.replace(/[.]+$/, "");
  if (s.length > 5) s = s.replace(/(ing|ed|es)$/, "");
  if (s.length > 3) s = s.replace(/s$/, "");
  return s;
}

const SMALL = new Set(
  "a an the and or but if of to in on at by for with from into over under than then that this these those it its is are was were be been being you your you're yours i i'm my me we our us they them their he she his her not no do does don't doesn't did can can't will won't just more most less least much many very so as up out off about what why how when who which all any every each one".split(" "),
);

function numbers(t: string): string[] {
  return (stripEmphasis(t).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

/**
 * What's wrong with a rewritten headline, in words; empty when it can go on.
 * `source`: everything the deck already says (its cover, slides and caption).
 */
export function headlineProblems(next: string, old: string, source: string): string[] {
  const out: string[] = [];
  const plain = stripEmphasis(next).trim();
  if (!plain) return ["empty"];
  const w = words(plain);
  if (w.length > HEADLINE_MAX_WORDS) out.push(`${w.length} words (${HEADLINE_MAX_WORDS} at most)`);
  if (w.length < 3) out.push("too short to say anything");
  if (/\?\s*$/.test(plain)) out.push("a question: make it a claim");
  if (/[—–]/.test(plain)) out.push("a dash");
  if (plain === plain.toUpperCase() && /[A-Z]{4}/.test(plain)) out.push("written in capitals (the card capitalises it)");
  const fit = hookFit(plain);
  if (!fit || fit.px < HEADLINE_MIN_PX) out.push("still too long to read in the grid");
  // nothing new: every number is the deck's, every word that carries meaning is one the deck uses
  const have = new Set(numbers(source));
  for (const n of numbers(plain)) if (!have.has(n)) out.push(`a number the post doesn't have (${n})`);
  const known = new Set(source.split(/\s+/).map(stem).filter(Boolean));
  const fresh = w.map(stem).filter((s) => s && !SMALL.has(s) && !known.has(s));
  if (fresh.length > 1) out.push(`words the post doesn't use (${fresh.join(", ")})`);
  if (stripEmphasis(old).trim().toLowerCase() === plain.toLowerCase()) out.push("the same as before");
  // the accent: at most one marked phrase of one to three words
  const marks = next.match(/\*[^*]+\*/g) ?? [];
  if (marks.length > 1 || marks.some((m) => words(m).length > 3)) out.push("mark one phrase of one to three words with *asterisks*");
  return [...new Set(out)];
}

/** Everything the deck says, for the checks and the writer. */
export function deckSource(deck: Pick<PostDeck, "slides" | "caption">): string {
  return `${deckText(deck)}\n${deck.caption}`;
}

export const HEADLINE_SYSTEM = `You tighten the cover headline of a strength coach's Instagram-style carousel so it reads at a glance on a phone's profile grid. The cover is painted in big condensed capitals, so it has to be short.

Rules:
- Keep exactly what it means and what it claims. Never add a fact, number, name, study or promise the post doesn't already have.
- ${HEADLINE_MAX_WORDS} words at most (4 to 6 is best). A claim with tension, never a question, never a template opener ("did you know", "here's", "5 tips", "the secret").
- Use the post's own words where you can. Natural, the way a coach would say it out loud; no slogans, no hype, no dashes.
- Sentence case (the card capitalises it). Put *asterisks* around the one to three words that carry it.

Answer with JSON only: {"title": "..."}`;

export function headlinePrompt(deck: Pick<PostDeck, "slides" | "caption">, notes: string[] = []): string {
  const cover = deck.slides[0];
  const title = cover?.type === "cover" ? cover.title : "";
  return [
    `THE HEADLINE NOW (too long for the grid): ${title}`,
    cover?.type === "cover" && cover.kicker ? `ITS KICKER: ${cover.kicker}` : null,
    `WHAT THE POST SAYS (slides, then the caption):\n${deckSource(deck)}`,
    notes.length ? `YOUR LAST TRY WAS TURNED DOWN: ${notes.join("; ")}. Fix exactly that.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The model's answer → a title, or null. */
export function readHeadline(text: string): string | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { title?: unknown };
    return typeof j.title === "string" ? j.title.replace(/\s+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

/** A card's report as one line for the admin preview. */
export function reportLine(r: PaintReport | null, problems: string[]): string {
  if (!r) return "not painted";
  return problems.length ? problems.join(" · ") : `passes${r.scale < 1 ? ` (fitted at ${Math.round(r.scale * 100)}%)` : ""}`;
}
