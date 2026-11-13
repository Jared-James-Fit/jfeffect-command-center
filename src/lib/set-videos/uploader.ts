/**
 * Set videos, from the pick to the coach chat, in the background: the
 * athlete picks or films a clip on a set and goes straight back to logging.
 *
 *   pick     read the clip's header (no decoding); the trimmer opens only
 *            when it's over a coach chat's 10 minutes
 *   prepare  planVideo decides: send it as it is, cut it (a remux, ~instant),
 *            or shrink it to 720p H.264 on the phone's hardware encoder, and
 *            only when that wins on total time: a re-encode that turns out
 *            slower than just sending the copy is dropped for the copy
 *            (render.ts, encodeTooSlow, from this connection's measured speed)
 *   keep     the prepared clip goes into the phone's outbox (outbox.ts), so a
 *            closed or killed app picks up where it stopped
 *   upload   straight to storage (the coach chat's own bucket and folder),
 *            resumable: a dropped connection, a retry or a reopened app sends
 *            only what hasn't landed yet
 *   check    the server reads it back (verifyVideoUploadFn); the database
 *            only takes a checked video
 *   send     set_video_attach records it on the logged set and posts it to
 *            the coach chat in one transaction, keyed by this job: a retry
 *            never makes a second message
 *
 * One clip goes at a time (each one gets the whole connection, so the first
 * reaches the coach soonest). A failure from the connection retries by itself
 * (with back-off, and again the moment the app is back on screen or online);
 * a real "no" (too long, not allowed) waits for a tap.
 *
 *   feed copy  a clip that went as it was (an iPhone's 4K original, ~50 MB
 *            for 30 s) gets a 720p copy for Crew once the coach has it
 *            (feed-copy.ts): made while nothing else is sending, uploaded
 *            next to the original, checked as a workout post's video and
 *            recorded on the set video (set_video_feed_copy); the workout
 *            film is made from it. Only while their film goes to Crew, and
 *            never needed: a copy that can't be made leaves the original on
 *            the film, and the coach's clip never changes.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pickVideo, type PickedVideo, type TrimFn } from "@/lib/video-edit/pick";
import { planVideo, selectionOf } from "@/lib/video-edit/plan";
import { renderVideo, VideoRenderError } from "@/lib/video-edit/render";
import { videoBudget, videoLimit } from "@/lib/video-edit/limits";
import { videoErrorMessage } from "@/lib/video-edit/pipeline";
import { measuredUplink, uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { verifyVideoUploadFn } from "@/lib/video-verify.functions";
import { captureVideoPoster } from "@/lib/video-poster";
import { chatUrlCache } from "@/hooks/use-chat-signed-urls";
import { keepChatVideo } from "@/lib/chat-video-store";
import { setVideoFileKey, setVideoStem } from "@/lib/set-videos/label";
import { probeVideo } from "@/lib/video-edit/probe";
import {
  catchUpJobId,
  markCatchUpChecked,
  takeCatchUpLaunch,
  type CatchUpClip,
} from "@/lib/set-videos/catch-up";
import {
  FEED_COPY_MAX_MS,
  FEED_COPY_TRIES,
  feedCopyPath,
  feedCopyPlan,
  feedCopyWorthIt,
  type FeedCopyPlan,
} from "@/lib/set-videos/feed-copy";
import {
  dropSetVideoJob,
  getSetVideoJobs,
  isActiveJob,
  patchSetVideoJob,
  putSetVideoJob,
  type SetVideoJob,
} from "@/lib/set-videos/jobs";
import { linkFilmed } from "@/lib/set-videos/phone-copy";
import {
  outboxDelete,
  outboxForUser,
  outboxGet,
  outboxPatch,
  outboxPut,
  type OutboxMeta,
  type OutboxRecord,
} from "@/lib/set-videos/outbox";

const BUCKET = "message-attachments" as const;
const CONTEXT = "coach" as const;
/** Waits before retrying a send the connection broke. */
export const RETRY_DELAYS_MS = [2_000, 6_000, 15_000, 30_000, 60_000, 120_000];
const db = supabase as any;

export type StartSetVideo = {
  file: File;
  userId: string;
  clientId: string;
  rowId: string;
  dayId: string;
  resultId: string | null;
  setIndex: number;
  exerciseName: string;
  dayTitle: string;
  label: string;
  trim?: TrimFn;
};

/** A "no" that trying again won't change. */
export class SetVideoRefused extends Error {}

/** Clips waiting their turn / the one going now, and in-memory files of this session's picks. */
const queue: string[] = [];
let running: string | null = null;
/** This session's prepared clips (the one that uploads): a retry never depends on the phone having kept it. */
const preparedFiles = new Map<string, File>();
/** What was picked for this session's jobs (gone after a reload: the outbox's prepared clip takes over). */
const pickedVideos = new Map<string, PickedVideo>();
const controllers = new Map<string, AbortController>();
/** This session's poster sends (waited on briefly before the message goes, never long). */
const posterSends = new Map<string, Promise<void>>();
const attempts = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let wired = false;

/** A clip that went as it was, held for its Crew copy until the coach has it (this session only). */
type FeedSource = { video: PickedVideo; plan: FeedCopyPlan; sentBytes: number };
type FeedCopy = Partial<Pick<FeedSource, "video" | "plan">> & {
  sentBytes: number;
  jobId: string;
  setVideoId: string;
  clientId: string;
  tries: number;
  /** A clip sent before this session (catch-up.ts): fetched from storage when its turn comes, null when no copy fits. */
  load?: () => Promise<Pick<FeedSource, "video" | "plan"> | null>;
  /** What the server's check is told about the source (kept so the fetched clip can be let go once the copy is made). */
  source?: { src_s: number; src_mb: number; sel_s: number };
  /** Kept once made: a retry sends the same bytes (the upload resumes by path). */
  file?: File;
  uploaded?: boolean;
};
const feedSources = new Map<string, FeedSource>();
const feedQueue: FeedCopy[] = [];
let feedRunning: { item: FeedCopy; ctl: AbortController } | null = null;

/** The extension the stored clip gets (the same rule as the chat's own videos). */
export function videoExt(file: { type: string }): string {
  return file.type.includes("webm") ? "webm" : file.type.includes("quicktime") ? "mov" : "mp4";
}

/** Words for a failed set video (never a stack trace). */
export function setVideoErrorMessage(e: unknown): string {
  if (e instanceof SetVideoRefused) return e.message;
  const msg = e instanceof Error ? e.message : "";
  if (/no coach|isn't in this workout|Not allowed/i.test(msg))
    return msg === "Not allowed" ? "You can't add a video to this set." : msg;
  return videoErrorMessage(e);
}

/** Whether to try again by itself (the connection, the server's hiccup) or wait for a tap. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof SetVideoRefused) return false;
  if (e instanceof VideoRenderError)
    return e.code !== "aborted" && !/too long|can't|can be up to/i.test(e.message);
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/cancel/i.test(msg)) return false;
  if (
    /can be up to|too big|only post videos|Couldn't read|Not allowed|no coach|isn't in this workout|Trim it|session expired|sign in/i.test(
      msg,
    )
  )
    return false;
  return true;
}

function metaOf(j: SetVideoJob): OutboxMeta {
  const {
    id,
    userId,
    clientId,
    rowId,
    dayId,
    resultId,
    setIndex,
    exerciseName,
    dayTitle,
    label,
    fileKey,
    fileName,
    createdAt,
  } = j;
  return {
    id,
    userId,
    clientId,
    rowId,
    dayId,
    resultId,
    setIndex,
    exerciseName,
    dayTitle,
    label,
    fileKey,
    fileName,
    createdAt,
  };
}

function wireOnce() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // Back on screen or back online: anything the connection broke goes again now.
  const kick = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    for (const j of getSetVideoJobs()) {
      if (j.state === "failed" && j.autoRetry && !j.needsFile)
        void retrySetVideo(j.id, { auto: true });
    }
    pumpFeed();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", kick);
}

/** Already on its way on this phone, or already on a set (and in the chat). */
async function alreadySent(
  clientId: string,
  fileKey: string,
): Promise<{ setIndex: number; exercise: string | null } | null> {
  try {
    const { data } = await db
      .from("pl_set_videos")
      .select("set_index, exercise_name")
      .eq("client_id", clientId)
      .eq("file_key", fileKey)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    return data ? { setIndex: data.set_index, exercise: data.exercise_name } : null;
  } catch {
    return null; // can't tell: the server's own check still stops a second message
  }
}

/** The server's "already sent?" read, never holding up a pick: skipped offline, given up after 2.5 s. */
function alreadySentQuick(clientId: string, fileKey: string) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(null);
  return Promise.race([
    alreadySent(clientId, fileKey),
    new Promise<null>((r) => setTimeout(() => r(null), 2_500)),
  ]);
}

/** Pick → background send. Resolves once the clip is read (the upload carries on by itself). */
export async function startSetVideo(
  input: StartSetVideo,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  wireOnce();
  const fileKey = await setVideoFileKey(input.clientId, input.file);
  const dup = getSetVideoJobs().find(
    (j) => j.fileKey === fileKey && j.clientId === input.clientId && j.state !== "done",
  );
  if (dup) {
    toast.message(
      isActiveJob(dup)
        ? "That video is already on its way."
        : `That video is already on set ${dup.setIndex}.`,
    );
    return { ok: false, reason: "duplicate" };
  }
  // on the set at once (the ring), while the clip is read and the server asked
  const id = crypto.randomUUID();
  const job: SetVideoJob = {
    id,
    userId: input.userId,
    clientId: input.clientId,
    rowId: input.rowId,
    dayId: input.dayId,
    resultId: input.resultId,
    setIndex: input.setIndex,
    exerciseName: input.exerciseName,
    dayTitle: input.dayTitle,
    label: input.label,
    fileKey,
    fileName: input.file.name || "video",
    state: "preparing",
    progress: 1,
    createdAt: Date.now(),
  };
  putSetVideoJob(job);
  const sentP = alreadySentQuick(input.clientId, fileKey);
  let picked: Awaited<ReturnType<typeof pickVideo>>;
  try {
    picked = await pickVideo(input.file, CONTEXT, { trim: input.trim });
  } catch (e) {
    dropSetVideoJob(id);
    toast.error(setVideoErrorMessage(e));
    return { ok: false, reason: "unreadable" };
  }
  if (!picked.ok) {
    dropSetVideoJob(id);
    if (!picked.cancelled && picked.reason) toast.error(picked.reason);
    return { ok: false, reason: picked.cancelled ? "cancelled" : picked.reason };
  }
  const sent = await sentP;
  if (sent) {
    dropSetVideoJob(id);
    toast.message(
      `That video is already on ${sent.exercise ? `${sent.exercise}, ` : ""}set ${sent.setIndex}. Remove it there first to move it.`,
    );
    return { ok: false, reason: "duplicate" };
  }
  const sel = selectionOf(picked.video.info, picked.video.trim);
  // Kept before anything else: a record with no clip yet still says "pick it again" after a crash.
  await outboxPut({
    id,
    userId: input.userId,
    meta: metaOf(job),
    source: {
      duration: picked.video.info.duration,
      bytes: picked.video.info.bytes,
      selSec: sel.end - sel.start,
      canEncode: picked.video.canEncode,
    },
    savedAt: Date.now(),
  });
  pickedVideos.set(id, picked.video);
  enqueue(id);
  return { ok: true, id };
}

function enqueue(id: string) {
  if (!queue.includes(id) && running !== id) queue.push(id);
  void pump();
}

async function pump() {
  if (running) return;
  const next = queue.shift();
  if (!next) {
    pumpFeed();
    return;
  }
  running = next;
  try {
    await runJob(next);
  } finally {
    running = null;
    void pump();
  }
}

/** One job, from wherever it got to. */
async function runJob(id: string) {
  const job = getSetVideoJobs().find((j) => j.id === id);
  if (!job) return;
  const ctl = new AbortController();
  controllers.set(id, ctl);
  const signal = ctl.signal;
  const set = (patch: Partial<SetVideoJob>) => patchSetVideoJob(id, patch);
  try {
    let rec =
      (await outboxGet(id)) ??
      ({ id, userId: job.userId, meta: metaOf(job), savedAt: Date.now() } as OutboxRecord);
    /** The prepared clip being kept for a closed app: written while it uploads, never waited on before. */
    let keptClip: Promise<unknown> = Promise.resolve();

    // 1. prepare (only this session: after a reload the outbox has the prepared clip, or nothing)
    let prepared: File | null =
      preparedFiles.get(id) ??
      (rec.file
        ? new File(
            [rec.file],
            `set-${job.setIndex}.${videoExt({ type: rec.fileType ?? "video/mp4" })}`,
            { type: rec.fileType ?? "video/mp4" },
          )
        : null);
    if (!prepared) {
      const picked = pickedVideos.get(id);
      if (!picked) {
        set({ state: "failed", needsFile: true, autoRetry: false, error: null });
        return;
      }
      set({ state: "preparing", progress: 1, error: null, autoRetry: false, needsFile: false });
      const plan = planVideo(picked.info, picked.trim, CONTEXT, { canEncode: picked.canEncode });
      if (plan.mode === "reject") throw new SetVideoRefused(plan.reason);
      const weight = plan.mode === "transcode" ? 0.45 : plan.mode === "copy" ? 0.08 : 0.02;
      // the poster (the first moment of what goes) is made and sent alongside, never waited on long
      const posterPath = `${setVideoStem(job.clientId, id)}-poster.jpg`;
      posterSends.set(
        id,
        captureVideoPoster(picked.file, { at: picked.trim?.start ?? null }).then(
          async (poster) => {
            if (!poster) return;
            chatUrlCache.seed(posterPath, URL.createObjectURL(poster.blob));
            await outboxPatch(id, {
              poster: poster.blob,
              posterPath,
              width: poster.width,
              height: poster.height,
            });
            await sendPoster(id, job.clientId, poster.blob, posterPath, signal);
          },
          () => {},
        ),
      );
      const out = await renderVideo(picked.file, picked.info, plan, {
        onProgress: (f) => set({ progress: Math.max(1, Math.round(f * weight * 100)) }),
        signal,
        uplinkBytesPerSec: () => measuredUplink() ?? 1_250_000,
        limitSeconds: videoLimit(CONTEXT),
        maxBytes: videoBudget(CONTEXT).max,
      });
      prepared = out.file;
      // went as it was (a 4K original): a 720p copy for Crew follows once the coach has it
      const feedPlan = feedCopyPlan(out.mode, picked.info, picked.trim, picked.canEncode);
      if (feedPlan) feedSources.set(id, { video: picked, plan: feedPlan, sentBytes: prepared.size });
      const path = `${setVideoStem(job.clientId, id)}.${videoExt(prepared)}`;
      const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
      const transfer = {
        v: 2,
        mode: out.mode,
        why: out.reason.slice(0, 80),
        prep_ms: out.ms,
        src_s: Math.round(picked.info.duration * 10) / 10,
        sel_s: Math.round((rec.source?.selSec ?? picked.info.duration) * 10) / 10,
        orig_mb: mb(picked.file.size),
        sent_mb: mb(prepared.size),
        ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : null,
      };
      const clip = {
        file: prepared,
        fileType: prepared.type,
        path,
        render: { mode: out.mode, reason: out.reason, ms: out.ms },
        transfer,
      };
      rec = { ...rec, ...clip };
      // keep the clip so a closed app carries on (a full phone or private mode just can't: it still sends now);
      // merged in, so the poster saved alongside stays, and written while the upload starts
      const whole = rec;
      keptClip = outboxPatch(id, clip).then((ok) => ok || outboxPut(whole));
      preparedFiles.set(id, prepared);
      pickedVideos.delete(id);
    }
    const path = rec.path ?? `${setVideoStem(job.clientId, id)}.${videoExt(prepared)}`;
    // the bar: preparing took its share already (a re-encode is most of the wait)
    const base =
      rec.render?.mode === "transcode" ? 0.45 : rec.render?.mode === "copy" ? 0.08 : 0.02;

    // 2. upload (resumable; already landed parts never go twice)
    if (!rec.uploaded) {
      set({
        state: "uploading",
        progress: Math.max(job.progress, Math.round(base * 100)),
        error: null,
        autoRetry: false,
        needsFile: false,
      });
      const started = Date.now();
      try {
        await uploadLiftFileToStorage({
          file: prepared,
          userId: job.clientId,
          bucket: BUCKET,
          path,
          resume: true,
          signal,
          onProgress: (pct) =>
            set({ progress: Math.round((base + (pct / 100) * (0.95 - base)) * 100) }),
        });
      } catch (e) {
        // it landed on an earlier try whose answer was lost (409): carry on
        if (!/409|already exists|Duplicate/i.test(e instanceof Error ? e.message : String(e)))
          throw e;
      }
      rec = {
        ...rec,
        uploaded: true,
        path,
        transfer: { ...(rec.transfer ?? {}), up_ms: Date.now() - started },
      };
      await keptClip;
      await outboxPatch(id, { uploaded: true, path, transfer: rec.transfer });
    }
    // the sender plays their own clip from the phone, never downloading it
    keepChatVideo(path, prepared);

    // 3. the server's read (the database holds the send to it)
    if (!rec.check) {
      set({ state: "checking", progress: 96 });
      const check = await verifyWithRetry(path, rec, signal);
      rec = {
        ...rec,
        check: {
          duration: check.duration,
          width: check.width,
          height: check.height,
          bytes: check.bytes,
          mime: prepared.type || null,
        },
      };
      await outboxPatch(id, { check: rec.check });
    }

    // 4. on the set + in the coach chat, once (keyed by this job)
    set({ state: "sending", progress: 98 });
    // the poster: this session's (waited on a moment, never long) or the one kept from before a reload
    const pending = posterSends.get(id);
    if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, 3000))]);
    let posterRec = (await outboxGet(id)) ?? rec;
    if (!pending && posterRec.poster && posterRec.posterPath && !posterRec.posterUploaded) {
      await sendPoster(id, job.clientId, posterRec.poster, posterRec.posterPath, signal);
      posterRec = (await outboxGet(id)) ?? posterRec;
    }
    const res = await attachWithRetry(
      job,
      rec,
      posterRec.posterUploaded ? (posterRec.posterPath ?? null) : null,
      signal,
    );
    await outboxDelete(id);
    attempts.delete(id);
    posterSends.delete(id);
    preparedFiles.delete(id);
    const feed = feedSources.get(id);
    feedSources.delete(id);
    if (feed && res.id)
      queueFeedCopy({ ...feed, jobId: id, setVideoId: res.id, clientId: job.clientId, tries: 0 });
    set({
      state: "done",
      progress: 100,
      setVideoId: res.id,
      messageId: res.message_id,
      posterPath: posterRec.posterUploaded ? (posterRec.posterPath ?? null) : null,
      error: null,
      autoRetry: false,
    });
    // a clip filmed in the app and not saved to the phone yet: a reload can fetch it from storage now
    linkFilmed(job.userId, id, res.id);
    if (!res.existed) {
      toast.success(`Set ${job.setIndex} video sent to your coach`);
      if (res.message_id) void notifyCoach(res.message_id);
    }
  } catch (e) {
    if (signal.aborted) return;
    const retry = isRetryable(e);
    const n = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, n);
    set({ state: "failed", error: setVideoErrorMessage(e), autoRetry: retry });
    if (retry) {
      const wait = RETRY_DELAYS_MS[Math.min(n - 1, RETRY_DELAYS_MS.length - 1)];
      clearTimeout(retryTimers.get(id));
      retryTimers.set(
        id,
        setTimeout(() => void retrySetVideo(id, { auto: true }), wait),
      );
    } else {
      toast.error(setVideoErrorMessage(e));
    }
  } finally {
    controllers.delete(id);
  }
}

async function sendPoster(
  id: string,
  clientId: string,
  poster: Blob,
  posterPath: string,
  signal: AbortSignal,
) {
  try {
    await uploadLiftFileToStorage({
      file: new File([poster], "poster.jpg", { type: "image/jpeg" }),
      userId: clientId,
      bucket: BUCKET,
      path: posterPath,
      signal,
    });
    await outboxPatch(id, { posterUploaded: true });
  } catch (e) {
    // landed before (its answer was lost): it's there
    if (/409|already exists|Duplicate/i.test(e instanceof Error ? e.message : String(e)))
      await outboxPatch(id, { posterUploaded: true });
    /* otherwise no poster: the bubble reads the video's first frame */
  }
}

async function verifyWithRetry(path: string, rec: OutboxRecord, signal: AbortSignal) {
  let last: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (signal.aborted) throw new VideoRenderError("Cancelled.", "aborted");
    try {
      return await verifyVideoUploadFn({
        data: {
          bucket: BUCKET,
          path,
          context: CONTEXT,
          client: {
            mode: (rec.render?.mode as "original" | "copy" | "transcode") ?? "original",
            reason: (rec.render?.reason ?? "set-video").slice(0, 140),
            src_s: Math.round((rec.source?.duration ?? 0) * 10) / 10,
            src_mb: Math.round(((rec.source?.bytes ?? 0) / 1048576) * 10) / 10,
            sel_s: Math.round((rec.source?.selSec ?? 0) * 10) / 10,
            prep_ms: rec.render?.ms ?? 0,
            up_ms: Number(rec.transfer?.up_ms ?? 0),
            encode: rec.source?.canEncode ?? false,
            ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : undefined,
          },
        },
      });
    } catch (e) {
      last = e;
      if (!isRetryable(e)) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Couldn't check that video. Try again.");
}

type AttachResult = {
  id: string;
  message_id: string | null;
  existed: boolean;
  set_index?: number;
  exercise?: string | null;
};

async function attachWithRetry(
  job: SetVideoJob,
  rec: OutboxRecord,
  posterPath: string | null,
  signal: AbortSignal,
): Promise<AttachResult> {
  let last: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (signal.aborted) throw new VideoRenderError("Cancelled.", "aborted");
    const { data, error } = await db.rpc("set_video_attach", {
      _client_key: job.id,
      _client_id: job.clientId,
      _row_id: job.rowId,
      _result_id: job.resultId,
      _set_index: job.setIndex,
      _label: job.label,
      _storage_path: rec.path,
      _thumbnail_path: posterPath,
      _duration: rec.check ? Math.round(rec.check.duration * 10) / 10 : null,
      _width: rec.check?.width ?? rec.width ?? null,
      _height: rec.check?.height ?? rec.height ?? null,
      _size: rec.check?.bytes ?? rec.file?.size ?? null,
      _mime: rec.check?.mime ?? rec.fileType ?? "video/mp4",
      _file_key: job.fileKey,
      _transfer: rec.transfer ?? null,
    });
    if (!error && data) return data as AttachResult;
    last = error ?? new Error("That video didn't send. Tap to try again.");
    const msg = String((error as { message?: string } | null)?.message ?? "");
    if (
      /Not allowed|no coach|isn't in this workout|checked yet|changed after|up to|too big/i.test(
        msg,
      )
    )
      throw new SetVideoRefused(msg === "Not allowed" ? "You can't add a video to this set." : msg);
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last instanceof Error
    ? last
    : new Error(String((last as { message?: string })?.message ?? "That video didn't send."));
}

async function notifyCoach(messageId: string) {
  try {
    const { notifyNewMessage } = await import("@/lib/push/events.functions");
    await notifyNewMessage({ data: { messageId } });
  } catch {
    /* the message is there either way */
  }
}

/** Try a failed one again (a tap, or by itself once the connection's back). */
export async function retrySetVideo(id: string, opts: { auto?: boolean } = {}) {
  wireOnce();
  const job = getSetVideoJobs().find((j) => j.id === id);
  if (!job || isActiveJob(job) || job.needsFile) return;
  if (!opts.auto) attempts.delete(id);
  clearTimeout(retryTimers.get(id));
  patchSetVideoJob(id, {
    state: job.progress > 5 ? "uploading" : "preparing",
    error: null,
    autoRetry: false,
  });
  enqueue(id);
}

/** Stop one and forget it (on the phone; a clip already in the chat stays there). */
export async function cancelSetVideo(id: string) {
  clearTimeout(retryTimers.get(id));
  controllers.get(id)?.abort();
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  preparedFiles.delete(id);
  pickedVideos.delete(id);
  posterSends.delete(id);
  attempts.delete(id);
  feedSources.delete(id);
  const f = feedQueue.findIndex((x) => x.jobId === id);
  if (f >= 0) feedQueue.splice(f, 1);
  if (feedRunning?.item.jobId === id) feedRunning.ctl.abort();
  dropSetVideoJob(id);
  await outboxDelete(id);
}

/**
 * The app opened again: whatever was on its way carries on (from the clip
 * kept in the outbox; the upload resumes from what landed). One whose clip
 * wasn't ready yet asks to be picked again.
 */
export async function resumeSetVideos(userId: string) {
  wireOnce();
  const recs = await outboxForUser(userId);
  for (const r of recs) {
    if (getSetVideoJobs().some((j) => j.id === r.id)) continue;
    const m = r.meta;
    putSetVideoJob({
      ...m,
      state: r.file ? (r.uploaded ? "checking" : "uploading") : "failed",
      progress: r.uploaded ? 95 : 5,
      needsFile: !r.file,
      autoRetry: false,
      error: null,
    });
    if (r.file) enqueue(r.id);
  }
}

/* ---- Feed copies: 720p for Crew, after the coach has the clip ---------- */

function queueFeedCopy(item: FeedCopy) {
  if (feedQueue.some((f) => f.jobId === item.jobId) || feedRunning?.item.jobId === item.jobId) return;
  feedQueue.push(item);
  pumpFeed();
}

/** Nothing for the coach is sending (their clips always go first). */
function sendingIdle() {
  return !running && queue.length === 0;
}

/** Starts the next copy while nothing else is sending and the app is on screen (a copy started keeps going). */
function pumpFeed() {
  if (feedRunning || !sendingIdle()) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const item = feedQueue.shift();
  if (!item) return;
  const ctl = new AbortController();
  feedRunning = { item, ctl };
  void makeFeedCopy(item, ctl.signal)
    .catch((e) => {
      // gave up (too slow, or the set video was removed): the original stays on the film
      if (ctl.signal.aborted) return;
      item.tries += 1;
      if (item.tries < FEED_COPY_TRIES && isRetryable(e)) feedQueue.push(item);
    })
    .finally(() => {
      feedRunning = null;
      setTimeout(pumpFeed, 1_000);
    });
}

/** Their film goes to Crew (the copy is only for the feed; Coach only needs none). */
async function filmGoesToCrew(): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("community_auto_post_film");
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

async function waitForIdleSending(signal: AbortSignal) {
  while (!sendingIdle()) {
    if (signal.aborted) throw new VideoRenderError("Cancelled.", "aborted");
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function makeFeedCopy(item: FeedCopy, signal: AbortSignal) {
  if (!item.file) {
    if (!(await filmGoesToCrew())) return;
    const src = item.video && item.plan ? { video: item.video, plan: item.plan } : await item.load?.();
    if (!src) return;
    if (signal.aborted) throw new VideoRenderError("Cancelled.", "aborted");
    // an encode still going after FEED_COPY_MAX_MS is given up on (aborted: never retried)
    const slow = new AbortController();
    const stop = () => slow.abort();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, FEED_COPY_MAX_MS);
    let out: Awaited<ReturnType<typeof renderVideo>>;
    try {
      out = await renderVideo(src.video.file, src.video.info, src.plan, {
        signal: slow.signal,
        limitSeconds: videoLimit("workout"),
        maxBytes: videoBudget("workout").max,
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
    if (out.mode !== "transcode" || !feedCopyWorthIt(out.file.size, item.sentBytes)) return;
    item.file = out.file;
    item.source = {
      src_s: Math.round(src.video.info.duration * 10) / 10,
      src_mb: Math.round((src.video.info.bytes / 1048576) * 10) / 10,
      sel_s: Math.round((src.plan.end - src.plan.start) * 10) / 10,
    };
    // the copy is made: the clip it was made from (a fetched original is ~70 MB) can go
    item.video = undefined;
    item.load = undefined;
  }
  const file = item.file;
  const path = feedCopyPath(item.clientId, item.jobId, videoExt(file));
  if (!item.uploaded) {
    await waitForIdleSending(signal);
    try {
      await uploadLiftFileToStorage({
        file,
        userId: item.clientId,
        bucket: BUCKET,
        path,
        resume: true,
        signal,
      });
    } catch (e) {
      if (!/409|already exists|Duplicate/i.test(e instanceof Error ? e.message : String(e)))
        throw e;
    }
    item.uploaded = true;
  }
  await verifyVideoUploadFn({
    data: {
      bucket: BUCKET,
      path,
      context: "workout",
      client: {
        mode: "transcode",
        reason: "feed-copy",
        ...item.source,
        encode: true,
        ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : undefined,
      },
    },
  });
  const { data, error } = await db.rpc("set_video_feed_copy", { _id: item.setVideoId, _path: path });
  if (error) throw new Error(String(error.message ?? "Couldn't save the copy."));
  // a film already in the feed takes the copy now (one posted later is made from it)
  const completionId = (data as { completion_id?: string | null } | null)?.completion_id;
  if (completionId) {
    try {
      const { postWorkoutFilmFn } = await import("@/lib/workout-film.functions");
      await postWorkoutFilmFn({ data: { completionId, auto: true } });
    } catch {
      /* the next time the workout is open brings it up to date */
    }
  }
}

/* ---- Catch-up: copies for clips sent before this session (catch-up.ts) ---- */

/** The clip the coach got, fetched back from storage, and the copy that fits a workout post (null: none does). */
async function loadSentClip(path: string, mime: string | null): Promise<Pick<FeedSource, "video" | "plan"> | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(String(error?.message ?? "Couldn't fetch the clip."));
  const name = path.split("/").pop() ?? "clip.mov";
  const file = new File([data], name, { type: data.type || mime || "video/quicktime" });
  const probe = await probeVideo(file);
  if (!probe) return null;
  const plan = feedCopyPlan("original", probe.info, null, probe.canEncode);
  return plan ? { video: { file, info: probe.info, canEncode: probe.canEncode, trim: null }, plan } : null;
}

/**
 * On a launch: this athlete's recent set videos the film leaves out for their
 * size (sent before copies existed, or whose copy never got made) get their
 * 720p copy now, one at a time while nothing for the coach is sending, and a
 * film already in the feed picks each one up as it's recorded.
 */
export async function catchUpFeedCopies(userId: string, clips: CatchUpClip[]) {
  wireOnce();
  if (typeof window === "undefined" || typeof (window as any).VideoEncoder === "undefined") return;
  if (!(await filmGoesToCrew())) return;
  let queued = 0;
  for (const c of clips) {
    const jobId = catchUpJobId(c.client_id, c.storage_path);
    if (!jobId || !takeCatchUpLaunch(c.id)) continue;
    queued += 1;
    queueFeedCopy({
      jobId,
      setVideoId: c.id,
      clientId: c.client_id,
      sentBytes: Number(c.size_bytes) || 0,
      tries: 0,
      load: () => loadSentClip(c.storage_path, c.mime),
    });
  }
  if (!queued) markCatchUpChecked(userId);
}
