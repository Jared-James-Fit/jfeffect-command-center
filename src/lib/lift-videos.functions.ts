import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    const { data: client, error: clientError } = await (supabaseAdmin as any)
      .from("clients")
      .select("id,user_id")
      .eq("id", data.client_id)
      .maybeSingle();

    if (clientError) throw clientError;
    if (!client || client.user_id !== context.userId) {
      throw new Error("You can only submit lift videos for your own client profile.");
    }

    const row = {
      client_id: data.client_id,
      uploaded_by: context.userId,
      exercise: data.exercise ?? "",
      training_day: data.training_day ?? null,
      custom_training_day: data.custom_training_day ?? null,
      program_day: data.program_day ?? null,
      date_performed: data.date_performed ?? null,
      set_number: data.set_number ?? null,
      reps: data.reps ?? null,
      load_text: data.load_text ?? null,
      rpe: data.rpe ?? null,
      client_notes: data.client_notes ?? null,
      question_for_coach: data.question_for_coach ?? null,
      tag: data.tag ?? "Normal Review",
      custom_tag: data.custom_tag ?? null,
      is_urgent: data.is_urgent ?? false,
      video_url: data.video_url ?? null,
      video_storage_path: data.video_storage_path ?? null,
      video_source: data.video_source ?? "link",
      thumbnail_url: data.thumbnail_url ?? null,
      status: data.status ?? "New Upload",
      batch_id: data.batch_id ?? null,
      batch_note: data.batch_note ?? null,
      batch_size: data.batch_size ?? null,
      batch_index: data.batch_index ?? null,
    };

    const { data: created, error } = await (supabaseAdmin as any)
      .from("lift_videos")
      .insert(row)
      .select("*")
      .single();

    if (error) throw error;
    return created;
  });