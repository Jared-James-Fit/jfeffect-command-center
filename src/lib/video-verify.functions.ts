/**
 * The server's own look at an uploaded video, before anything can publish it.
 *
 * The phone trims and shrinks a clip before it uploads, but nothing a phone
 * says about a file can be trusted: this re-reads the stored file's header
 * (its real length, size and picture) and records it in media_video_checks.
 * The database then refuses a post, comment or message whose video is longer
 * or bigger than its place allows (media_video_allowed, called by triggers on
 * every table that holds one). Only the person who uploaded a file can have
 * it checked, and a file that's replaced after its check no longer passes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VIDEO_LIMITS, videoBudget, limitWords, type VideoContext } from "@/lib/video-edit/limits";

const BUCKETS = ["community-media", "message-attachments", "progress-media", "form-uploads", "broadcast-media"] as const;

const Input = z.object({
  bucket: z.enum(BUCKETS),
  path: z.string().min(3).max(512),
  context: z.enum(Object.keys(VIDEO_LIMITS) as [VideoContext, ...VideoContext[]]),
  /** What the phone did, for diagnosing real devices (never shown to anyone). */
  client: z
    .object({
      mode: z.string().max(20).optional(),
      reason: z.string().max(140).optional(),
      src_s: z.number().nonnegative().optional(),
      src_mb: z.number().nonnegative().optional(),
      sel_s: z.number().nonnegative().optional(),
      prep_ms: z.number().nonnegative().optional(),
      up_ms: z.number().nonnegative().optional(),
      encode: z.boolean().optional(),
      ua: z.string().max(160).optional(),
    })
    .partial()
    .optional(),
});

export type VideoCheck = { duration: number; width: number | null; height: number | null; codec: string | null; bytes: number };

/** Seconds a published video may run over its limit (container rounding, audio priming). */
const TOLERANCE_S = 1.5;

export const verifyVideoUploadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<VideoCheck> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: obj, error: objErr } = await db.rpc("media_video_object", { _bucket: data.bucket, _path: data.path });
    if (objErr) throw new Error("Couldn't check that video. Try again.");
    if (!obj) throw new Error("That upload didn't finish. Try again.");
    if (obj.owner !== userId) throw new Error("You can only post videos you uploaded.");

    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(data.bucket).createSignedUrl(data.path, 300);
    if (signErr || !signed?.signedUrl) throw new Error("Couldn't check that video. Try again.");

    // Only the header is read (a few ranged requests), never the whole file.
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.UrlSource(signed.signedUrl, { getRetryDelay: (n: number) => (n < 3 ? 500 * n : null) }), formats: mb.ALL_FORMATS });
    let check: VideoCheck;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("no video track");
      const duration = await input.computeDuration();
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("no duration");
      check = { duration, width: track.displayWidth || null, height: track.displayHeight || null, codec: track.codec ?? null, bytes: Number(obj.bytes) || 0 };
    } catch {
      throw new Error("Couldn't read that video. Try an MP4 or MOV clip.");
    } finally {
      input.dispose?.();
    }

    const { error: insErr } = await db.from("media_video_checks").upsert(
      {
        bucket: data.bucket,
        path: data.path,
        object_id: obj.id,
        owner: userId,
        duration_s: Math.round(check.duration * 1000) / 1000,
        width: check.width,
        height: check.height,
        video_codec: check.codec,
        bytes: check.bytes,
        mime: obj.mime ?? null,
        context: data.context,
        client: data.client ?? null,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "bucket,path" },
    );
    if (insErr) throw new Error("Couldn't check that video. Try again.");

    // Over its limit here: say so now (the database would refuse it at Post anyway).
    const limit = VIDEO_LIMITS[data.context].seconds;
    if (check.duration > limit + TOLERANCE_S) throw new Error(`${VIDEO_LIMITS[data.context].label} can be up to ${limitWords(limit)}. Trim it and try again.`);
    if (check.bytes > videoBudget(data.context).max) throw new Error("That video is too big to send. Trim it shorter.");
    return check;
  });
