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