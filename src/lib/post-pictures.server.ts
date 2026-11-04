/**
 * Pictures for automated posts from an image model (server only).
 *
 * Only Saturday's scene gets a made photo by itself (picturedByItself): it's
 * made as soon as Saturday's next library post is up next (it rides along as
 * the item's photo, so the coach sees it in Crew → Posts ahead of time and
 * can ask for another), and for a Saturday post that went out without one.
 * Every other automated post leads with its own diagram, chart or type card;
 * the coach can still ask for a photo on any of them (New picture, any
 * automated post's ⋯). Runs from the post-pictures-tick hook (pg_cron) and
 * makePostPicture.
 *
 * Model: OpenAI's image model (ChatGPT's) when OPENAI_API_KEY is set, else
 * Google's image model through the Lovable AI gateway the app already uses.
 */
import {
  AUTO_PICTURE_KINDS,
  imageSize,
  pictureKind,
  picturedByItself,
  postPicturePrompt,
  type PictureKind,
} from "@/lib/post-pictures";
import { isSpiritScene } from "@/components/community/spirit-scenes";

type Admin = any;
export type Picture = {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  provider: string;
};
type Made = { ok: true; picture: Picture } | { ok: false; reason: string };
export type PictureResult =
  { ok: true; path: string; provider: string } | { ok: false; reason: string };

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image-preview",
];
const BUCKET = "community-media";
const STATUS_KEY = "post_pictures_status";
/** After a failed try the tick waits this long before spending another call. */
const BACKOFF_MS = 2 * 60 * 60 * 1000;
/** Posts out this recently without a photo come first (they're at the top of the feed). */
const RECENT_MS = 36 * 60 * 60 * 1000;
/** Older posts are caught up too, back this far. */
const CATCH_UP_MS = 21 * 24 * 60 * 60 * 1000;
/** The days with a library of posts, each with its picture made ahead. */
const LIBRARY_DAYS = [
  "monday_motivation",
  "tuesday_tips",
  "try_it_thursday",
  "finish_strong_friday",
  "saturday_spirit",
] as const;
const DAY_OF: Record<(typeof LIBRARY_DAYS)[number], number> = {
  monday_motivation: 1,
  tuesday_tips: 2,
  try_it_thursday: 4,
  finish_strong_friday: 5,
  saturday_spirit: 6,
};

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function picture(bytes: Uint8Array, provider: string): Made {
  const size = imageSize(bytes);
  if (!size || size.width < 256 || size.height < 256)
    return { ok: false, reason: `${provider} sent something that isn't a picture` };
  return { ok: true, picture: { bytes, ...size, provider } };
}

async function viaOpenAI(key: string, prompt: string): Promise<Made> {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1536",
      quality: "high",
      output_format: "jpeg",
      output_compression: 88,
      n: 1,
    }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) {
    let msg = `OpenAI said no (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = `OpenAI: ${String(j.error.message).slice(0, 160)}`;
    } catch {
      // keep the status
    }
    return { ok: false, reason: msg };
  }
  const b64: string | undefined = (await res.json())?.data?.[0]?.b64_json;
  return b64
    ? picture(fromBase64(b64), `openai:${model}`)
    : { ok: false, reason: "OpenAI didn't send a picture back" };
}

/** The picture in a chat reply: `message.images[]`, or an image part / data URL in `content`. */
export function gatewayImage(json: any): string | null {
  const msg = json?.choices?.[0]?.message;
  const urls: unknown[] = [
    ...(Array.isArray(msg?.images) ? msg.images.map((i: any) => i?.image_url?.url ?? i?.url) : []),
    ...(Array.isArray(msg?.content)
      ? msg.content.map((p: any) => p?.image_url?.url ?? p?.url)
      : []),
    typeof msg?.content === "string" ? msg.content : null,
  ];
  for (const u of urls) {
    const m = typeof u === "string" ? /data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)/.exec(u) : null;
    if (m) return m[1];
  }
  return null;
}

async function viaGateway(key: string, prompt: string): Promise<Made> {
  const models = process.env.POST_PICTURE_MODEL ? [process.env.POST_PICTURE_MODEL] : GATEWAY_MODELS;
  let last = "The image model didn't answer";
  for (const model of models) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: `Generate an image. ${prompt}` }],
        modalities: ["image", "text"],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!res.ok) {
      last = `${model} said no (${res.status})`;
      try {
        const j = await res.json();
        const m = j?.error?.message ?? j?.message;
        if (m) last = `${model}: ${String(m).slice(0, 160)}`;
      } catch {
        // keep the status
      }
      // only a model the gateway doesn't take is worth trying the next one; auth, credit and outages aren't
      if (res.status === 400 || res.status === 404) continue;
      return { ok: false, reason: last };
    }
    const b64 = gatewayImage(await res.json());
    if (b64) return picture(fromBase64(b64), `lovable:${model}`);
    last = `${model} answered without a picture`;
  }
  return { ok: false, reason: last };
}

/** One picture from the best image model the app has a key for. */
export async function generatePicture(prompt: string): Promise<Made> {
  const openai = process.env.OPENAI_API_KEY;
  const lovable = process.env.LOVABLE_API_KEY;
  if (!openai && !lovable)
    return { ok: false, reason: "No image model is set up (OPENAI_API_KEY or LOVABLE_API_KEY)." };
  let first: Made | null = null;
  if (openai) {
    try {
      first = await viaOpenAI(openai, prompt);
      if (first.ok) return first;
    } catch (e: any) {
      first = { ok: false, reason: `OpenAI: ${String(e?.message ?? e).slice(0, 120)}` };
    }
  }
  if (lovable) {
    try {
      return await viaGateway(lovable, prompt);
    } catch (e: any) {
      return { ok: false, reason: `Image model: ${String(e?.message ?? e).slice(0, 120)}` };
    }
  }
  return first ?? { ok: false, reason: "No picture" };
}

/** Saves a picture to the post photos bucket under its owner (so it edits like any photo of theirs). */
export async function storePicture(admin: Admin, ownerId: string, name: string, pic: Picture) {
  const ext = pic.mime === "image/jpeg" ? "jpg" : pic.mime === "image/webp" ? "webp" : "png";
  const path = `${ownerId}/post-pictures/${name}-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, pic.bytes, { contentType: pic.mime, upsert: false });
  if (error) throw new Error(`Couldn't save the picture: ${error.message}`);
  return { path, type: "image", width: pic.width, height: pic.height };
}

/** A picture this module made earlier, which a new one replaces (anything the coach uploaded stays). */
const madeHere = (path: unknown): path is string =>
  typeof path === "string" && path.includes("/post-pictures/");

async function removeOld(admin: Admin, paths: unknown[]) {
  const mine = paths.filter(madeHere);
  if (mine.length) await admin.storage.from(BUCKET).remove(mine);
}

/** The prompt for a post or library item: its kind's shot and its own words. */
function promptFor(kind: PictureKind, caption: string | null, data: any): string {
  const scene = isSpiritScene(data?.scene) ? data.scene : null;
  const title = typeof data?.lesson?.title === "string" ? data.lesson.title : null;
  return postPicturePrompt(kind, caption, { scene, title });
}

/** A new photo on an automated post (replacing one made here; never one the coach put on). */
export async function pictureForPost(admin: Admin, postId: string): Promise<PictureResult> {
  const { data: post } = await admin
    .from("community_posts")
    .select(
      "id, kind, series, series_data, caption, author_user_id, media_path, extra_media, story_only",
    )
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { ok: false, reason: "Post not found" };
  const kind = post.kind === "note" && !post.story_only ? pictureKind(post) : null;
  if (!kind) return { ok: false, reason: "Only the app's own posts get a made picture." };
  if (post.media_path && !madeHere(post.media_path))
    return {
      ok: false,
      reason: "This post has your own photo on it. Remove it first to get a made picture.",
    };
  // a daily picture is made again from its own day's scene and look
  if (kind === "daily_visual") {
    const { repictureDailyPost } = await import("@/lib/daily-visuals.server");
    return repictureDailyPost(admin, post.id);
  }
  const made = await generatePicture(promptFor(kind, post.caption, post.series_data));
  if (!made.ok) return made;
  const entry = await storePicture(admin, post.author_user_id, `post-${post.id}`, made.picture);
  // the made photo is the cover; anything else already on the post stays after it
  const rest = (Array.isArray(post.extra_media) ? post.extra_media : []) as unknown[];
  const { error } = await admin.rpc("community_apply_media", {
    _post_id: post.id,
    _media: [entry, ...(post.media_path ? rest : [])],
  });
  if (error) return { ok: false, reason: error.message };
  await removeOld(admin, [post.media_path]);
  return { ok: true, path: entry.path, provider: made.picture.provider };
}

/** A new photo on a day's next library post: it goes out with it (once), like a photo the coach added. */
export async function pictureForItem(admin: Admin, itemId: string): Promise<PictureResult> {
  const { data: item } = await admin
    .from("community_series_items")
    .select("id, series, data, body, media")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok: false, reason: "That post isn't in the library." };
  const kind = pictureKind({ series: item.series });
  if (!kind) return { ok: false, reason: "This kind of post doesn't get a made picture." };
  const media = (Array.isArray(item.media) ? item.media : []) as { path?: string }[];
  if (media.some((m) => !madeHere(m?.path)))
    return {
      ok: false,
      reason: "This post has your own photo on it. Remove it first to get a made picture.",
    };
  const { data: settings } = await admin
    .from("community_series_settings")
    .select("author_user_id")
    .maybeSingle();
  if (!settings?.author_user_id) return { ok: false, reason: "No account to post as yet." };
  const made = await generatePicture(promptFor(kind, item.body, item.data));
  if (!made.ok) return made;
  const entry = await storePicture(admin, settings.author_user_id, `item-${item.id}`, made.picture);
  const { error } = await admin
    .from("community_series_items")
    .update({ media: [entry] })
    .eq("id", item.id);
  if (error) return { ok: false, reason: error.message };
  await removeOld(
    admin,
    media.map((m) => m?.path),
  );
  return { ok: true, path: entry.path, provider: made.picture.provider };
}

type TickStatus = { at: string; ok: boolean; what?: string; reason?: string; provider?: string };

async function readStatus(admin: Admin): Promise<TickStatus | null> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", STATUS_KEY)
    .maybeSingle();
  try {
    return data?.value ? (JSON.parse(data.value) as TickStatus) : null;
  } catch {
    return null;
  }
}

async function writeStatus(admin: Admin, status: TickStatus) {
  const value = JSON.stringify(status);
  const { data } = await admin
    .from("app_settings")
    .update({ value, updated_at: status.at })
    .eq("key", STATUS_KEY)
    .select("id");
  if (!data?.length) await admin.from("app_settings").insert({ key: STATUS_KEY, value });
}

/** The app's own posts out since `since` with no photo yet, newest first. */
async function postsWithoutPicture(
  admin: Admin,
  since: string,
  limit: number,
): Promise<{ id: string }[]> {
  const { data } = await admin
    .from("community_posts")
    .select("id, kind, series, series_data, story_only")
    .eq("kind", "note")
    .is("media_path", null)
    .is("archived_at", null)
    .gte("created_at", since)
    // only the kinds that get a picture by themselves (Saturday's scene), asked for in the query so a newer lesson can't hide one
    .in("series", [...AUTO_PICTURE_KINDS])
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).filter((p: any) => !p.story_only && picturedByItself(pictureKind(p)));
}

/** The library days that are on, the soonest first (today counts if it hasn't gone out). */
export function libraryDaysInOrder(
  on: string[],
  todayIsoDow: number,
): (typeof LIBRARY_DAYS)[number][] {
  const ahead = (d: (typeof LIBRARY_DAYS)[number]) => (DAY_OF[d] - todayIsoDow + 7) % 7;
  return LIBRARY_DAYS.filter((d) => on.includes(d)).sort((a, b) => ahead(a) - ahead(b));
}

/**
 * One picture per run, most visible first, for the kinds that get one by
 * themselves (Saturday's scene): such a post out in the last day and a half
 * without a photo; else its day's next library post (while it's on and
 * posting isn't paused); else an older one from the last three weeks. A
 * failure waits BACKOFF_MS.
 */
export async function runPostPicturesTick(admin: Admin): Promise<Record<string, unknown>> {
  const last = await readStatus(admin);
  if (last && !last.ok && Date.now() - Date.parse(last.at) < BACKOFF_MS)
    return { skipped: "waiting after a failed try", last };

  let what: string | null = null;
  let result: PictureResult | null = null;
  const [recent] = await postsWithoutPicture(
    admin,
    new Date(Date.now() - RECENT_MS).toISOString(),
    1,
  );
  if (recent) {
    what = `post ${recent.id}`;
    result = await pictureForPost(admin, recent.id);
  } else {
    const { data: settings } = await admin
      .from("community_series_settings")
      .select("paused, series_on")
      .maybeSingle();
    if (settings && !settings.paused) {
      const on = (settings.series_on ?? []).filter((s: string) =>
        picturedByItself(pictureKind({ series: s })),
      );
      for (const series of libraryDaysInOrder(on, isoDowIn("America/Winnipeg"))) {
        const { data: next } = await admin.rpc("community_series_next", { _series: series });
        const item = Array.isArray(next) ? next[0] : next;
        if (!item?.id || (Array.isArray(item.media) && item.media.length)) continue;
        what = `item ${item.id}`;
        result = await pictureForItem(admin, item.id);
        break;
      }
    }
    if (!result) {
      const [older] = await postsWithoutPicture(
        admin,
        new Date(Date.now() - CATCH_UP_MS).toISOString(),
        1,
      );
      if (!older) return { skipped: "every post has its picture" };
      what = `post ${older.id}`;
      result = await pictureForPost(admin, older.id);
    }
  }
  const status: TickStatus = result.ok
    ? { at: new Date().toISOString(), ok: true, what: what ?? undefined, provider: result.provider }
    : { at: new Date().toISOString(), ok: false, what: what ?? undefined, reason: result.reason };
  await writeStatus(admin, status);
  return status;
}

/** Monday = 1 … Sunday = 7, in `tz`. */
function isoDowIn(tz: string): number {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    new Date(),
  );
  return (
    ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[day] ?? 1
  );
}
