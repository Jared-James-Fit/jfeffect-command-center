/**
 * The daily pictures' background writer (daily-visuals-tick hook, woken by
 * pg_cron when a day from 3 back to 2 ahead is missing its words or picture;
 * see 20270124090000_daily_pictures.sql). Each run does at most one line and
 * one picture, so it never outlives the hook:
 *
 * 1. Learn: how every posted daily picture did (community_daily_visual_stats)
 *    → learnDailyVisuals → the look and length for the next one, and the
 *    lines that worked or didn't, for the writer.
 * 2. Words: the AI writes one line in the coach's voice and the picture's
 *    scene; the line must pass dailyLineProblems (plainCheck, his never-say
 *    list, no hashtags / quotes / verses), with one retry told what to fix.
 *    Sunday's verse is the least recently used of FAITH_VERSES.
 * 3. Picture: the image model (generatePicture) from dailyPicturePrompt.
 *
 * A row is claimed with a conditional update (its updated_at), so two runs
 * never work on the same day; a failure is kept on the row and retried after
 * 30 minutes, 4 tries at most.
 */
import {
  DAILY_THEMES,
  DAILY_WRITER_PROMPT,
  dailyLineProblems,
  dailyPicturePrompt,
  dailyWriterPrompt,
  learnDailyVisuals,
  learningsText,
  nextChoices,
  parseDailyWriter,
  pickVerse,
  repeatsNearby,
  type DailyAudience,
  type DailyStyle,
  type DailyTheme,
  type VisualStat,
} from "@/lib/daily-visuals";
import { generatePicture, storePicture } from "@/lib/post-pictures.server";

type Admin = any;

export type DailyRow = {
  id: string;
  day: string;
  theme: DailyTheme;
  audience: DailyAudience;
  faith: boolean;
  style: DailyStyle | null;
  max_chars: number | null;
  ai_line: string | null;
  coach_line: string | null;
  shot: string | null;
  verse_ref: string | null;
  picture: { path?: string } | null;
  status: string;
  attempts: number;
  updated_at: string;
};

const COLS =
  "id, day, theme, audience, faith, style, max_chars, ai_line, coach_line, shot, verse_ref, picture, status, attempts, updated_at";
const MAX_ATTEMPTS = 4;
const RETRY_AFTER_MS = 30 * 60 * 1000;
const LEARNED_KEY = "daily_visuals_learned";
/** Below this the picture is too soft for a phone's 4:5 feed. */
const MIN_SIDE = 768;

const tz = "America/Winnipeg";
export function localDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Today and the days ahead first (soonest first), then the days just missed (latest first). */
export function workOrder(rows: DailyRow[], today: string): DailyRow[] {
  const ahead = rows.filter((r) => r.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const missed = rows.filter((r) => r.day < today).sort((a, b) => b.day.localeCompare(a.day));
  return [...ahead, ...missed];
}

const due = (r: DailyRow, now: number) =>
  r.attempts < MAX_ATTEMPTS &&
  (r.attempts === 0 || now - Date.parse(r.updated_at) > RETRY_AFTER_MS);
const needsWords = (r: DailyRow) => !r.shot || (!r.ai_line && !r.coach_line);
const needsPicture = (r: DailyRow) => !!r.shot && !r.picture?.path;

/** Takes a row for this run (nobody else touched it since it was read), counting the try. */
async function claim(admin: Admin, r: DailyRow): Promise<DailyRow | null> {
  const { data } = await admin
    .from("community_daily_visuals")
    .update({ attempts: r.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", r.id)
    .eq("updated_at", r.updated_at)
    .eq("status", "planned")
    .select(COLS)
    .maybeSingle();
  return (data as DailyRow) ?? null;
}

async function fail(admin: Admin, r: DailyRow, error: string) {
  await admin
    .from("community_daily_visuals")
    .update({
      error: error.slice(0, 500),
      status: r.attempts >= MAX_ATTEMPTS ? "failed" : "planned",
      updated_at: new Date().toISOString(),
    })
    .eq("id", r.id);
}

async function loadStats(admin: Admin): Promise<VisualStat[]> {
  const { data, error } = await admin.rpc("community_daily_visual_stats", { _days: 120 });
  if (error) throw new Error(`Couldn't read how the pictures did: ${error.message}`);
  return Array.isArray(data) ? (data as VisualStat[]) : [];
}

/** The words and the scene for a day. */
export async function writeDay(admin: Admin, row: DailyRow, stats: VisualStat[]): Promise<void> {
  const learned = learnDailyVisuals(stats);
  const choice =
    row.style && row.max_chars
      ? { style: row.style, maxChars: row.max_chars, why: null }
      : nextChoices(learned);
  const { data: recent } = await admin
    .from("community_daily_visuals")
    .select("day, ai_line, coach_line, shot, verse_ref")
    .neq("id", row.id)
    .gte("day", addDays(row.day, -28))
    .order("day", { ascending: true });
  const past = (recent ?? []) as {
    day: string;
    ai_line: string | null;
    coach_line: string | null;
    shot: string | null;
    verse_ref: string | null;
  }[];

  const { loadCoachVoice } = await import("@/lib/coach-voice.functions");
  const { buildVoicePrompt, casualize } = await import("@/lib/coach-voice");
  const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
  const { generateText } = await import("ai");
  const [profile, { data: g }] = await Promise.all([
    loadCoachVoice(admin),
    admin.from("global_ai_config").select("default_model").limit(1).maybeSingle(),
  ]);
  const modelId = g?.default_model || DEFAULT_AI_MODEL;
  const voice = buildVoicePrompt(profile, null, { group: true });
  const lines = (r: (typeof past)[number]) => (r.coach_line || r.ai_line || "").trim();

  const prompt = dailyWriterPrompt({
    theme: row.theme,
    audience: row.audience,
    style: choice.style,
    maxChars: choice.maxChars,
    faith: row.faith,
    learnings: learningsText(learned),
    best: learned.best.map((s) => s.line).filter(Boolean),
    worst: learned.worst.map((s) => s.line).filter(Boolean),
    recentLines: past.map(lines).filter(Boolean).slice(-14),
    recentShots: past
      .map((r) => r.shot ?? "")
      .filter(Boolean)
      .slice(-10),
  });

  // the days around it (either side), so a week never reads like one template
  const near = past.filter((r) => Math.abs(Date.parse(r.day) - Date.parse(row.day)) <= 3 * 86_400_000).map(lines).filter(Boolean);
  let written: { line: string; picture: string } | null = null;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 3 && !written; attempt++) {
    const t = await generateText({
      model: createLovableAiGateway()(modelId),
      system: `${DAILY_WRITER_PROMPT}\n\n${voice}`,
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\nYOUR LAST LINE DIDN'T WORK: ${problems.join("; ")}. Write a new one that fixes it.`,
    });
    const parsed = parseDailyWriter(t.text);
    if (!parsed) {
      problems = ["the answer wasn't the JSON asked for"];
      continue;
    }
    const line = casualize(parsed.line);
    const repeat = repeatsNearby(line, near);
    problems = [...dailyLineProblems(line, choice.maxChars), ...(repeat ? [repeat] : [])];
    if (!problems.length) written = { line, picture: parsed.picture };
  }
  if (!written) throw new Error(`The line didn't pass: ${problems.join("; ")}`);

  const verse = row.faith ? pickVerse(past.map((r) => r.verse_ref ?? "").filter(Boolean)) : null;
  const shot = row.shot ?? written.picture.slice(0, 1500);
  const { error } = await admin
    .from("community_daily_visuals")
    .update({
      ai_line: row.coach_line ? (row.ai_line ?? written.line) : written.line,
      shot,
      style: choice.style,
      max_chars: choice.maxChars,
      verse_ref: verse?.ref ?? null,
      verse_text: verse?.text ?? null,
      model: modelId,
      learned: { posts: learned.posts, text: learningsText(learned), why: choice.why },
      status: row.picture?.path ? "ready" : "planned",
      // a try that worked starts the count again: attempts are failures in a row
      attempts: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
}

/** The day's picture, saved under the account the coach posts as. */
export async function pictureDay(admin: Admin, row: DailyRow): Promise<{ provider: string }> {
  if (!row.shot) throw new Error("No scene written yet");
  const made = await generatePicture(
    dailyPicturePrompt({
      theme: row.theme,
      audience: row.audience,
      style: row.style ?? "photo",
      shot: row.shot,
      faith: row.faith,
    }),
  );
  if (!made.ok) throw new Error(made.reason);
  if (Math.min(made.picture.width, made.picture.height) < MIN_SIDE)
    throw new Error(
      `The picture came back too small (${made.picture.width}×${made.picture.height})`,
    );
  const { data: settings } = await admin
    .from("community_series_settings")
    .select("author_user_id")
    .maybeSingle();
  if (!settings?.author_user_id) throw new Error("No account to post as yet");
  const entry = await storePicture(
    admin,
    settings.author_user_id,
    `daily-${row.day}`,
    made.picture,
  );
  const { data: fresh } = await admin
    .from("community_daily_visuals")
    .select("ai_line, coach_line, picture")
    .eq("id", row.id)
    .maybeSingle();
  const { error } = await admin
    .from("community_daily_visuals")
    .update({
      picture: entry,
      picture_provider: made.picture.provider,
      status: fresh?.ai_line || fresh?.coach_line ? "ready" : "planned",
      attempts: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  const old = fresh?.picture?.path;
  if (typeof old === "string" && old.includes("/post-pictures/") && old !== entry.path)
    await admin.storage.from("community-media").remove([old]);
  return { provider: made.picture.provider };
}

/** A new picture on a daily picture that's already out (the post's ⋯ New picture), from the day's own scene. */
export async function repictureDailyPost(
  admin: Admin,
  postId: string,
): Promise<{ ok: true; path: string; provider: string } | { ok: false; reason: string }> {
  const { data: row } = await admin
    .from("community_daily_visuals")
    .select(COLS)
    .eq("post_id", postId)
    .maybeSingle();
  if (!row?.shot)
    return { ok: false, reason: "This day's scene isn't saved, so it can't be made again." };
  const made = await generatePicture(
    dailyPicturePrompt({ ...(row as DailyRow), style: row.style ?? "photo", shot: row.shot }),
  );
  if (!made.ok) return made;
  const { data: post } = await admin
    .from("community_posts")
    .select("author_user_id, media_path")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { ok: false, reason: "Post not found" };
  const entry = await storePicture(admin, post.author_user_id, `daily-${row.day}`, made.picture);
  const { error } = await admin.rpc("community_apply_media", { _post_id: postId, _media: [entry] });
  if (error) return { ok: false, reason: error.message };
  await admin
    .from("community_daily_visuals")
    .update({
      picture: entry,
      picture_provider: made.picture.provider,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (typeof post.media_path === "string" && post.media_path.includes("/post-pictures/"))
    await admin.storage.from("community-media").remove([post.media_path]);
  return { ok: true, path: entry.path, provider: made.picture.provider };
}

/** One run: plan, learn, then at most one day's words and one day's picture. */
export async function runDailyVisualsTick(
  admin: Admin,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  await admin.rpc("community_daily_visuals_plan", { _from: null, _days: 7 });
  const today = localDay(new Date(now));
  const { data } = await admin
    .from("community_daily_visuals")
    .select(COLS)
    .gte("day", addDays(today, -3))
    .lte("day", addDays(today, 2))
    .eq("status", "planned");
  const rows = workOrder((data ?? []) as DailyRow[], today).filter((r) => due(r, now));
  const out: Record<string, unknown> = { today };

  const stats = await loadStats(admin);
  const learned = learnDailyVisuals(stats);
  const value = JSON.stringify({
    text: learningsText(learned),
    posts: learned.posts,
    at: new Date(now).toISOString(),
  });
  const { data: saved } = await admin
    .from("app_settings")
    .update({ value, updated_at: new Date(now).toISOString() })
    .eq("key", LEARNED_KEY)
    .select("id");
  if (!saved?.length) await admin.from("app_settings").insert({ key: LEARNED_KEY, value });

  const wordsFor = rows.find(needsWords);
  if (wordsFor) {
    const r = await claim(admin, wordsFor);
    if (r) {
      try {
        await writeDay(admin, r, stats);
        out.words = r.day;
      } catch (e: any) {
        await fail(admin, r, `Words: ${String(e?.message ?? e)}`);
        out.wordsError = String(e?.message ?? e);
      }
    }
  }

  // re-read: the day just written may now be the one needing its picture
  const { data: again } = await admin
    .from("community_daily_visuals")
    .select(COLS)
    .gte("day", addDays(today, -3))
    .lte("day", addDays(today, 2))
    .eq("status", "planned");
  const pictureFor = workOrder((again ?? []) as DailyRow[], today).find(
    (r) => needsPicture(r) && (r.day === out.words || due(r, now)),
  );
  if (pictureFor) {
    const r = await claim(admin, pictureFor);
    if (r) {
      try {
        const { provider } = await pictureDay(admin, r);
        out.picture = r.day;
        out.provider = provider;
      } catch (e: any) {
        await fail(admin, r, `Picture: ${String(e?.message ?? e)}`);
        out.pictureError = String(e?.message ?? e);
      }
    }
  }
  if (!wordsFor && !pictureFor) out.skipped = "nothing waiting";
  return out;
}

export { DAILY_THEMES };
