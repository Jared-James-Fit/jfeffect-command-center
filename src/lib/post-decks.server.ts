/**
 * Decks, written (Nov 20 2026): a lesson, a Tuesday tip or an older series
 * post turned into slides and a caption of its own (post-decks.ts), in the
 * background, on the OpenAI key (route `post_write`, never Lovable credits).
 *
 * Every draft goes through the code's checks (post-deck-checks.ts) and then
 * an editor's read (a strength coach and a social editor in one: hook, value,
 * accuracy against the source, his voice, a caption that adds something,
 * flow); a draft that fails either goes back with what to fix, three tries at
 * most, and only a deck that passes both is ever saved. A deck goes on the
 * library item (so the post it becomes publishes with it, its caption the
 * deck's) and, for a post already out, on the post in place: same id, date,
 * likes, comments and views, only its caption and slides, and only while its
 * caption is still the library's (never a post the coach edited). What it
 * replaced is kept on the job row (`before`) to put back.
 *
 * The jobs are `community_post_decks` (server only), run one per call by the
 * `post-decks-tick` hook (woken by the database when there's work, and by
 * pg_cron).
 */
import { callModelNow } from "@/lib/ai/model-client.server";
import { readRouteOverride } from "@/lib/ai/route-call.server";
import { resolveRoute } from "@/lib/ai/routing";
import { LESSON_TRACK, extraLesson, isLessonVisual, type LessonExtra } from "@/lib/lessons";
import { TIP_KIND_LABEL } from "@/lib/community";
import { DECK_LIMITS, DECK_VERSION, deckHeadline, isDeckTheme, parseDeck, pickDeckTheme, type DeckTheme, type PostDeck } from "@/lib/post-decks";
import { deckProblems } from "@/lib/post-deck-checks";

type Admin = any;

/** How many drafts a deck gets before the job gives up (and the post keeps what it had). */
export const DECK_TRIES = 4;
/** A job left `running` this long was cut off (a deploy, a timeout): it can be claimed again. */
const STALE_MS = 12 * 60_000;

/* ------------------------------------------------------------------ */
/*  The prompts                                                        */
/* ------------------------------------------------------------------ */

const L = DECK_LIMITS;

export const DECK_PROMPT = `You turn one of Jared McIntyre's coaching posts into a post people stop for in the JF Effect Crew feed: slides people swipe through and a caption under them. Jared is a competitive powerlifter (Team Canada) and a powerlifting and strength coach. The crew is men and women who lift, from newer lifters to competitive powerlifters. Crew is a social feed, not a course: every post sits beside members' own lifts and photos, so it has to earn the stop, the swipe, the save and the comment.

FIND THE TAKE
- One idea with tension. Find the most interesting, defensible take in the source: a belief most lifters hold that's wrong or incomplete, a counterintuitive finding, a specific mistake he sees, a trade-off people ignore, a test that tells a lifter which camp they're in.
- Lead with conviction. Now and then a take other coaches would argue with is good, as long as the source backs it. Never contrarian for its own sake, never a strawman, never a promise the source can't keep.
- Expert, not academic: say it the way a coach who competes would explain it to a lifter between sets.

THE SLIDES
- Cover (slide 1): the hook. A claim, never a question. Concrete, at most ${L.coverTitle.words} words, sentence case. It makes a lifter think "wait, what?" or "that's me". Put *asterisks* around the one to three words that carry it (they're painted in the accent colour). Never a template opener ("did you know", "here's", "5 tips", "the secret", "stop doing this"). Examples of the shape only, never to copy: "You need *less* protein than the internet says", "Your sticking point starts *lower* than you think".
- A kicker over the hook, at most ${L.kicker.words} words, saying what it is the way he would: "Bench fix", "Hypertrophy", "Meet prep", "Recovery", "Uncomfortable truth", "Programming".
- The slides after it each do one job and earn the next swipe: the mechanism, the evidence with its limits, how to tell which case you're in, what to do. One idea a slide, few words, big. A slide is read in about two seconds.
- Pick the kind of slide that fits what it says, and mix them (a carousel of one kind reads as a template):
  point: an idea or a step (title, short body); give "n" only to two or more points that are steps in order, else leave it out
  stat: a number that carries the point, painted huge, with a label that says what it means in 4 to 14 words ("is where muscle gains stopped climbing", never just "per day"); "bars" (exactly two, short labels) when two numbers are being compared; a "note" saying where it's from ("A 2018 review of 49 studies")
  compare: the belief and the truth ("myth": true, the belief struck out), or two options side by side; labels in sentence case that name each side ("The belief" / "What's true", "Most lifters" / "What works", "Grinding" / "Stopping short"), never "bad" / "good" or "old" / "new"
  list: 2 to 4 short items (checks, steps or don'ts)
  quote: only a quote that's in the source, word for word, with who said it
  diagram: only when the source has a diagram (a line over the lesson's drawing, and a short note under it)
  takeaway: the last slide of a carousel
- The takeaway lands somewhere the cover didn't: the rule to follow, the test to run, the line to remember. Short. Not a summary, not a slogan, never "the takeaway is".
- A carousel is 4 to 6 slides (3 at least, 7 at most): the cover, 2 to 4 that build, the takeaway. One slide (the cover with "sub", a line under the hook) when it's one sharp idea that doesn't need building: never stretch a one-line tip into a carousel.

LIMITS (words): kicker ${L.kicker.words}; cover title ${L.coverTitle.words}, sub ${L.coverSub.words}; point title ${L.pointTitle.words}, body ${L.pointBody.words}; stat value ${L.statValue.chars} characters, label ${L.statLabel.words}, note ${L.statNote.words}, bar label ${L.barLabel.words}; compare label ${L.compareLabel.words}, side ${L.compareText.words}; list title ${L.listTitle.words}, ${L.listItems.min} to ${L.listItems.max} items of ${L.listItem.words}; quote ${L.quoteText.words}; diagram title ${L.diagramTitle.words}, note ${L.diagramNote.words}; takeaway ${L.takeawayTitle.words}, its line ${L.takeawayBody.words}. All the slides after the cover together: under ${L.totalWords} words.

THE CAPTION
- Jared talking about it, under the post, in his voice. Whoever reads it has just seen the slides, so it never repeats them: no sentence from a slide, not the hook again, not a summary of the slides.
- Give what the slides don't, one angle, picked for this post (vary it post to post): the mistake he sees lifters make with this, who should ignore it, when it matters and when it doesn't, how it plays out in a meet prep or a cut, or exactly what he'd change in this week's training.
- Open with the thought itself, the way he'd start typing: never a preamble ("I care about this because", "this matters because", "here's why", "let me", "quick one"), and never the way a recent caption opened (they're listed).
- 2 to 5 short sentences, ${L.caption.min} to ${Math.min(L.caption.max, 550)} characters.
- Never ask for engagement ("what's yours?", "thoughts?", "let me know", "drop a…", "save this", "tag a friend", "who else"). End on the useful thought. A specific question is fine only when a real answer would teach the crew something.

ACCURACY (never bend this)
- Every fact, number, study, name and quote comes from the source. Never add one, never change one (don't round differently, don't turn "a 2018 review" into "studies show", don't name a study's authors: say its year and what it was).
- Say research the way it was found: a small study is small, untrained people are untrained people, an association is an association, a review "found", never "proves". Keep the source's caveats where they change what a lifter should do.
- Advice stays inside what the source supports and a good coach would defend. Where it depends on the lifter, say so. Bodies are about performance, never how someone looks.

HIS VOICE
- Direct, confident, conversational, sometimes dry. Athlete to athlete. Never a fitness motivation page, a textbook or a copywriter.
- Slides: clean, plain, sentence case, no filler. Caption: casual, like he typed it on his phone (contractions, a lowercase start sometimes, a fragment is fine, apostrophes kept), never misspelled on purpose.
- Plain words; lifter terms are fine (RPE, top set, back-off sets, bar speed, lockout, hypertrophy), anything past that explained in a few words.
- No dashes or semicolons, no hashtags, no exclamation hype, no emoji on slides, at most one in the caption (usually none).
- Never office talk ("bandwidth", "actionable", "move the needle", "unpack", "holistic", "best practices").
- Never: "here's the thing", "the truth is", "let that sink in", "at the end of the day", "game changer", "dive into", "journey", "unlock", "key takeaway", "the bottom line", "trust the process", "you got this", "listen to your body", "give yourself grace", "consistency is key", "level up", "no excuses", "unpopular opinion", "hot take", "nobody talks about", "signs you're", "it's not about".
- No stories, clients or results that aren't in the source. His opinion as his ("my take", "i think") when it's his.

Answer with JSON only:
{"angle": "the take in one line", "slides": [
  {"type": "cover", "kicker": "...", "title": "...", "sub": "... (single slide only, else omit)"},
  {"type": "point", "n": 1, "title": "...", "body": "..."},
  {"type": "stat", "value": "...", "label": "...", "bars": [{"label": "...", "value": "..."}, {"label": "...", "value": "..."}], "note": "..."},
  {"type": "compare", "myth": true, "left": {"label": "...", "text": "..."}, "right": {"label": "...", "text": "..."}},
  {"type": "list", "title": "...", "style": "check | number | cross", "items": ["...", "..."]},
  {"type": "quote", "text": "...", "by": "..."},
  {"type": "diagram", "title": "...", "note": "..."},
  {"type": "takeaway", "title": "...", "body": "... (optional)"}
], "caption": "..."}
(The list shows every kind of slide once; use the ones the post needs, in the order it needs them.)`;

export const EDITOR_PROMPT = `You're the last read before a post goes out in the JF Effect Crew feed under Jared McIntyre's name: a competitive powerlifter and strength coach, and the editor of a fitness account people actually save and share. You're given the source he wrote and the post made from it (slides and a caption).

Score each from 1 to 5 and be hard to please (4 means you'd publish it as is):
- hook: the cover stops a lifter scrolling: a specific claim with tension, not a generic or predictable line
- value: a lifter learns something they can use or think differently about, and every slide earns its swipe (no filler slide)
- accuracy: every fact, number, name and study matches the source, nothing is added, research isn't overstated, the advice is something a good coach would defend (any invented or bent fact is a 1)
- voice: sounds like a confident coach who competes, not a textbook, a copywriter, a motivation page or AI
- caption: adds something the slides don't (his take, when it applies, who it doesn't) and doesn't repeat them or beg for engagement
- flow: the slides build in order, each one idea, a phone-sized amount of words, and the takeaway lands somewhere the cover didn't

Then "verdict": "publish" only if every score is 4 or 5 and accuracy is 5, else "revise", with "notes": the specific fixes (quote the words to change, say what to change them to or what to cut). Never ask for a fact the source doesn't have. Anything you suggest stays inside the slides' limits (in words): cover ${L.coverTitle.words}, kicker ${L.kicker.words}, point title ${L.pointTitle.words} and body ${L.pointBody.words}, stat label ${L.statLabel.words} and note ${L.statNote.words}, compare side ${L.compareText.words}, list items ${L.listItem.words}, takeaway ${L.takeawayTitle.words} and its line ${L.takeawayBody.words}; no dashes.

Answer with JSON only: {"scores": {"hook": n, "value": n, "accuracy": n, "voice": n, "caption": n, "flow": n}, "verdict": "publish" | "revise", "notes": ["..."]}`;

/* ------------------------------------------------------------------ */
/*  The source                                                         */
/* ------------------------------------------------------------------ */

export type DeckSource = {
  /** Where it'll be posted (the series). */
  series: string;
  /** What it's from, for the writer: the lesson's title, track, level and lift, or the tip's kind. */
  about: string;
  /** The words it's made from (the lesson or tip as written). */
  body: string;
  /** The lesson's sources, as the coach listed them (for the facts check only: authors are never named). */
  refs: string[];
  /** The lesson has a drawing a diagram slide can show: what it shows. */
  diagram: string | null;
  /** The truth / reset card's own words (a belief and the truth, the week's few things). */
  card: string | null;
};

const VISUAL_WORDS: Record<string, string> = {
  bar_path: "the bar's path from the side, over midfoot or drifting",
  squat_torso: "the squat's torso angle against how the lifter is built",
  squat_balance: "balance over the feet in the squat",
  squat_rise: "how the hips and chest rise out of the hole",
  squat_depth: "squat depth, hip crease against the top of the knee",
  deadlift_start: "the deadlift start position: hips, shoulders and the bar",
  bench_touch: "where the bar touches on the bench",
  sticking_point: "bar speed through the press: the fastest point down to the slowest",
  strength_curve: "a strength curve: how hard a lift is through its range",
  length_tension: "how much force a muscle makes at different lengths",
  force_velocity: "the force-velocity curve: heavier means slower",
  fitness_fatigue: "fitness and fatigue: fatigue clears faster than fitness fades",
  sra: "stimulus, recovery, adaptation over the days after a session",
  rpe_rir: "RPE against reps left in the tank",
  dose_response: "more weekly sets, more growth, with less gained from each extra set",
  velocity_loss: "bar speed falling rep by rep through a set",
  set_structure: "how a set is built (rest-pause, clusters)",
};

/** A library item (or the item a post came from) as what the writer works from. */
export function deckSource(series: string, body: string, data: unknown): DeckSource {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (series === "lesson") {
    const lesson = extraLesson({ series: "lesson", series_extra: d as never }) as LessonExtra | null;
    const v = lesson?.visual ?? null;
    const about = lesson
      ? [`Lesson: "${lesson.title}"`, LESSON_TRACK[lesson.track]?.name, lesson.lift ? `lift: ${lesson.lift}` : null, lesson.level ? `level: ${lesson.level}` : null].filter(Boolean).join(" · ")
      : "Lesson";
    const card =
      v?.kind === "truth" && v.belief && v.truth ? `The belief: ${v.belief}\nThe truth: ${v.truth}` : v?.kind === "reset" && v.items?.length ? `This week: ${v.items.join("; ")}` : null;
    const diagram = v && isLessonVisual(v) && v.kind !== "truth" && v.kind !== "reset" ? `${VISUAL_WORDS[v.kind] ?? v.kind}${v.fault ? ` (shows: ${v.fault.replace(/_/g, " ")})` : ""}${v.lift ? `, ${v.lift}` : ""}` : null;
    return { series, about, body, refs: (lesson?.refs ?? []).map((r) => r.label), diagram, card };
  }
  const kind = typeof d.kind === "string" ? TIP_KIND_LABEL[d.kind] ?? d.kind : null;
  const label: Record<string, string> = {
    tuesday_tips: "Tuesday tip",
    monday_motivation: "Monday post (training mindset)",
    finish_strong_friday: "Friday post (end of the training week)",
  };
  return { series, about: [label[series] ?? series, kind ? `kind: ${kind}` : null].filter(Boolean).join(" · "), body, refs: [], diagram: null, card: null };
}

/** Everything a deck's facts may come from (the checks read numbers and names against it). */
export function sourceText(s: DeckSource): string {
  return [s.about, s.body, s.card ?? "", s.diagram ? `Its diagram shows: ${s.diagram}` : "", ...s.refs].join("\n");
}

export function writerPrompt(s: DeckSource, o: { recentCovers: string[]; recentCaptions?: string[]; notes: string[]; previous?: string | null }): string {
  return [
    `WHAT IT IS: ${s.about}`,
    `THE SOURCE (Jared's own post: every fact comes from here):\n"""\n${s.body}\n"""`,
    s.card ? `ITS CARD SAID:\n${s.card}` : null,
    s.refs.length ? `ITS SOURCES (for checking only; never name authors):\n${s.refs.map((r) => `- ${r}`).join("\n")}` : null,
    s.diagram ? `IT HAS A DIAGRAM: ${s.diagram}. Give it one "diagram" slide where it helps the point most.` : "IT HAS NO DIAGRAM: no diagram slide.",
    o.recentCovers.length ? `RECENT COVERS IN THE FEED (don't open the same way or make the same point):\n${o.recentCovers.map((c) => `- ${c}`).join("\n")}` : null,
    o.recentCaptions?.length ? `HOW RECENT CAPTIONS OPENED (never open the same way):\n${o.recentCaptions.map((c) => `- ${c.split(/\s+/).slice(0, 6).join(" ")}…`).join("\n")}` : null,
    o.previous ? `YOUR LAST DRAFT:\n${o.previous}` : null,
    o.notes.length ? `FIX THESE IN THIS DRAFT:\n${o.notes.map((n) => `- ${n}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  The editor's read                                                  */
/* ------------------------------------------------------------------ */

export type EditorRead = { scores: Record<string, number>; verdict: "publish" | "revise"; notes: string[] };

export const EDITOR_KEYS = ["hook", "value", "accuracy", "voice", "caption", "flow"] as const;

/** The editor's answer, read strictly: publish only when every score clears its bar, whatever it said. */
export function parseEditor(raw: unknown): EditorRead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sc = (r.scores && typeof r.scores === "object" ? r.scores : {}) as Record<string, unknown>;
  const scores: Record<string, number> = {};
  for (const k of EDITOR_KEYS) {
    const n = Number(sc[k]);
    if (!Number.isFinite(n)) return null;
    scores[k] = Math.max(1, Math.min(5, Math.round(n)));
  }
  const notes = Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => n.trim()) : [];
  const clears = EDITOR_KEYS.every((k) => scores[k] >= 4) && scores.accuracy === 5;
  return { scores, verdict: r.verdict === "publish" && clears ? "publish" : "revise", notes };
}

const editorTotal = (e: EditorRead | null) => (e ? EDITOR_KEYS.reduce((t, k) => t + e.scores[k], 0) : 0);

/* ------------------------------------------------------------------ */
/*  Writing one                                                        */
/* ------------------------------------------------------------------ */

function looseJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * What code can fix without a redraft: a dash between numbers is "to"
 * ("1–2" → "1 to 2"), any other dash a comma (he never types one).
 */
export function tidyText(t: string): string {
  return t
    // markdown a model slips in (~~struck~~, **bold**): the painter has its own marks
    .replace(/~~/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/[–—]/g, ", ")
    .replace(/,\s*,/g, ",");
}

function tidyDeck(deck: PostDeck): PostDeck {
  const walk = (v: unknown): unknown => (typeof v === "string" ? tidyText(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return { ...deck, slides: walk(deck.slides) as PostDeck["slides"], caption: tidyText(deck.caption) };
}

export type DeckAttempt = { deck: PostDeck | null; problems: string[]; editor: EditorRead | null; model: string | null };
export type DeckResult = { ok: true; deck: PostDeck; attempts: DeckAttempt[] } | { ok: false; error: string; attempts: DeckAttempt[]; best: DeckAttempt | null };

type Ask = (system: string, prompt: string, effort: "low" | "medium") => Promise<{ text: string; model: string }>;

/** The models on the `post_write` route, in order, each until one answers. */
export function routeAsker(override: Parameters<typeof resolveRoute>[1]): Ask {
  const route = resolveRoute("post_write", override);
  return async (system, prompt, effort) => {
    let last = "no answer";
    for (const model of route.models) {
      try {
        const reply = await callModelNow(model, { system, prompt, effort, maxOutputTokens: route.maxOutputTokens, timeoutMs: 150_000 });
        if (reply.text?.trim()) return { text: reply.text, model };
        last = `${model}: empty answer`;
      } catch (e: any) {
        last = `${model}: ${e?.message ?? e}`;
      }
    }
    throw new Error(`No model answered (${last})`);
  };
}

/**
 * Write a deck from `src`: a draft, the code's checks, the editor's read;
 * anything wrong goes back with the next draft (DECK_TRIES at most). Only a
 * draft that passes both is returned.
 */
export async function writeDeck(src: DeckSource, o: { ask: Ask; theme: DeckTheme; recentCovers: string[]; recentCaptions?: string[] }): Promise<DeckResult> {
  const attempts: DeckAttempt[] = [];
  let notes: string[] = [];
  let previous: string | null = null;
  const source = sourceText(src);
  for (let i = 0; i < DECK_TRIES; i++) {
    let reply: { text: string; model: string };
    try {
      reply = await o.ask(DECK_PROMPT, writerPrompt(src, { recentCovers: o.recentCovers, recentCaptions: o.recentCaptions, notes, previous }), "medium");
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), attempts, best: bestOf(attempts) };
    }
    const parsed = parseDeck(looseJson(reply.text), o.theme);
    const deck = parsed ? tidyDeck(parsed) : null;
    if (!deck) {
      attempts.push({ deck: null, problems: ["the answer wasn't a deck (JSON with a cover first and a caption)"], editor: null, model: reply.model });
      notes = ["answer with the JSON asked for: slides with the cover first, and a caption"];
      continue;
    }
    deck.theme = o.theme;
    const problems = deckProblems(deck, { source, diagram: !!src.diagram, recentCovers: o.recentCovers, recentCaptions: o.recentCaptions });
    if (problems.length) {
      attempts.push({ deck, problems, editor: null, model: reply.model });
      notes = problems;
      previous = JSON.stringify({ slides: deck.slides, caption: deck.caption });
      continue;
    }
    let editor: EditorRead | null = null;
    try {
      const read = await o.ask(EDITOR_PROMPT, `THE SOURCE:\n"""\n${source}\n"""\n\nTHE POST:\n${JSON.stringify({ slides: deck.slides, caption: deck.caption }, null, 1)}`, "low");
      editor = parseEditor(looseJson(read.text));
    } catch {
      editor = null;
    }
    attempts.push({ deck, problems: [], editor, model: reply.model });
    if (editor?.verdict === "publish") {
      return { ok: true, deck: { ...deck, v: DECK_VERSION, model: reply.model, made_at: new Date().toISOString() }, attempts };
    }
    notes = editor?.notes.length ? editor.notes : ["the editor couldn't read this draft: make every slide and the caption sharper and check every fact against the source"];
    previous = JSON.stringify({ slides: deck.slides, caption: deck.caption });
  }
  return { ok: false, error: "No draft passed the checks and the editor", attempts, best: bestOf(attempts) };
}

/** The closest a failed job got (fewest problems, then the editor's best scores): kept for the coach to see. */
function bestOf(attempts: DeckAttempt[]): DeckAttempt | null {
  return [...attempts].filter((a) => a.deck).sort((a, b) => a.problems.length - b.problems.length || editorTotal(b.editor) - editorTotal(a.editor))[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  The jobs                                                           */
/* ------------------------------------------------------------------ */

type Job = { id: string; item_id: string | null; post_id: string | null; attempts: number; dry: boolean };

/** The words a deck was made from, hashed the way the database does (sha256 hex): a deck whose source changed is made again, and never published over the new words. */
export async function sourceKey(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Claim one job (the one asked for, else the next due): a single conditional update, so two runs never take the same one. */
async function claim(admin: Admin, jobId: string | null): Promise<Job | null> {
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  let q = admin.from("community_post_decks").select("id, item_id, post_id, attempts, dry").or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stale})`);
  q = jobId ? q.eq("id", jobId) : q.lte("run_after", new Date().toISOString()).order("priority", { ascending: true }).order("created_at", { ascending: true });
  const { data: rows } = await q.limit(1);
  const row = rows?.[0];
  if (!row) return null;
  const { data: got } = await admin
    .from("community_post_decks")
    .update({ status: "running", claimed_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stale})`)
    .select("id, item_id, post_id, attempts, dry")
    .maybeSingle();
  return got ?? null;
}

/** The covers and themes of the decks around this one (newest first): a new deck is never the same look or the same hook. */
async function neighbours(admin: Admin, at: string | null): Promise<{ themes: (DeckTheme | null)[]; covers: string[]; captions: string[] }> {
  let q = admin.from("community_posts").select("series_data, created_at").not("series_data->deck", "is", null).is("archived_at", null).order("created_at", { ascending: false }).limit(12);
  if (at) q = q.lt("created_at", at);
  const { data: posts } = await q;
  const { data: items } = await admin.from("community_series_items").select("data, updated_at").not("data->deck", "is", null).order("updated_at", { ascending: false }).limit(12);
  const themes = (posts ?? []).map((p: any) => (isDeckTheme(p.series_data?.deck?.theme) ? p.series_data.deck.theme : null));
  // what's been made most recently, posts and library alike (and the drafts waiting for a read)
  const { data: drafts } = await admin.from("community_post_decks").select("result").not("result", "is", null).order("updated_at", { ascending: false }).limit(12);
  const decks = [...(posts ?? []).map((p: any) => p.series_data?.deck), ...(items ?? []).map((i: any) => i.data?.deck), ...(drafts ?? []).map((d: any) => d.result)]
    .map((d) => (d ? parseDeck(d) : null))
    .filter((d): d is PostDeck => !!d);
  const covers = decks.map(deckHeadline).filter(Boolean);
  const captions = decks.map((d) => d.caption).filter(Boolean);
  return { themes, covers: [...new Set(covers)].slice(0, 16), captions: [...new Set(captions)].slice(0, 12) };
}

/**
 * The themes an upcoming post's deck stays clear of: the last two decks
 * posted (what the feed shows now) and the one most recently made for the
 * library (the next to go out), so posts in a row never share a look.
 */
async function lastItemThemes(admin: Admin): Promise<(DeckTheme | null)[]> {
  const [{ data: posts }, { data: items }] = await Promise.all([
    admin.from("community_posts").select("series_data").not("series_data->deck", "is", null).is("archived_at", null).order("created_at", { ascending: false }).limit(2),
    admin.from("community_series_items").select("data").not("data->deck", "is", null).eq("use_count", 0).order("updated_at", { ascending: false }).limit(1),
  ]);
  const theme = (d: any) => (isDeckTheme(d?.deck?.theme) ? d.deck.theme : null);
  return [...(items ?? []).map((i: any) => theme(i.data)), ...(posts ?? []).map((p: any) => theme(p.series_data))];
}

export type RunResult = { status: "idle" } | { status: "done" | "failed" | "skipped"; job: string; detail?: string; deck?: PostDeck | null };

async function finish(admin: Admin, id: string, patch: Record<string, unknown>) {
  await admin.from("community_post_decks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/**
 * Run one job: claim it, read what it's made from, write the deck, save it
 * where it goes. `jobId`: that one (else the next due). `env` and `ask` only
 * for tests.
 */
export async function runDeckJob(admin: Admin, jobId: string | null = null, o: { ask?: Ask } = {}): Promise<RunResult> {
  if (!o.ask && !process.env.OPENAI_API_KEY) return { status: "idle" };
  const job = await claim(admin, jobId);
  if (!job) return { status: "idle" };
  try {
    const ask = o.ask ?? routeAsker(await readRouteOverride(admin));
    // what it's made from: the post (as it went out) and its library item, or the item alone
    let post: any = null;
    let item: any = null;
    if (job.post_id) {
      const { data } = await admin.from("community_posts").select("id, series, caption, series_data, series_item_id, edited_at, archived_at, created_at").eq("id", job.post_id).maybeSingle();
      post = data;
      if (!post || post.archived_at) {
        await finish(admin, job.id, { status: "skipped", error: "The post is gone or archived" });
        return { status: "skipped", job: job.id, detail: "gone" };
      }
    }
    const itemId = job.item_id ?? post?.series_item_id ?? null;
    if (itemId) {
      const { data } = await admin.from("community_series_items").select("id, series, body, data").eq("id", itemId).maybeSingle();
      item = data;
    }
    const series = post?.series ?? item?.series;
    const body = String((post ? post.caption : item?.body) ?? "").trim();
    if (!series || !body) {
      await finish(admin, job.id, { status: "skipped", error: "Nothing to make it from" });
      return { status: "skipped", job: job.id, detail: "empty" };
    }
    // a post the coach edited, or a lesson he wrote his own caption for that day, stays his
    // (a caption that differs from its library text otherwise came from an earlier library rewrite, not from him)
    const ownDay = post?.series === "lesson" ? (await admin.from("community_lesson_plan").select("id").eq("post_id", post.id).not("body", "is", null).limit(1)).data?.length : 0;
    if (post && (post.edited_at || ownDay)) {
      await finish(admin, job.id, { status: "skipped", error: "The coach's own words: left as they are" });
      return { status: "skipped", job: job.id, detail: "edited" };
    }
    const src = deckSource(series, body, post?.series_data ?? item?.data);
    const near = await neighbours(admin, post?.created_at ?? null);
    const themes = post ? near.themes : await lastItemThemes(admin);
    const theme = pickDeckTheme(`${job.post_id ?? job.item_id}`, themes);
    const made = await writeDeck(src, { ask, theme, recentCovers: near.covers, recentCaptions: near.captions });
    const trail = made.attempts.map((a) => ({ problems: a.problems, editor: a.editor, model: a.model }));
    if (!made.ok) {
      await finish(admin, job.id, { status: "failed", error: made.error, problems: trail, best: made.best?.deck ?? null });
      return { status: "failed", job: job.id, detail: made.error, deck: made.best?.deck ?? null };
    }
    const deck: PostDeck & { src: string } = { ...made.deck, src: await sourceKey(item?.body ?? body) };
    const before = post ? { caption: post.caption, series_data: post.series_data } : null;
    // a dry run (the posts already out, the first time): kept for a read before it's applied (community_post_deck_apply)
    if (job.dry) {
      await finish(admin, job.id, { status: "review", error: null, problems: trail, model: deck.model, result: deck, before });
      return { status: "done", job: job.id, deck };
    }
    if (item) {
      const { error } = await admin.from("community_series_items").update({ data: { ...(item.data ?? {}), deck }, updated_at: new Date().toISOString() }).eq("id", item.id);
      if (error) throw new Error(error.message);
    }
    if (post) {
      // in place: the same post, its date, likes, comments and views; only its caption and slides, and only while they're still the library's
      const { data: done, error } = await admin
        .from("community_posts")
        .update({ caption: deck.caption, series_data: { ...(post.series_data ?? {}), deck } })
        .eq("id", post.id)
        .eq("caption", post.caption)
        .is("edited_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!done?.length) {
        await finish(admin, job.id, { status: "skipped", error: "The post changed while its deck was written" });
        return { status: "skipped", job: job.id, detail: "changed" };
      }
    }
    await finish(admin, job.id, { status: "done", error: null, problems: trail, model: deck.model, result: deck, before });
    return { status: "done", job: job.id, deck };
  } catch (e: any) {
    const tries = job.attempts ?? 1;
    await finish(admin, job.id, {
      status: tries >= 3 ? "failed" : "pending",
      error: String(e?.message ?? e).slice(0, 500),
      run_after: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    return { status: "failed", job: job.id, detail: String(e?.message ?? e) };
  }
}
