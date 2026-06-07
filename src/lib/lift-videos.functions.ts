import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const nullableString = z.string().max(2000).nullable().optional();
const nullableNumber = z.number().nullable().optional();

const ClientLiftVideoInput = z.object({
  client_id: z.string().uuid(),
  exercise: z.string().max(255).optional(),
  training_day: nullableString,
  custom_training_day: nullableString,
  program_day: nullableString,
  date_performed: nullableString,
  set_number: nullableNumber,
  reps: nullableNumber,
  load_text: nullableString,
  rpe: nullableNumber,
  client_notes: nullableString,
  question_for_coach: nullableString,
  tag: z.string().max(100).optional(),
  custom_tag: nullableString,
  is_urgent: z.boolean().optional(),
  video_url: nullableString,
  video_storage_path: nullableString,
  video_source: z.enum(["link", "upload"]).optional(),
  thumbnail_url: nullableString,
  original_drive_file_id: z.string().max(200).nullable().optional(),
  original_drive_url: z.string().max(1000).nullable().optional(),
  drive_embed_url: z.string().max(1000).nullable().optional(),
  preview_url: z.string().max(1000).nullable().optional(),
  preview_status: z.string().max(100).nullable().optional(),
  preview_error: nullableString,
  file_type: z.string().max(200).nullable().optional(),
  file_size_bytes: z.number().int().min(0).nullable().optional(),
  upload_status: z.string().max(100).nullable().optional(),
  playback_error: nullableString,
  status: z.string().max(100).optional(),
  batch_id: z.string().uuid().nullable().optional(),
  batch_note: nullableString,
  batch_size: z.number().int().min(1).nullable().optional(),
  batch_index: z.number().int().min(1).nullable().optional(),
});

export const createClientLiftVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ClientLiftVideoInput.parse(data))
  .handler(async ({ data, context }) => {
    const { createOwnedClientLiftVideo } = await import("./lift-videos.server");
    return createOwnedClientLiftVideo(data, context.userId);
  });

function fileIdFromUrl(url: string | null | undefined) {
  if (!url) return null;
  return url.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]
    ?? url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1]
    ?? null;
}

export const refreshLiftVideoDriveDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ videoId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase.from("user_roles" as any).select("role").eq("user_id", context.userId);
    if (!roles?.some((r: any) => r.role === "admin")) throw new Error("Admin only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { driveGetFile, driveShareAnyoneReader, driveEmbedUrl, driveViewUrl } = await import("./drive.server");
    const { data: video, error } = await (supabaseAdmin as any)
      .from("lift_videos")
      .select("id, video_url, original_drive_file_id, original_drive_url, drive_embed_url, preview_url, preview_status")
      .eq("id", data.videoId)
      .single();
    if (error) throw error;

    const fileId = video.original_drive_file_id
      ?? fileIdFromUrl(video.original_drive_url)
      ?? fileIdFromUrl(video.drive_embed_url)
      ?? fileIdFromUrl(video.video_url);

    if (!fileId) {
      await (supabaseAdmin as any).from("lift_videos").update({ playback_error: "Missing original Drive file ID." }).eq("id", data.videoId);
      return { ok: false, reason: "Missing original Drive file ID." };
    }

    try {
      const meta = await driveGetFile(fileId);
      await driveShareAnyoneReader(fileId);
      const patch = {
        original_drive_file_id: fileId,
        original_drive_url: meta.webViewLink ?? driveViewUrl(fileId),
        drive_embed_url: driveEmbedUrl(fileId),
        thumbnail_url: meta.thumbnailLink ?? null,
        file_type: meta.mimeType ?? null,
        file_size_bytes: meta.size ? Number(meta.size) : null,
        upload_status: "Drive verified",
        playback_error: null,
        preview_status: video.preview_url ? "ready" : (video.preview_status ?? "not_generated"),
      };
      await (supabaseAdmin as any).from("lift_videos").update(patch).eq("id", data.videoId);
      return { ok: true, fileId, driveUrl: patch.original_drive_url, mimeType: patch.file_type, sizeBytes: patch.file_size_bytes };
    } catch (err: any) {
      const reason = err?.message?.includes("404")
        ? "File not found or inaccessible to the Drive connection."
        : err?.message?.includes("403")
          ? "Drive permission issue."
          : err?.message ?? "Unknown Drive error.";
      await (supabaseAdmin as any).from("lift_videos").update({ playback_error: reason, upload_status: "Drive check failed" }).eq("id", data.videoId);
      return { ok: false, fileId, reason };
    }
  });