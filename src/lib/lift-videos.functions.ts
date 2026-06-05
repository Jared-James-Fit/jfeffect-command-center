import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOwnedClientLiftVideo } from "./lift-videos.server";

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
    return createOwnedClientLiftVideo(data, context.userId);
  });