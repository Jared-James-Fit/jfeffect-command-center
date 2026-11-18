/**
 * Runs set videos' feed-copy jobs (set_video_feed_jobs) through Mux, called
 * by the feed-copies-tick hook: the moment a job is queued (`{ setVideoId }`)
 * and every minute while one is due. Each step is short and saved on the job,
 * so a request that ends early loses nothing:
 *
 *   queued      → a 2-hour signed link to the clip goes to Mux (`muxAssetBody`)
 *   processing  → Mux's answer is read (`readRendition`); once its MP4 is
 *                 ready it's downloaded, stored as the clip's feed copy,
 *                 checked like any upload, recorded (set_video_feed_copy_server),
 *                 a film already in the feed brought up to date, and the asset
 *                 deleted from Mux
 *
 * No keys (MUX_TOKEN_ID / MUX_TOKEN_SECRET): jobs wait an hour and phones keep
 * making copies (app_settings 'feed_copies' says which). A job out of tries is
 * 'failed' and left to the phone.
 */
import {
  SERVER_COPY_LINK_S,
  SERVER_COPY_MAX_MS,
  SERVER_COPY_NO_KEYS_RETRY_MS,
  SERVER_COPY_POLL_MS,
  SERVER_COPY_WAIT_MS,
  afterFailure,
  copyKeeps,
  muxAssetBody,
  muxMp4Url,
  needsServerCopy,
  playbackIdOf,
  readRendition,
  serverCopyPath,
  type MuxAsset,
} from "@/lib/set-videos/server-copy";

const BUCKET = "message-attachments";
const MUX_API = "https://api.mux.com/video/v1";
/** Jobs a tick takes (each is a few short calls, or one download and upload of ~10 MB). */
const PER_TICK = 4;

type Job = {
  set_video_id: string;
  status: string;
  asset_id: string | null;
  playback_id: string | null;
  attempts: number;
  started_at: string | null;
  created_at: string;
};

export type FeedCopyTickResult = { status: "off" | "idle" | "ran"; jobs: Array<{ id: string; result: string }> };

function muxAuth(): string | null {
  const id = process.env.MUX_TOKEN_ID?.trim();
  const secret = process.env.MUX_TOKEN_SECRET?.trim();
  if (!id || !secret) return null;
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function mux(auth: string, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${MUX_API}${path}`, {
    ...init,
    headers: { Authorization: auth, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/** Whether phones should leave new clips to the server (written only when it changes). */
async function setServerOn(admin: any, on: boolean) {
  const { data } = await admin.from("app_settings").select("id, value").eq("key", "feed_copies").maybeSingle();
  let was: boolean | null = null;
  try {
    was = data?.value ? !!JSON.parse(data.value).server : null;
  } catch {
    was = null;
  }
  if (was === on) return;
  const value = JSON.stringify({ server: on, provider: "mux", at: new Date().toISOString() });
  if (data?.id) await admin.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("id", data.id);
  else await admin.from("app_settings").insert({ key: "feed_copies", value });
}

async function save(admin: any, id: string, patch: Record<string, unknown>) {
  await admin
    .from("set_video_feed_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("set_video_id", id);
}

async function deleteAsset(auth: string, assetId: string | null) {
  if (!assetId) return;
  await mux(auth, `/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }).catch(() => undefined);
}

async function fail(admin: any, auth: string | null, job: Job, reason: string) {
  const attempts = (job.attempts ?? 0) + 1;
  if (auth) await deleteAsset(auth, job.asset_id);
  const next = afterFailure(attempts);
  await save(admin, job.set_video_id, { ...next, attempts, error: reason.slice(0, 300), asset_id: null, playback_id: null, started_at: null });
  return `${next.status}: ${reason}`;
}

/** The stored file's real length and picture (only its header is read), as verifyVideoUploadFn reads it. */
async function readHeader(admin: any, path: string) {
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
  if (!signed?.signedUrl) return null;
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.UrlSource(signed.signedUrl, { getRetryDelay: (n: number) => (n < 3 ? 500 * n : null) }), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return { duration, width: track.displayWidth || null, height: track.displayHeight || null, codec: track.codec ?? null };
  } catch {
    return null;
  } finally {
    input.dispose?.();
  }
}

/** Mux has the MP4: store it as the clip's feed copy, check it, record it, refresh the film. */
async function finish(admin: any, auth: string, job: Job, v: any, name: string): Promise<string> {
  const path = serverCopyPath(v.storage_path);
  if (!path || !job.playback_id) return fail(admin, auth, job, "no copy path");
  const res = await fetch(muxMp4Url(job.playback_id, name));
  if (!res.ok) return fail(admin, auth, job, `download ${res.status}`);
  const buf = await res.arrayBuffer();
  if (!copyKeeps(buf.byteLength, Number(v.size_bytes) || 0)) {
    await deleteAsset(auth, job.asset_id);
    await save(admin, job.set_video_id, { status: "skipped", error: `copy ${buf.byteLength} bytes isn't worth keeping`, asset_id: null });
    return "skipped: copy not smaller";
  }
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob([buf], { type: "video/mp4" }), { contentType: "video/mp4", upsert: true, cacheControl: "31536000" });
  if (upErr) return fail(admin, auth, job, `upload: ${upErr.message ?? upErr}`);
  const [{ data: obj }, head] = await Promise.all([
    admin.rpc("media_video_object", { _bucket: BUCKET, _path: path }),
    readHeader(admin, path),
  ]);
  if (!obj?.id || !head) return fail(admin, auth, job, "couldn't read the copy");
  const { error: chkErr } = await admin.from("media_video_checks").upsert(
    {
      bucket: BUCKET,
      path,
      object_id: obj.id,
      owner: v.uploaded_by,
      duration_s: Math.round(head.duration * 1000) / 1000,
      width: head.width,
      height: head.height,
      video_codec: head.codec,
      bytes: Number(obj.bytes) || buf.byteLength,
      mime: "video/mp4",
      context: "workout",
      client: { mode: "server-copy", reason: "mux", encode: true, src_mb: Math.round(((Number(v.size_bytes) || 0) / 1048576) * 10) / 10, src_s: Number(v.duration_s) || 0 },
      checked_at: new Date().toISOString(),
    },
    { onConflict: "bucket,path" },
  );
  if (chkErr) return fail(admin, auth, job, `check: ${chkErr.message}`);
  const { data: rec, error: recErr } = await admin.rpc("set_video_feed_copy_server", { _id: v.id, _path: path });
  if (recErr) return fail(admin, auth, job, `record: ${recErr.message}`);
  await deleteAsset(auth, job.asset_id);
  await save(admin, job.set_video_id, { status: "done", error: null, asset_id: null });
  // a film already in the feed takes the copy now (one posted later is made from it)
  const completionId = (rec as { completion_id?: string | null } | null)?.completion_id;
  if (completionId && v.uploaded_by) {
    try {
      const { buildWorkoutFilm } = await import("@/lib/workout-film.server");
      await buildWorkoutFilm(admin, v.uploaded_by, { completionId, auto: true }, async () => {
        const { data: prof } = await admin.from("community_profiles").select("auto_post_film").eq("user_id", v.uploaded_by).maybeSingle();
        return { crew: null, autoOn: prof?.auto_post_film ?? true };
      });
    } catch {
      /* the next time the workout is open brings it up to date */
    }
  }
  return "done";
}

/** One step of one job. */
async function step(admin: any, auth: string, job: Job, deadline: number): Promise<string> {
  const { data: v } = await admin
    .from("pl_set_videos")
    .select("id, client_id, set_index, deleted_at, feed_path, storage_path, duration_s, size_bytes, width, height, uploaded_by")
    .eq("id", job.set_video_id)
    .maybeSingle();
  if (!v || !needsServerCopy(v)) {
    await deleteAsset(auth, job.asset_id);
    await save(admin, job.set_video_id, { status: v?.feed_path ? "done" : "skipped", error: v ? "no copy needed" : "set video gone", asset_id: null });
    return "skipped";
  }

  let current = job;
  if (!current.asset_id) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(v.storage_path, SERVER_COPY_LINK_S);
    if (!signed?.signedUrl) return fail(admin, auth, current, "couldn't sign the clip");
    let made = await mux(auth, "/assets", { method: "POST", body: JSON.stringify(muxAssetBody(signed.signedUrl)) });
    // Mux's older form, once, if the newer one is refused
    if (!made.ok && made.status === 400) made = await mux(auth, "/assets", { method: "POST", body: JSON.stringify(muxAssetBody(signed.signedUrl, true)) });
    if (made.status === 401 || made.status === 403) {
      await setServerOn(admin, false);
      await save(admin, current.set_video_id, { status: "queued", next_at: new Date(Date.now() + SERVER_COPY_NO_KEYS_RETRY_MS).toISOString(), error: `mux ${made.status}: check the keys` });
      return "keys refused";
    }
    if (!made.ok) return fail(admin, auth, current, `mux ${made.status}: ${JSON.stringify(made.body?.error ?? made.body ?? "").slice(0, 160)}`);
    await setServerOn(admin, true);
    const asset = (made.body?.data ?? null) as MuxAsset | null;
    const playback = playbackIdOf(asset);
    if (!asset?.id || !playback) return fail(admin, auth, { ...current, asset_id: asset?.id ?? null }, "mux gave no asset");
    current = { ...current, asset_id: asset.id, playback_id: playback, status: "processing", started_at: new Date().toISOString() };
    await save(admin, current.set_video_id, {
      status: "processing",
      asset_id: asset.id,
      playback_id: playback,
      started_at: current.started_at,
      error: null,
      next_at: new Date(Date.now() + SERVER_COPY_POLL_MS).toISOString(),
    });
  }

  // Waiting on Mux: looked at every few seconds while this request has time, else at the next tick.
  for (;;) {
    const got = await mux(auth, `/assets/${encodeURIComponent(current.asset_id!)}`);
    if (got.status === 404) return fail(admin, auth, { ...current, asset_id: null }, "mux asset gone");
    if (!got.ok) return fail(admin, auth, current, `mux ${got.status}`);
    const read = readRendition(got.body?.data as MuxAsset);
    if (read.state === "ready") return finish(admin, auth, current, v, read.name);
    if (read.state === "failed") return fail(admin, auth, current, read.reason);
    const started = current.started_at ? Date.parse(current.started_at) : Date.now();
    if (Date.now() - started > SERVER_COPY_MAX_MS) return fail(admin, auth, current, "mux took too long");
    if (Date.now() + 5_000 > deadline) {
      await save(admin, current.set_video_id, { next_at: new Date(Date.now() + SERVER_COPY_POLL_MS).toISOString() });
      return "waiting on mux";
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

/**
 * Claims and runs due jobs (the one named first). A job is claimed by moving
 * its next look out (only if it hasn't moved since), so two ticks never run it
 * at once.
 */
export async function runFeedCopyJobs(admin: any, setVideoId: string | null): Promise<FeedCopyTickResult> {
  const auth = muxAuth();
  const now = new Date();
  let q = admin
    .from("set_video_feed_jobs")
    .select("set_video_id, status, asset_id, playback_id, attempts, started_at, created_at, next_at, updated_at")
    .in("status", ["queued", "processing"])
    .gte("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(PER_TICK);
  q = setVideoId ? q.eq("set_video_id", setVideoId) : q.lte("next_at", now.toISOString());
  const { data: jobs } = await q;
  if (!jobs?.length) return { status: "idle", jobs: [] };

  if (!auth) {
    await setServerOn(admin, false);
    const later = new Date(now.getTime() + SERVER_COPY_NO_KEYS_RETRY_MS).toISOString();
    for (const j of jobs as any[]) await save(admin, j.set_video_id, { next_at: later, error: "waiting for the video service's keys" });
    return { status: "off", jobs: (jobs as any[]).map((j) => ({ id: j.set_video_id, result: "no keys" })) };
  }

  const deadline = Date.now() + SERVER_COPY_WAIT_MS;
  const out: FeedCopyTickResult["jobs"] = [];
  for (const j of jobs as any[]) {
    // claim: move its next look out, only if nothing else has since
    const claimUntil = new Date(Date.now() + 2 * 60_000).toISOString();
    const { data: claimed } = await admin
      .from("set_video_feed_jobs")
      .update({ next_at: claimUntil, updated_at: new Date().toISOString() })
      .eq("set_video_id", j.set_video_id)
      .eq("updated_at", j.updated_at)
      .select("set_video_id");
    if (!claimed?.length) continue;
    try {
      out.push({ id: j.set_video_id, result: await step(admin, auth, j as Job, deadline) });
    } catch (e: any) {
      out.push({ id: j.set_video_id, result: await fail(admin, auth, j as Job, `error: ${String(e?.message ?? e)}`) });
    }
  }
  return { status: "ran", jobs: out };
}
