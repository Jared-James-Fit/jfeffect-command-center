/**
 * The daily pictures' background maker (daily-visuals-tick hook, woken by
 * pg_cron or by the coach when a day is queued: `regen` = full / caption /
 * picture; see 20270125090000_daily_pictures_rebuild.sql).
 *
 * A post is made concept first, in steps, each in its own run so none
 * outlives the hook (a run does a second step only while it's young, and
 * wakes the next run itself when there's more):
 *
 *   1. concept: what's worked (community_daily_visual_stats →
 *      learnDailyVisuals → pickChoices: styles, caption forms and topics not
 *      used in the last few days, best first), the days around it and the
 *      captions the coach threw out → the concept and caption, held to
 *      captionProblems (plain words, his voice, no slogans, nothing close to a
 *      recent post) with up to 3 tries; kept on the side in `candidate`.
 *   2. picture: the image model (picturePrompt: the style, the JF Effect
 *      look, the scene, any words in it spelled exactly) and then the review
 *      that looks at the picture with the caption (reviewVerdict: the words
 *      read off it must be exactly what was asked, no defects, every score at
 *      its bar). A caption the reviewer marks down gets one rewrite against
 *      the same picture. A picture that fails is made again with the fix (2 a
 *      concept), then a new concept (3 at most).
 *   3. it passes → community_daily_visual_apply puts it live in one step
 *      (the version before kept; a posted day's post updated in place). It
 *      can't be made → the original stays and the reason goes on the day (a
 *      new day with nothing yet takes its best try when nothing's wrong with
 *      the picture itself).
 *
 * The models are OpenAI's (text, vision and images); Lovable AI is used only
 * when the coach turns it on (community_series_settings.daily_visuals_lovable).
 */
import {
  CAPTION_FIX_PROMPT,
  CONCEPT_PROMPT,
  DAILY_ART_KEYS,
  DAILY_FORMAT_KEYS,
  DAILY_PILLAR_KEYS,
  DAILY_STYLE_KEYS,
  DAILY_TOPICS,
  DAILY_TOPIC_KEYS,
  EDITOR_FLAGS,
  EDITOR_PROMPT,
  EDITOR_SCORES,
  FILM_LOOK_VERSION,
  REVIEW_BARS,
  REVIEW_PROMPT,
  captionFixPrompt,
  captionProblems,
  conceptPrompt,
  crowdForDay,
  editorPrompt,
  editorScore,
  editorVerdict,
  endsWithQuestion,
  learnDailyVisuals,
  learningsText,
  parseCaption,
  parseConcept,
  parseEditor,
  parseReview,
  pickChoices,
  pickVerse,
  picturePrompt,
  pillarOf,
  reviewPrompt,
  reviewScore,
  reviewVerdict,
  tidyCaption,
  typographyProblems,
  type DailyAudience,
  type DailyConcept,
  type DailyArt,
  type DailyCrowd,
  type DailyFormat,
  type DailyLearnings,
  type DailyPillar,
  type DailyStyle,
  type DailyTheme,
  type DailyTopic,
  type EditorReview,
  type FaithVerse,
  type Recent,
  type Review,
  type VisualStat,
} from "@/lib/daily-visuals";
import { generatePicture, generatePictureWithRefs, storePicture, type Made, type RefImage } from "@/lib/post-pictures.server";

type Admin = any;
type Entry = { path: string; type: string; width: number; height: number };

export type Candidate = {
  /** Which concept this is (1…MAX_ROUNDS). */
  round: number;
  /** Pictures tried for this concept. */
  pictures: number;
  concept?: DailyConcept;
  caption?: string;
  /** A picture-only remake: the caption is the day's own. */
  keepCaption?: boolean;
  /** A words-only remake: the picture is the day's own. */
  keepPicture?: boolean;
  verse?: FaithVerse | null;
  /** The last review's fix for the picture. */
  fix?: string | null;
  model?: string;
  learned?: Record<string, unknown>;
  /** What failed last, for the coach. */
  issues?: string[];
  /** The editor's read of the caption (its scores, why, and whether it cleared every bar). */
  editor?: { passed: boolean; score: number; scores: Record<string, number>; why: string; drafts: number } | null;
  /** A new day's best try so far (a picture with nothing wrong in it), used if nothing passes. */
  best?: { entry: Entry; provider: string; caption: string; concept: DailyConcept; review: Review; score: number } | null;
};

export type DailyRow = {
  id: string;
  day: string;
  theme: DailyTheme;
  audience: DailyAudience;
  faith: boolean;
  style: string | null;
  format: string | null;
  topic: string | null;
  ai_line: string | null;
  coach_line: string | null;
  shot: string | null;
  concept: (Partial<DailyConcept> & Record<string, unknown>) | null;
  verse_ref: string | null;
  verse_text: string | null;
  picture: (Entry & Record<string, unknown>) | null;
  picture_provider: string | null;
  status: "planned" | "ready" | "posted" | "skipped" | "failed";
  attempts: number;
  updated_at: string;
  regen: "full" | "caption" | "picture" | null;
  regen_style: DailyStyle | null;
  regen_reason: string | null;
  candidate: Candidate | null;
  post_id: string | null;
};

const COLS =
  "id, day, theme, audience, faith, style, format, topic, ai_line, coach_line, shot, concept, verse_ref, verse_text, picture, picture_provider, status, attempts, updated_at, regen, regen_style, regen_reason, candidate, post_id";
/** Errors in a row (no answer, a crash) before a day gives up and keeps what it has. */
const MAX_ERRORS = 4;
const RETRY_AFTER_MS = 20 * 60 * 1000;
/** Concepts tried before a remake gives up. */
const MAX_ROUNDS = 3;
const PICTURES_PER_CONCEPT = 2;
/** Below this the picture is too soft for a phone's 4:5 feed. */
const MIN_SIDE = 900;
const AHEAD_DAYS = 3;
const BACK_DAYS = 45;
/** A run starts another step only this young (the hook allows 5 minutes). */
const SECOND_STEP_BEFORE_MS = 60_000;
const LEARNED_KEY = "daily_visuals_learned";
const STATUS_KEY = "daily_visuals_status";
const BUCKET = "community-media";

const tz = "America/Winnipeg";
export function localDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
const lineOf = (r: { coach_line: string | null; ai_line: string | null }) => (r.coach_line?.trim() || r.ai_line?.trim() || "").trim();
const hasLive = (r: DailyRow) => !!r.picture?.path && !!lineOf(r);

/** Days not out yet first (soonest first: they post first), then the ones already out (latest first). */
export function workOrder<T extends { day: string; status?: string }>(rows: T[], today: string): T[] {
  const ahead = rows.filter((r) => r.status !== "posted" && r.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const rest = rows.filter((r) => !ahead.includes(r)).sort((a, b) => b.day.localeCompare(a.day));
  return [...ahead, ...rest];
}

export const isDue = (r: Pick<DailyRow, "regen" | "status" | "attempts" | "updated_at">, now: number) =>
  !!r.regen && r.status !== "skipped" && (r.attempts === 0 || now - Date.parse(r.updated_at) > RETRY_AFTER_MS);

/* ------------------------------------------------------------------ */
/*  The models                                                         */
/* ------------------------------------------------------------------ */

const OPENAI_TEXT_MODELS = ["gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"];
let openAiTextModel: string | null = null;

type Maker = {
  provider: "openai" | "lovable";
  /** A JSON answer, optionally looking at a picture (a data URL). */
  json: (system: string, prompt: string, o?: { images?: string[]; effort?: "low" | "medium" }) => Promise<{ text: string; model: string }>;
  /** A picture from the prompt, matching the style references when there are any (OpenAI only). */
  picture: (prompt: string, refs?: RefImage[]) => Promise<Made>;
};

async function errorText(res: Response, who: string): Promise<string> {
  try {
    const j = await res.json();
    const m = j?.error?.message ?? j?.message;
    return m ? `${who}: ${String(m).slice(0, 200)}` : `${who} said no (${res.status})`;
  } catch {
    return `${who} said no (${res.status})`;
  }
}

function userContent(prompt: string, images?: string[]) {
  return images?.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } }))] : prompt;
}

async function openAiJson(key: string, system: string, prompt: string, o: { images?: string[]; effort?: "low" | "medium" } = {}) {
  const models = process.env.OPENAI_TEXT_MODEL ? [process.env.OPENAI_TEXT_MODEL] : openAiTextModel ? [openAiTextModel] : OPENAI_TEXT_MODELS;
  let last = "OpenAI didn't answer";
  for (const model of models) {
    const reasoning = /^(gpt-5|o\d)/.test(model);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent(prompt, o.images) },
        ],
        response_format: { type: "json_object" },
        ...(reasoning ? { reasoning_effort: o.effort ?? "medium" } : { temperature: 0.9 }),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      last = await errorText(res, `OpenAI ${model}`);
      // a model this key doesn't have (or doesn't take these options) is worth trying the next
      if (res.status === 404 || (res.status === 400 && /model|reasoning|temperature|does not exist|unsupported/i.test(last))) continue;
      throw new Error(last);
    }
    const text = (await res.json())?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.trim()) {
      openAiTextModel = model;
      return { text, model: `openai:${model}` };
    }
    last = `OpenAI ${model} answered with nothing`;
  }
  throw new Error(last);
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
async function lovableJson(key: string, system: string, prompt: string, o: { images?: string[] } = {}) {
  const { DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEFAULT_AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent(prompt, o.images) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(await errorText(res, "Lovable AI"));
  const text = (await res.json())?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Lovable AI answered with nothing");
  return { text, model: `lovable:${DEFAULT_AI_MODEL}` };
}

/** OpenAI when there's a key; Lovable AI only if the coach allows it; else nothing (and why). */
export function makerFor(allowLovable: boolean, env: Record<string, string | undefined> = process.env): Maker | { blocked: string } {
  const openai = env.OPENAI_API_KEY;
  if (openai)
    return {
      provider: "openai",
      json: (s, p, o) => openAiJson(openai, s, p, o),
      picture: (p, refs) => (refs?.length ? generatePictureWithRefs(p, refs) : generatePicture(p, { lovable: false })),
    };
  const lovable = allowLovable ? env.LOVABLE_API_KEY : undefined;
  if (lovable)
    return {
      provider: "lovable",
      json: (s, p, o) => lovableJson(lovable, s, p, o),
      picture: (p) => generatePicture(p, { lovable: true }),
    };
  return { blocked: allowLovable ? "No AI key is set up (OPENAI_API_KEY or LOVABLE_API_KEY)." : "No OpenAI key (OPENAI_API_KEY) is set up, and Lovable AI is off for daily pictures." };
}

/* ------------------------------------------------------------------ */
/*  Reading and writing                                                */
/* ------------------------------------------------------------------ */

async function saveSetting(admin: Admin, key: string, value: unknown) {
  const text = JSON.stringify(value);
  const { data } = await admin.from("app_settings").update({ value: text, updated_at: new Date().toISOString() }).eq("key", key).select("id");
  if (!data?.length) await admin.from("app_settings").insert({ key, value: text });
}

/** Takes a row for this step (nobody touched it since it was read), counting the try. */
async function claim(admin: Admin, r: DailyRow): Promise<DailyRow | null> {
  const { data } = await admin
    .from("community_daily_visuals")
    .update({ attempts: r.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", r.id)
    .eq("updated_at", r.updated_at)
    .not("regen", "is", null)
    .select(COLS)
    .maybeSingle();
  return (data as DailyRow) ?? null;
}

/** The step's work saved on the side; a step that worked starts the error count again. */
async function saveCandidate(admin: Admin, r: DailyRow, c: Candidate) {
  const { error } = await admin
    .from("community_daily_visuals")
    .update({ candidate: c, attempts: 0, error: null, updated_at: new Date().toISOString() })
    .eq("id", r.id);
  if (error) throw new Error(error.message);
}

async function removeFile(admin: Admin, path: string | undefined | null) {
  if (path && path.includes("/post-pictures/")) await admin.storage.from(BUCKET).remove([path]);
}

/** The remake stops: a new day takes its best try if it has one, else what was there stays (or it's marked failed). */
async function giveUp(admin: Admin, r: DailyRow, reason: string): Promise<string> {
  const best = r.candidate?.best;
  if (best && !hasLive(r)) {
    await applyMade(admin, r, best.concept, best.caption, best.entry, best.provider, best.review, r.candidate!, { passed: false, why: reason });
    return "used its best try";
  }
  await removeFile(admin, best?.entry.path);
  const kept = hasLive(r);
  await admin
    .from("community_daily_visuals")
    .update({
      regen: null,
      regen_style: null,
      regen_reason: null,
      candidate: null,
      attempts: 0,
      error: (kept ? `Kept what was there: ${reason}` : `Couldn't make it: ${reason}`).slice(0, 500),
      status: kept || r.status === "posted" ? r.status : "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", r.id);
  return kept ? "kept the original" : "failed";
}

async function fail(admin: Admin, r: DailyRow, error: string): Promise<string> {
  if (r.attempts >= MAX_ERRORS) return giveUp(admin, r, error);
  await admin
    .from("community_daily_visuals")
    .update({ error: error.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", r.id);
  return "will try again";
}

type Around = {
  day: string;
  ai_line: string | null;
  coach_line: string | null;
  style: string | null;
  format: string | null;
  topic: string | null;
  verse_ref: string | null;
  concept: { light?: string; pillar?: string; mood?: string } | null;
};

/** The days around it (3 weeks back, a week ahead), nearest last, and the captions the coach threw out. */
async function context(admin: Admin, r: DailyRow) {
  const [{ data: around }, { data: rejected }, { data: own }] = await Promise.all([
    admin
      .from("community_daily_visuals")
      .select("day, ai_line, coach_line, style, format, topic, verse_ref, concept")
      .neq("id", r.id)
      .gte("day", addDays(r.day, -21))
      .lte("day", addDays(r.day, 7)),
    admin.from("community_daily_visual_versions").select("ai_line, coach_line").eq("reason", "rejected").order("created_at", { ascending: false }).limit(8),
    admin.from("community_daily_visual_versions").select("ai_line, coach_line").eq("visual_id", r.id),
  ]);
  const days = ((around ?? []) as Around[]).sort((a, b) => daysApart(b.day, r.day) - daysApart(a.day, r.day));
  const recent: Recent[] = days.map((d) => ({
    day: d.day,
    style: d.style,
    light: d.concept?.light ?? null,
    format: d.format,
    topic: d.topic,
    pillar: pillarOf({ pillar: d.concept?.pillar, topic: d.topic }),
    mood: d.concept?.mood ?? null,
    caption: lineOf(d),
  }));
  // the two posts before this one both ended on a question: this one doesn't
  const before = days.filter((d) => d.day < r.day).sort((a, b) => a.day.localeCompare(b.day)).slice(-2).map(lineOf);
  const thrownOut = ((rejected ?? []) as { ai_line: string | null; coach_line: string | null }[]).map(lineOf).filter(Boolean);
  // a remake must not come back as the one it replaces (or any earlier one of this day)
  const mine = [lineOf(r), ...((own ?? []) as { ai_line: string | null; coach_line: string | null }[]).map(lineOf)].filter(Boolean);
  return {
    recent,
    asked: before.length === 2 && before.every((l) => l && endsWithQuestion(l)),
    near: days.filter((d) => daysApart(d.day, r.day) <= 3).map(lineOf).filter(Boolean),
    compareTo: [...days.map(lineOf).filter(Boolean), ...thrownOut, ...(r.regen === "picture" ? [] : mine)],
    rejected: thrownOut,
    verses: ((around ?? []) as Around[])
      .filter((d) => d.verse_ref && d.day < r.day)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => d.verse_ref as string),
  };
}

async function bytesOf(admin: Admin, path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn't read the picture: ${error?.message ?? "missing"}`);
  const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime };
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

/* ------------------------------------------------------------------ */
/*  Step 1: the concept and the caption                                */
/* ------------------------------------------------------------------ */

/** The concept and caption for a day (or a test), checked, not saved. */
type Force = { pillar?: DailyPillar | null; topic?: DailyTopic | null; format?: DailyFormat | null; art?: DailyArt | null; crowd?: DailyCrowd | null };

/** Writer attempts per concept step (each one: a concept with three drafts, the hard checks, then the editor). */
const WRITER_TRIES = 3;
/** A brand-new day with nothing yet may take the editor's best near miss (no flag, nothing under 3) at this average. */
const NEAR_MISS_SCORE = 3.8;

async function planConcept(admin: Admin, r: DailyRow, maker: Maker, learned: DailyLearnings, c: Candidate, force: Force = {}): Promise<Candidate> {
  const keepCaption = r.regen === "picture" && !!lineOf(r);
  const keepPicture = r.regen === "caption" && !!r.picture?.path;
  const ctx = await context(admin, r);
  const keptStyle = keepPicture ? ((DAILY_STYLE_KEYS as string[]).includes(r.style ?? "") ? (r.style as DailyStyle) : "medium_candid") : null;
  // a picture-only remake keeps the day's own pillar (its caption stays)
  const keptPillar = keepCaption ? pillarOf({ pillar: r.concept?.pillar as string | undefined, topic: r.topic }) : null;
  const pillar = force.pillar ?? (force.topic ? DAILY_TOPICS[force.topic].pillar : null) ?? keptPillar;
  const picked = pickChoices(learned, { day: r.day, recent: ctx.recent, style: keptStyle ?? r.regen_style, pillar });
  const choices = { ...picked, topics: force.topic ? [force.topic] : picked.topics, formats: force.format ? [force.format] : picked.formats };
  const crowd: DailyCrowd = force.crowd ?? crowdForDay(r.day);

  // his never-say lists, not his texting style: the feed reads like a social post, not a text
  const { loadCoachVoice } = await import("@/lib/coach-voice.functions");
  const voice = await loadCoachVoice(admin).catch(() => null);
  const neverSay = [...(voice?.banned ?? []), ...(voice?.edgy ?? [])].filter(Boolean);
  const keep = keepCaption
    ? { caption: lineOf(r) }
    : keepPicture
      ? { picture: (r.concept?.visual as string | undefined) || r.shot || "the picture already on the post", style: keptStyle ?? undefined }
      : null;
  const recentCaptions = [...ctx.recent].sort((a, b) => a.day.localeCompare(b.day)).map((x) => x.caption ?? "").filter(Boolean);

  let made: DailyConcept | null = null;
  let editor: Candidate["editor"] = null;
  let nearMiss: { concept: DailyConcept; editor: NonNullable<Candidate["editor"]> } | null = null;
  let model = "";
  let notes: string[] = [];
  for (let attempt = 0; attempt < WRITER_TRIES && !made; attempt++) {
    const t = await maker.json(
      CONCEPT_PROMPT,
      conceptPrompt({
        day: r.day,
        theme: r.theme,
        audience: r.audience,
        crowd,
        faith: r.faith,
        choices,
        learnings: learningsText(learned),
        best: learned.best.map((x) => x.line).filter(Boolean),
        worst: learned.worst.map((x) => x.line).filter(Boolean),
        recent: ctx.recent,
        rejected: ctx.rejected,
        neverSay,
        art: force.art ?? null,
        keep,
        editorNotes: attempt ? notes : undefined,
      }),
    );
    model = t.model;
    const parsed = parseConcept(t.text, { ...choices, art: force.art ?? null, crowd });
    if (!parsed) {
      notes = ["the answer wasn't the JSON asked for"];
      continue;
    }
    const typography = keepPicture ? "" : parsed.typography;
    const typo = typographyProblems(typography);
    const style = keptStyle ?? parsed.style;
    if (keepCaption) {
      if (!typo.length) made = { ...parsed, style, typography, drafts: [lineOf(r)], caption: lineOf(r) };
      else notes = typo;
      continue;
    }
    // each draft is held to its own form (a one-liner's length, a list's lines)
    const base = { pillar: parsed.pillar, recent: ctx.compareTo, near: ctx.near, asked: ctx.asked, picture: typography };
    const checksFor = (form: DailyFormat) => ({ ...base, format: form });
    const drafts = parsed.drafts.map(tidyCaption);
    const forms = drafts.map((_, i) => parsed.draftForms[i] ?? parsed.format);
    const passing = drafts.map((d, i) => ({ text: d, form: forms[i] })).filter((d) => !captionProblems(d.text, checksFor(d.form)).length);
    const ok = passing.map((d) => d.text);
    if (typo.length || !ok.length) {
      notes = [...typo, ...drafts.map((d, i) => `draft ${i + 1} (${forms[i]}): ${captionProblems(d, checksFor(forms[i])).join(", ")}`)].slice(0, 6);
      continue;
    }
    // the editor: scores the drafts that passed, picks one and polishes it
    const e = await maker.json(EDITOR_PROMPT, editorPrompt({ concept: parsed, audience: r.audience, drafts: ok, forms: passing.map((d) => d.form), recent: recentCaptions }), { effort: "low" });
    const ed: EditorReview | null = parseEditor(e.text, ok.length);
    if (!ed) {
      notes = ["the editor's answer wasn't readable"];
      continue;
    }
    const chosen = ok[ed.best];
    const format = passing[ed.best].form;
    const checks = checksFor(format);
    const polished = ed.polished ? tidyCaption(ed.polished) : "";
    // the polish only stands when it still passes and is still the same caption (an editor never rewrites the idea)
    const caption = polished && polished.length >= chosen.length * 0.5 && !captionProblems(polished, checks).length ? polished : chosen;
    const verdict = editorVerdict(ed, parsed.pillar);
    const pick = ed.drafts[ed.best];
    const read = { passed: verdict.pass, score: editorScore(pick), scores: pick.scores, why: ed.why || pick.note, drafts: ok.length };
    const concept = { ...parsed, format, style, typography, drafts, caption };
    if (verdict.pass) {
      made = concept;
      editor = read;
    } else {
      notes = verdict.issues;
      const clean = !EDITOR_FLAGS.some((f) => pick.flags[f]) && EDITOR_SCORES.every((k) => pick.scores[k] >= 3);
      if (clean && (!nearMiss || read.score > nearMiss.editor.score)) nearMiss = { concept, editor: read };
    }
  }
  // a brand-new day with nothing yet takes a clean near miss rather than no post at all
  if (!made && nearMiss && !hasLive(r) && nearMiss.editor.score >= NEAR_MISS_SCORE) {
    made = nearMiss.concept;
    editor = nearMiss.editor;
  }
  if (!made) throw new Error(`The captions didn't pass: ${notes.join("; ")}`);

  const verse = r.faith ? (r.verse_ref && r.verse_text ? { ref: r.verse_ref, text: r.verse_text } : pickVerse(ctx.verses)) : null;
  return {
    ...c,
    concept: made,
    caption: made.caption,
    keepCaption,
    keepPicture,
    verse,
    model,
    fix: null,
    editor,
    learned: {
      posts: learned.posts,
      text: learningsText(learned),
      pillar: choices.pillar,
      crowd,
      topics: choices.topics.slice(0, 3),
      formats: choices.formats.slice(0, 3),
      styles: choices.styles.slice(0, 4),
      lights: choices.lights.slice(0, 3),
    },
  };
}

async function conceptStep(admin: Admin, r: DailyRow, maker: Maker, learned: DailyLearnings, c: Candidate): Promise<string> {
  const next = await planConcept(admin, r, maker, learned, c);
  await saveCandidate(admin, r, next);
  return `concept ${c.round} (${next.concept!.pillar}, ${next.concept!.topic}, ${next.concept!.format}, ${next.concept!.style}, editor ${next.editor?.score ?? "-"})`;
}

/* ------------------------------------------------------------------ */
/*  Step 2: the picture, the review, and live                          */
/* ------------------------------------------------------------------ */

async function review(maker: Maker, r: DailyRow, concept: DailyConcept, caption: string, image: string, refs: string[] = []): Promise<Review> {
  const t = await maker.json(REVIEW_PROMPT, reviewPrompt({ caption, concept, audience: r.audience, references: refs.length }), { images: [...refs, image], effort: "low" });
  const parsed = parseReview(t.text);
  if (!parsed) throw new Error("The review didn't come back as the JSON asked for");
  return parsed;
}

async function applyMade(
  admin: Admin,
  r: DailyRow,
  concept: DailyConcept,
  caption: string,
  entry: Entry,
  provider: string,
  rev: Review,
  c: Candidate,
  verdict: { passed: boolean; why?: string },
) {
  const patch: Record<string, unknown> = {
    picture: c.keepPicture ? undefined : entry,
    picture_provider: c.keepPicture ? undefined : provider,
    ai_line: c.keepCaption ? undefined : caption,
    audience: r.audience,
    style: concept.style,
    format: concept.format,
    topic: concept.topic,
    shot: concept.visual.slice(0, 1500),
    concept: {
      situation: concept.situation,
      tension: concept.tension,
      message: concept.message,
      visual: concept.visual,
      typography: concept.typography,
      light: concept.light,
      art: concept.art,
      look: FILM_LOOK_VERSION,
      round: c.round,
      pillar: concept.pillar,
      crowd: concept.crowd,
      mood: concept.mood,
      editor: c.editor ?? null,
    },
    review: { ...rev, score: reviewScore(rev), passed: verdict.passed, why: verdict.why ?? null, at: new Date().toISOString() },
    model: c.model,
    learned: c.learned,
    ...(r.faith && c.verse ? { verse_ref: c.verse.ref, verse_text: c.verse.text } : {}),
  };
  const { error } = await admin.rpc("community_daily_visual_apply", { _id: r.id, _patch: JSON.parse(JSON.stringify(patch)) });
  if (error) throw new Error(`Couldn't put it live: ${error.message}`);
}

/**
 * The coach's two references (daily-style-refs.server.ts) placed as each art
 * direction's reference, once: under the posting account in the Crew bucket,
 * only where none is set, then marked seeded so a reference he later removes
 * or replaces stays his choice.
 */
export async function seedStyleRefs(admin: Admin): Promise<string[]> {
  const { DEFAULT_STYLE_REFS, STYLE_REFS_SEED } = await import("@/lib/daily-style-refs.server");
  const { data } = await admin.from("community_series_settings").select("daily_visuals_refs, author_user_id").maybeSingle();
  const refs = (data?.daily_visuals_refs ?? {}) as Record<string, string>;
  if (refs.seeded === STYLE_REFS_SEED || !data?.author_user_id) return [];
  const next: Record<string, string> = { ...refs, seeded: STYLE_REFS_SEED };
  const placed: string[] = [];
  for (const art of DAILY_ART_KEYS) {
    if (refs[art]) continue;
    const m = /^data:([^;]+);base64,(.+)$/.exec(DEFAULT_STYLE_REFS[art]);
    if (!m) continue;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `${data.author_user_id}/daily-style/${art}-${Date.now()}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
    if (error) throw new Error(`Couldn't place the ${art} reference: ${error.message}`);
    next[art] = path;
    placed.push(art);
  }
  const { error } = await admin.from("community_series_settings").update({ daily_visuals_refs: next }).eq("id", true);
  if (error) throw new Error(error.message);
  return placed;
}

/** The coach's style reference for an art direction (community_series_settings.daily_visuals_refs), once per run. */
const refCache = new Map<string, RefImage | null>();
async function styleReference(admin: Admin, art: DailyArt | undefined): Promise<(RefImage & { path: string }) | null> {
  if (!art) return null;
  const { data } = await admin.from("community_series_settings").select("daily_visuals_refs").maybeSingle();
  const path = (data?.daily_visuals_refs as Record<string, string> | null)?.[art];
  if (!path) return null;
  if (!refCache.has(path)) {
    try {
      refCache.set(path, await bytesOf(admin, path));
    } catch {
      refCache.set(path, null);
    }
  }
  const ref = refCache.get(path);
  return ref ? { ...ref, path } : null;
}

/**
 * A stored picture as the vision model sees it: a 10-minute signed link, so
 * a review never builds a multi-megabyte base64 copy (two at once ran the
 * worker out of memory); the bytes as a data URL only if signing fails.
 */
async function pictureUrl(admin: Admin, path: string, bytes?: { bytes: Uint8Array; mime: string }): Promise<string> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  if (data?.signedUrl) return data.signedUrl;
  const b = bytes ?? (await bytesOf(admin, path));
  return dataUrl(b.bytes, b.mime);
}

type Drawn = { entry: Entry; provider: string; rev: Review; verdict: ReturnType<typeof reviewVerdict>; caption: string; imageIssues: string[]; captionIssues: string[]; madeHere: boolean };

/** The picture (or the day's own, for a words-only remake) and its review, with one caption rewrite if the words were marked down. */
async function drawAndReview(admin: Admin, r: DailyRow, maker: Maker, c: Candidate, name = `daily-${r.day}`): Promise<Drawn> {
  const concept = c.concept!;
  let caption = c.caption!;
  let entry: Entry;
  let provider: string;
  let image: string;
  let madeHere = false;
  const ref = c.keepPicture ? null : await styleReference(admin, concept.art);
  if (c.keepPicture && r.picture?.path) {
    entry = r.picture;
    provider = r.picture_provider ?? "";
    image = await pictureUrl(admin, r.picture.path);
  } else {
    // with the coach's style reference for this art direction when there is one, else (or if that fails) the words alone
    let made = ref ? await maker.picture(picturePrompt(concept, { faith: r.faith, fix: c.fix, reference: true }), [ref]) : null;
    if (!made?.ok) made = await maker.picture(picturePrompt(concept, { faith: r.faith, fix: c.fix }));
    if (!made.ok) throw new Error(made.reason);
    const { width, height } = made.picture;
    if (Math.min(width, height) < MIN_SIDE) throw new Error(`The picture came back too small (${width}×${height})`);
    if (height <= width) throw new Error(`The picture came back wide, not tall (${width}×${height})`);
    const { data: settings } = await admin.from("community_series_settings").select("author_user_id").maybeSingle();
    if (!settings?.author_user_id) throw new Error("No account to post as yet");
    entry = await storePicture(admin, settings.author_user_id, name, made.picture);
    provider = made.picture.provider;
    image = await pictureUrl(admin, entry.path, made.picture);
    madeHere = true;
  }

  const refUrls = ref ? [await pictureUrl(admin, ref.path, ref)] : [];
  let rev = await review(maker, r, concept, caption, image, refUrls);
  let verdict = reviewVerdict(rev, concept.typography, concept.visual, concept.pillar);
  // a caption the reviewer marked down gets one rewrite against this same picture
  if (!verdict.image.length && verdict.caption.length && !c.keepCaption) {
    const t = await maker.json(CAPTION_FIX_PROMPT, captionFixPrompt({ concept, caption, fix: verdict.caption }));
    const rewritten = parseCaption(t.text);
    const fixed = rewritten ? tidyCaption(rewritten) : null;
    if (fixed && !captionProblems(fixed, { format: concept.format, pillar: concept.pillar, picture: concept.typography }).length) {
      caption = fixed;
      rev = await review(maker, r, concept, caption, image, refUrls);
      verdict = reviewVerdict(rev, concept.typography, concept.visual, concept.pillar);
    }
  }
  // one side of a one-side remake is the day's own, so only the other side is judged
  const imageIssues = c.keepPicture ? (rev.scores.match < REVIEW_BARS.match ? [`match ${rev.scores.match}/5`] : []) : verdict.image;
  const captionIssues = c.keepCaption ? [] : verdict.caption;
  return { entry, provider, rev, verdict, caption, imageIssues, captionIssues, madeHere };
}

/** The image model's own safety filter turned the picture down (a scene, not a fault: another scene can pass). */
export const isSafetyRefusal = (e: unknown) => /safety system|moderation|content policy|safety_violations/i.test(String((e as Error)?.message ?? e));

async function pictureStep(admin: Admin, r: DailyRow, maker: Maker, c: Candidate): Promise<string> {
  const concept = c.concept!;
  let drawn: Awaited<ReturnType<typeof drawAndReview>>;
  try {
    drawn = await drawAndReview(admin, r, maker, c);
  } catch (e) {
    if (!isSafetyRefusal(e)) throw e;
    // the same scene would be refused again: plan a new one (the caption stays when it's the day's own)
    const next: Candidate = { ...c, round: c.round + 1, pictures: 0, fix: null, concept: undefined, caption: undefined, issues: ["the image model's safety filter turned the scene down"] };
    if (next.round > MAX_ROUNDS) return giveUp(admin, { ...r, candidate: next }, "the image model's safety filter turned down every scene");
    await saveCandidate(admin, r, next);
    return "the image model turned the scene down, planning a new one";
  }
  const { entry, provider, rev, verdict, caption, imageIssues, captionIssues, madeHere } = drawn;

  if (!imageIssues.length && !captionIssues.length) {
    await applyMade(admin, r, concept, caption, entry, provider, rev, c, { passed: true });
    if (c.best && c.best.entry.path !== entry.path) await removeFile(admin, c.best.entry.path);
    return `made (${concept.style}, score ${reviewScore(rev)})`;
  }

  // keep a new day's best try (nothing wrong with the picture itself: its words and no defects)
  const hard = verdict.image.some((i) => /words|defect|finger|warp|garbled|misspel|watermark|artefact|artifact|reads as/i.test(i)) || rev.defects.length > 0;
  let best = c.best ?? null;
  if (madeHere && !hasLive(r) && !hard && (!best || reviewScore(rev) > best.score)) {
    if (best) await removeFile(admin, best.entry.path);
    best = { entry, provider, caption, concept, review: rev, score: reviewScore(rev) };
  } else if (madeHere) await removeFile(admin, entry.path);

  const next: Candidate = { ...c, best, issues: [...imageIssues, ...captionIssues].slice(0, 8) };
  if (imageIssues.length && !c.keepPicture) {
    next.pictures = c.pictures + 1;
    next.fix = imageIssues.join("; ").slice(0, 600);
  }
  // the picture's had its tries, or the words are the problem: a new concept
  if (next.pictures >= PICTURES_PER_CONCEPT || captionIssues.length || c.keepPicture) {
    next.round = c.round + 1;
    next.pictures = 0;
    next.fix = null;
    next.concept = undefined;
    next.caption = undefined;
  }
  if (next.round > MAX_ROUNDS) {
    const why = `didn't pass the review after ${MAX_ROUNDS} tries (${next.issues?.join("; ")})`;
    return giveUp(admin, { ...r, candidate: next }, why);
  }
  await saveCandidate(admin, r, next);
  return `didn't pass (${next.issues?.join("; ")}), trying again`;
}

/* ------------------------------------------------------------------ */
/*  A run                                                              */
/* ------------------------------------------------------------------ */

async function step(admin: Admin, r: DailyRow, maker: Maker, learned: DailyLearnings): Promise<string> {
  const c: Candidate = r.candidate ?? { round: 1, pictures: 0 };
  if (!c.caption || !c.concept) return conceptStep(admin, r, maker, learned, c);
  return pictureStep(admin, r, maker, c);
}

async function queued(admin: Admin, today: string, now: number): Promise<DailyRow[]> {
  const { data } = await admin
    .from("community_daily_visuals")
    .select(COLS)
    .not("regen", "is", null)
    .neq("status", "skipped")
    .gte("day", addDays(today, -BACK_DAYS))
    .lte("day", addDays(today, AHEAD_DAYS));
  return workOrder((data ?? []) as DailyRow[], today).filter((r) => isDue(r, now));
}

/** One run: plan, learn, then one step (two while the run is young), then wake the next run if there's more. */
export async function runDailyVisualsTick(admin: Admin, now = Date.now()): Promise<Record<string, unknown>> {
  const started = Date.now();
  await admin.rpc("community_daily_visuals_plan", { _from: null, _days: 7 });
  const today = localDay(new Date(now));
  const { data: settings } = await admin.from("community_series_settings").select("daily_visuals_lovable").maybeSingle();
  const maker = makerFor(!!settings?.daily_visuals_lovable);
  const out: Record<string, unknown> = { today, openai: !!process.env.OPENAI_API_KEY, lovable: !!settings?.daily_visuals_lovable };
  const seeded = await seedStyleRefs(admin).catch((e) => [`not placed: ${String(e?.message ?? e)}`]);
  if (seeded.length) out.references = seeded;

  const { data: stats, error: statsError } = await admin.rpc("community_daily_visual_stats", { _days: 120 });
  if (statsError) throw new Error(`Couldn't read how the pictures did: ${statsError.message}`);
  const learned = learnDailyVisuals(Array.isArray(stats) ? (stats as VisualStat[]) : []);
  await saveSetting(admin, LEARNED_KEY, { text: learningsText(learned), posts: learned.posts, at: new Date(now).toISOString() });

  if ("blocked" in maker) {
    await saveSetting(admin, STATUS_KEY, { at: new Date().toISOString(), ok: false, blocked: maker.blocked });
    return { ...out, blocked: maker.blocked };
  }
  out.provider = maker.provider;

  const did: string[] = [];
  for (let i = 0; i < 2 && (i === 0 || Date.now() - started < SECOND_STEP_BEFORE_MS); i++) {
    const row = (await queued(admin, today, now + (Date.now() - started)))[0];
    if (!row) break;
    const r = await claim(admin, row);
    if (!r) continue;
    try {
      did.push(`${r.day}: ${await step(admin, r, maker, learned)}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      did.push(`${r.day}: ${msg} (${await fail(admin, r, msg)})`);
      break;
    }
  }
  out.did = did;
  if (!did.length) out.skipped = "nothing waiting";
  await saveSetting(admin, STATUS_KEY, { at: new Date().toISOString(), ok: true, provider: maker.provider, did });
  // more waiting: the next run starts now (each step is its own run)
  if (did.length) await admin.rpc("community_daily_visuals_kick", { _force: false });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Test pictures: the whole pipeline, never a day or a post           */
/* ------------------------------------------------------------------ */

export type TestSpec = {
  audience: DailyAudience;
  theme: DailyTheme;
  /** The day it's for (its weekday mood, its crowd, the days around it), today if not given. */
  day?: string | null;
  style?: DailyStyle | null;
  pillar?: DailyPillar | null;
  topic?: DailyTopic | null;
  format?: DailyFormat | null;
  art?: DailyArt | null;
  crowd?: DailyCrowd | null;
  /** Just the writer and the editor: no picture, nothing saved (the result is the answer). */
  captionOnly?: boolean;
};
const NO_DAY = "00000000-0000-0000-0000-000000000000";

/**
 * A test post (the hook's `{ test: { audience, theme, style? } }`): a concept,
 * a caption, a picture (a second with the review's fix if the first fails)
 * and its review, saved in community_daily_visual_tests for the coach's card.
 * Nothing goes on a day or in the feed.
 */
export async function runDailyVisualTest(admin: Admin, spec: TestSpec): Promise<Record<string, unknown>> {
  const { data: settings } = await admin.from("community_series_settings").select("daily_visuals_lovable").maybeSingle();
  const maker = makerFor(!!settings?.daily_visuals_lovable);
  if ("blocked" in maker) return { blocked: maker.blocked };
  await seedStyleRefs(admin);
  const { data: stats } = await admin.rpc("community_daily_visual_stats", { _days: 120 });
  const learned = learnDailyVisuals(Array.isArray(stats) ? (stats as VisualStat[]) : []);
  const r: DailyRow = {
    id: NO_DAY,
    day: spec.day && /^\d{4}-\d{2}-\d{2}$/.test(spec.day) ? spec.day : localDay(),
    theme: spec.theme,
    audience: spec.audience,
    faith: false,
    style: null,
    format: null,
    topic: null,
    ai_line: null,
    coach_line: null,
    shot: null,
    concept: null,
    verse_ref: null,
    verse_text: null,
    picture: null,
    picture_provider: null,
    status: "planned",
    attempts: 0,
    updated_at: new Date().toISOString(),
    regen: "full",
    regen_style: spec.style && (DAILY_STYLE_KEYS as string[]).includes(spec.style) ? spec.style : null,
    regen_reason: "test",
    candidate: null,
    post_id: null,
  };
  const pick = <K extends string>(keys: readonly K[], v: unknown) => ((keys as readonly string[]).includes(v as string) ? (v as K) : null);
  let c = await planConcept(admin, r, maker, learned, { round: 1, pictures: 0 }, {
    pillar: pick(DAILY_PILLAR_KEYS, spec.pillar),
    topic: pick(DAILY_TOPIC_KEYS, spec.topic),
    format: pick(DAILY_FORMAT_KEYS, spec.format),
    art: pick(DAILY_ART_KEYS, spec.art),
    crowd: pick(["everyone", "beginners", "lifestyle", "lifters"] as const, spec.crowd),
  });
  if (spec.captionOnly) {
    const k = c.concept!;
    return {
      day: r.day,
      audience: spec.audience,
      pillar: k.pillar,
      topic: k.topic,
      crowd: k.crowd,
      mood: k.mood,
      format: k.format,
      situation: k.situation,
      idea: k.message,
      visual: k.visual,
      typography: k.typography,
      drafts: k.drafts,
      caption: c.caption,
      editor: c.editor,
      model: c.model,
    };
  }
  const tries: Record<string, unknown>[] = [];
  let d: Drawn | null = null;
  for (let i = 0; i < 2; i++) {
    d = await drawAndReview(admin, r, maker, c, `daily-test-${spec.audience}`);
    tries.push({ medium: d.rev.medium, description: d.rev.description, score: reviewScore(d.rev), issues: [...d.imageIssues, ...d.captionIssues] });
    if (!d.imageIssues.length || i === 1) break;
    await removeFile(admin, d.entry.path);
    c = { ...c, fix: d.imageIssues.join("; ").slice(0, 600) };
  }
  const concept = c.concept!;
  const test = {
    audience: spec.audience,
    theme: spec.theme,
    style: concept.style,
    light: concept.light,
    art: concept.art,
    look: FILM_LOOK_VERSION,
    format: concept.format,
    topic: concept.topic,
    pillar: concept.pillar,
    crowd: concept.crowd,
    mood: concept.mood,
    editor: c.editor ?? null,
    message: concept.message,
    visual: concept.visual,
    typography: concept.typography,
    caption: d!.caption,
    picture: d!.entry.path,
    provider: d!.provider,
    passed: !d!.imageIssues.length && !d!.captionIssues.length,
    score: reviewScore(d!.rev),
    medium: d!.rev.medium,
    colour: d!.rev.colour,
    clarity: d!.rev.clarity,
    reference: d!.provider.endsWith("+ref"),
    description: d!.rev.description,
    text_seen: d!.rev.text_seen,
    issues: [...d!.imageIssues, ...d!.captionIssues],
    tries,
  };
  const { error } = await admin.from("community_daily_visual_tests").insert({ data: test });
  if (error) throw new Error(`Couldn't save the test: ${error.message}`);
  return test;
}

/** The post's ⋯ New picture on a daily picture: the day's picture is remade in the background, the words kept. */
export async function repictureDailyPost(
  admin: Admin,
  postId: string,
): Promise<{ ok: true; path: string; provider: string; queued: true } | { ok: false; reason: string }> {
  const { data: row } = await admin.from("community_daily_visuals").select("id, picture, status").eq("post_id", postId).maybeSingle();
  if (!row) return { ok: false, reason: "This day isn't in the daily pictures any more." };
  const { error } = await admin
    .from("community_daily_visuals")
    .update({ regen: "picture", regen_style: null, regen_reason: "coach", candidate: null, attempts: 0, error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { ok: false, reason: error.message };
  await admin.rpc("community_daily_visuals_kick", { _force: true });
  return { ok: true, path: row.picture?.path ?? "", provider: "queued", queued: true };
}

export type { DailyFormat, DailyTopic };
