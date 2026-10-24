/**
 * Pictures for automated posts from an image model (server only).
 *
 * Saturday Spirit used to go out with a drawing the app made in code. Now its
 * scene is a real picture: made for the next Saturday post as soon as it's up
 * next (it rides along as the library item's photo, so the coach sees it in
 * Crew → Posts a week ahead and can ask for another), and made for a Saturday
 * post that went out without one. The coach can also tap New picture on the
 * post. Runs from the post-pictures-tick hook (pg_cron) and makePostPicture.
 *
 * Model: OpenAI's image model (ChatGPT's) when OPENAI_API_KEY is set, else
 * Google's image model through the Lovable AI gateway the app already uses.
 */
import { imageSize, scenePicturePrompt } from "@/lib/post-pictures";
import { isSpiritScene } from "@/components/community/spirit-scenes";

type Admin = any;
export type Picture = { bytes: Uint8Array; mime: string; width: number; height: number; provider: string };
type Made = { ok: true; picture: Picture } | { ok: false; reason: string };
export type PictureResult = { ok: true; path: string; provider: string } | { ok: false; reason: string };

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_MODELS = ["google/gemini-3-pro-image-preview", "google/gemini-2.5-flash-image", "google/gemini-2.5-flash-image-preview"];
const BUCKET = "community-media";
const STATUS_KEY = "post_pictures_status";
/** After a failed try the tick waits this long before spending another call. */
const BACKOFF_MS = 6 * 60 * 60 * 1000;

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function picture(bytes: Uint8Array, provider: string): Made {
  const size = imageSize(bytes);
  if (!size || size.width < 256 || size.height < 256) return { ok: false, reason: `${provider} sent something that isn't a picture` };
  return { ok: true, picture: { bytes, ...size, provider } };
}

async function viaOpenAI(key: string, prompt: string): Promise<Made> {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size: "1024x1536", quality: "high", output_format: "jpeg", output_compression: 88, n: 1 }),
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
  return b64 ? picture(fromBase64(b64), `openai:${model}`) : { ok: false, reason: "OpenAI didn't send a picture back" };
}

/** The picture in a chat reply: `message.images[]`, or an image part / data URL in `content`. */
export function gatewayImage(json: any): string | null {
  const msg = json?.choices?.[0]?.message;
  const urls: unknown[] = [
    ...(Array.isArray(msg?.images) ? msg.images.map((i: any) => i?.image_url?.url ?? i?.url) : []),
    ...(Array.isArray(msg?.content) ? msg.content.map((p: any) => p?.image_url?.url ?? p?.url) : []),
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
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: `Generate an image. ${prompt}` }], modalities: ["image", "text"] }),
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
  if (!openai && !lovable) return { ok: false, reason: "No image model is set up (OPENAI_API_KEY or LOVABLE_API_KEY)." };
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
  const { error } = await admin.storage.from(BUCKET).upload(path, pic.bytes, { contentType: pic.mime, upsert: false });
  if (error) throw new Error(`Couldn't save the picture: ${error.message}`);
  return { path, type: "image", width: pic.width, height: pic.height };
}

/** A picture this module made earlier, which a new one replaces (anything the coach uploaded stays). */
const madeHere = (path: unknown): path is string => typeof path === "string" && path.includes("/post-pictures/");

async function removeOld(admin: Admin, paths: unknown[]) {
  const mine = paths.filter(madeHere);
  if (mine.length) await admin.storage.from(BUCKET).remove(mine);
}

/** A new picture on a Saturday post (replacing one made here; never one the coach put on). */
export async function pictureForPost(admin: Admin, postId: string): Promise<PictureResult> {
  const { data: post } = await admin
    .from("community_posts")
    .select("id, series, series_data, caption, author_user_id, media_path, extra_media")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { ok: false, reason: "Post not found" };
  const scene = post.series_data?.scene;
  if (post.series !== "saturday_spirit" || !isSpiritScene(scene)) return { ok: false, reason: "Only Saturday's scene posts get a made picture." };
  if (post.media_path && !madeHere(post.media_path)) return { ok: false, reason: "This post has your own photo on it. Remove it first to get a made picture." };
  const made = await generatePicture(scenePicturePrompt(scene, post.caption));
  if (!made.ok) return made;
  const entry = await storePicture(admin, post.author_user_id, `post-${post.id}`, made.picture);
  const { error } = await admin.rpc("community_apply_media", { _post_id: post.id, _media: [entry] });
  if (error) return { ok: false, reason: error.message };
  await removeOld(admin, [post.media_path]);
  return { ok: true, path: entry.path, provider: made.picture.provider };
}

/** A new picture on Saturday's next library post: it goes out with it (once), like a photo the coach added. */
export async function pictureForItem(admin: Admin, itemId: string): Promise<PictureResult> {
  const { data: item } = await admin.from("community_series_items").select("id, series, data, body, media").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, reason: "That post isn't in the library." };
  const scene = item.data?.scene;
  if (item.series !== "saturday_spirit" || !isSpiritScene(scene)) return { ok: false, reason: "Only Saturday's scene posts get a made picture." };
  const media = (Array.isArray(item.media) ? item.media : []) as { path?: string }[];
  if (media.some((m) => !madeHere(m?.path))) return { ok: false, reason: "This post has your own photo on it. Remove it first to get a made picture." };
  const { data: settings } = await admin.from("community_series_settings").select("author_user_id").maybeSingle();
  if (!settings?.author_user_id) return { ok: false, reason: "No account to post as yet." };
  const made = await generatePicture(scenePicturePrompt(scene, item.body));
  if (!made.ok) return made;
  const entry = await storePicture(admin, settings.author_user_id, `item-${item.id}`, made.picture);
  const { error } = await admin.from("community_series_items").update({ media: [entry] }).eq("id", item.id);
  if (error) return { ok: false, reason: error.message };
  await removeOld(admin, media.map((m) => m?.path));
  return { ok: true, path: entry.path, provider: made.picture.provider };
}

type TickStatus = { at: string; ok: boolean; what?: string; reason?: string; provider?: string };

async function readStatus(admin: Admin): Promise<TickStatus | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", STATUS_KEY).maybeSingle();
  try {
    return data?.value ? (JSON.parse(data.value) as TickStatus) : null;
  } catch {
    return null;
  }
}

async function writeStatus(admin: Admin, status: TickStatus) {
  const value = JSON.stringify(status);
  const { data } = await admin.from("app_settings").update({ value, updated_at: status.at }).eq("key", STATUS_KEY).select("id");
  if (!data?.length) await admin.from("app_settings").insert({ key: STATUS_KEY, value });
}

/**
 * One picture per run, most visible first: a Saturday post out in the last
 * day and a half without one, else the next Saturday post (while Saturday
 * Spirit is on and posting isn't paused). A failure waits BACKOFF_MS.
 */
export async function runPostPicturesTick(admin: Admin): Promise<Record<string, unknown>> {
  const last = await readStatus(admin);
  if (last && !last.ok && Date.now() - Date.parse(last.at) < BACKOFF_MS) return { skipped: "waiting after a failed try", last };

  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data: posts } = await admin
    .from("community_posts")
    .select("id, series_data")
    .eq("series", "saturday_spirit")
    .is("media_path", null)
    .is("archived_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3);
  const post = (posts ?? []).find((p: any) => isSpiritScene(p?.series_data?.scene));

  let what: string | null = null;
  let result: PictureResult | null = null;
  if (post) {
    what = `post ${post.id}`;
    result = await pictureForPost(admin, post.id);
  } else {
    const { data: settings } = await admin.from("community_series_settings").select("paused, series_on").maybeSingle();
    if (!settings || settings.paused || !(settings.series_on ?? []).includes("saturday_spirit")) return { skipped: "Saturday Spirit is off" };
    const { data: next } = await admin.rpc("community_series_next", { _series: "saturday_spirit" });
    const item = Array.isArray(next) ? next[0] : next;
    if (!item?.id || !isSpiritScene(item?.data?.scene)) return { skipped: "no Saturday scene up next" };
    if (Array.isArray(item.media) && item.media.length) return { skipped: "next Saturday post already has a picture" };
    what = `item ${item.id}`;
    result = await pictureForItem(admin, item.id);
  }
  const status: TickStatus = result.ok
    ? { at: new Date().toISOString(), ok: true, what, provider: result.provider }
    : { at: new Date().toISOString(), ok: false, what, reason: result.reason };
  await writeStatus(admin, status);
  return status;
}
