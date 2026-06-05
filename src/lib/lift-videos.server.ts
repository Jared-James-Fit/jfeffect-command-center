import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ClientLiftVideoRow = {
  client_id: string;
  exercise?: string;
  training_day?: string | null;
  custom_training_day?: string | null;
  program_day?: string | null;
  date_performed?: string | null;
  set_number?: number | null;
  reps?: number | null;
  load_text?: string | null;
  rpe?: number | null;
  client_notes?: string | null;
  question_for_coach?: string | null;
  tag?: string;
  custom_tag?: string | null;
  is_urgent?: boolean;
  video_url?: string | null;
  video_storage_path?: string | null;
  video_source?: "link" | "upload";
  thumbnail_url?: string | null;
  status?: string;
  batch_id?: string | null;
  batch_note?: string | null;
  batch_size?: number | null;
  batch_index?: number | null;
};

export async function createOwnedClientLiftVideo(input: ClientLiftVideoRow, userId: string) {
  const { data: client, error: clientError } = await (supabaseAdmin as any)
    .from("clients")
    .select("id,user_id")
    .eq("id", input.client_id)
    .maybeSingle();

  if (clientError) throw clientError;
  if (!client || client.user_id !== userId) {
    throw new Error("You can only submit lift videos for your own client profile.");
  }

  const { data: created, error } = await (supabaseAdmin as any)
    .from("lift_videos")
    .insert({
      client_id: input.client_id,
      uploaded_by: userId,
      exercise: input.exercise ?? "",
      training_day: input.training_day ?? null,
      custom_training_day: input.custom_training_day ?? null,
      program_day: input.program_day ?? null,
      date_performed: input.date_performed ?? null,
      set_number: input.set_number ?? null,
      reps: input.reps ?? null,
      load_text: input.load_text ?? null,
      rpe: input.rpe ?? null,
      client_notes: input.client_notes ?? null,
      question_for_coach: input.question_for_coach ?? null,
      tag: input.tag ?? "Normal Review",
      custom_tag: input.custom_tag ?? null,
      is_urgent: input.is_urgent ?? false,
      video_url: input.video_url ?? null,
      video_storage_path: input.video_storage_path ?? null,
      video_source: input.video_source ?? "link",
      thumbnail_url: input.thumbnail_url ?? null,
      status: input.status ?? "New Upload",
      batch_id: input.batch_id ?? null,
      batch_note: input.batch_note ?? null,
      batch_size: input.batch_size ?? null,
      batch_index: input.batch_index ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return created;
}