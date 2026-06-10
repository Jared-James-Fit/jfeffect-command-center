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
  original_drive_file_id?: string | null;
  original_drive_url?: string | null;
  drive_embed_url?: string | null;
  preview_url?: string | null;
  preview_status?: string | null;
  preview_error?: string | null;
  file_type?: string | null;
  file_size_bytes?: number | null;
  upload_status?: string | null;
  playback_error?: string | null;
  status?: string;
  batch_id?: string | null;
  batch_note?: string | null;
  batch_size?: number | null;
  batch_index?: number | null;
  archive_status?: string | null;
  archive_next_attempt_at?: string | null;
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
      original_drive_file_id: input.original_drive_file_id ?? null,
      original_drive_url: input.original_drive_url ?? null,
      drive_embed_url: input.drive_embed_url ?? null,
      preview_url: input.preview_url ?? null,
      preview_status: input.preview_status ?? "not_generated",
      preview_error: input.preview_error ?? null,
      file_type: input.file_type ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      upload_status: input.upload_status ?? "Submitted",
      playback_error: input.playback_error ?? null,
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

export async function updateOwnedClientLiftVideo(
  id: string,
  patch: Partial<ClientLiftVideoRow>,
  userId: string,
) {
  // Confirm ownership: only the original uploader may patch the row.
  const { data: existing, error: lookupError } = await (supabaseAdmin as any)
    .from("lift_videos")
    .select("id, uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) throw new Error("Lift video not found.");
  if (existing.uploaded_by !== userId) {
    throw new Error("You can only update lift videos you submitted.");
  }

  const allowed: Record<string, unknown> = {};
  const keys: (keyof ClientLiftVideoRow)[] = [
    "video_url", "video_source", "thumbnail_url",
    "original_drive_file_id", "original_drive_url", "drive_embed_url",
    "file_type", "file_size_bytes",
    "upload_status", "playback_error", "status",
    "video_storage_path", "preview_status",
  ];
  for (const k of keys) {
    if (k in patch) allowed[k as string] = (patch as any)[k];
  }
  // Archive-tracking fields written by the client upload queue when an
  // upload completes (so the cron worker picks the row up).
  for (const k of ["archive_status", "archive_next_attempt_at"] as const) {
    if (k in (patch as any)) allowed[k] = (patch as any)[k];
  }
  if (Object.keys(allowed).length === 0) return existing;

  const { data: updated, error } = await (supabaseAdmin as any)
    .from("lift_videos")
    .update(allowed)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return updated;
}