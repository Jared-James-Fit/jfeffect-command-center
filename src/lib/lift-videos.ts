import { supabase } from "@/integrations/supabase/client";

export type LiftVideoStatus =
  | "New Upload"
  | "Awaiting Review"
  | "Watched"
  | "Commented"
  | "Needs Follow-Up"
  | "Reviewed"
  | "Archived";

export type LiftVideoTag =
  | "Normal Review"
  | "Technique Question"
  | "Pain / Discomfort"
  | "Heavy Top Set"
  | "PR Attempt"
  | "Form Check"
  | "Meet Prep"
  | "Custom";

export type LiftVideo = {
  id: string;
  client_id: string;
  uploaded_by: string | null;
  exercise: string;
  training_day: string | null;
  custom_training_day: string | null;
  program_day: string | null;
  phase_id: string | null;
  important_date_id: string | null;
  date_performed: string | null;
  set_number: number | null;
  reps: number | null;
  load_text: string | null;
  rpe: number | null;
  client_notes: string | null;
  question_for_coach: string | null;
  tag: LiftVideoTag;
  custom_tag: string | null;
  is_urgent: boolean;
  video_url: string | null;
  video_storage_path: string | null;
  video_source: "link" | "upload";
  thumbnail_url: string | null;
  status: LiftVideoStatus;
  watched_at: string | null;
  watched_by: string | null;
  liked_at: string | null;
  liked_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  client_last_viewed_at: string | null;
  admin_last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LiftVideoComment = {
  id: string;
  video_id: string;
  client_id: string;
  author_id: string | null;
  author_role: "admin" | "client";
  body: string;
  video_timestamp_seconds: number | null;
  is_internal_note: boolean;
  created_at: string;
  updated_at: string;
};

export const TRAINING_DAY_OPTIONS = [
  "Day 1", "Day 2", "Day 3", "Day 4", "Day 5",
  "Upper", "Lower", "Push", "Pull", "Legs",
  "Squat Day", "Bench Day", "Deadlift Day", "SBD Day",
  "Accessory", "Custom",
];

export const LIFT_VIDEO_TAGS: LiftVideoTag[] = [
  "Normal Review", "Technique Question", "Pain / Discomfort",
  "Heavy Top Set", "PR Attempt", "Form Check", "Meet Prep", "Custom",
];

export const LIFT_VIDEO_STATUSES: LiftVideoStatus[] = [
  "New Upload", "Awaiting Review", "Watched", "Commented",
  "Needs Follow-Up", "Reviewed", "Archived",
];

const db = supabase as any;

export async function listLiftVideos(opts: { clientId?: string } = {}) {
  let q = db.from("lift_videos").select("*").order("created_at", { ascending: false });
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LiftVideo[];
}

export async function getLiftVideo(id: string) {
  const { data, error } = await db.from("lift_videos").select("*").eq("id", id).single();
  if (error) throw error;
  return data as LiftVideo;
}

export async function createLiftVideo(input: Partial<LiftVideo> & { client_id: string; uploaded_by: string | null }) {
  const row: any = {
    client_id: input.client_id,
    uploaded_by: input.uploaded_by,
    exercise: input.exercise ?? "",
    training_day: input.training_day ?? null,
    custom_training_day: input.custom_training_day ?? null,
    program_day: input.program_day ?? null,
    phase_id: input.phase_id ?? null,
    important_date_id: input.important_date_id ?? null,
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
  };
  const { data, error } = await db.from("lift_videos").insert(row).select().single();
  if (error) throw error;
  return data as LiftVideo;
}

export async function updateLiftVideo(id: string, patch: Partial<LiftVideo>) {
  const { error } = await db.from("lift_videos").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteLiftVideo(id: string) {
  const { error } = await db.from("lift_videos").delete().eq("id", id);
  if (error) throw error;
}

export async function listComments(videoId: string, opts: { includeInternal?: boolean } = {}) {
  let q = db.from("lift_video_comments").select("*").eq("video_id", videoId).order("created_at", { ascending: true });
  if (!opts.includeInternal) q = q.eq("is_internal_note", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LiftVideoComment[];
}

export async function addComment(input: {
  videoId: string;
  clientId: string;
  authorId: string | null;
  authorRole: "admin" | "client";
  body: string;
  isInternalNote?: boolean;
  videoTimestampSeconds?: number | null;
}) {
  const row: any = {
    video_id: input.videoId,
    client_id: input.clientId,
    author_id: input.authorId,
    author_role: input.authorRole,
    body: input.body,
    is_internal_note: input.isInternalNote ?? false,
    video_timestamp_seconds: input.videoTimestampSeconds ?? null,
  };
  const { data, error } = await db.from("lift_video_comments").insert(row).select().single();
  if (error) throw error;
  // Bump status if admin commented publicly
  if (input.authorRole === "admin" && !input.isInternalNote) {
    await updateLiftVideo(input.videoId, { status: "Commented" } as any);
  }
  return data as LiftVideoComment;
}

export async function markWatched(videoId: string, adminId: string | null) {
  const now = new Date().toISOString();
  await updateLiftVideo(videoId, {
    watched_at: now, watched_by: adminId, status: "Watched",
  } as any);
}

export async function toggleLike(videoId: string, adminId: string | null, liked: boolean) {
  await updateLiftVideo(videoId, {
    liked_at: liked ? new Date().toISOString() : null,
    liked_by: liked ? adminId : null,
  } as any);
}

export async function markReviewed(videoId: string, adminId: string | null) {
  const now = new Date().toISOString();
  await updateLiftVideo(videoId, {
    reviewed_at: now, reviewed_by: adminId, status: "Reviewed",
  } as any);
}

export async function setStatus(videoId: string, status: LiftVideoStatus) {
  await updateLiftVideo(videoId, { status } as any);
}

export async function uploadVideoFile(file: File, userId: string) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
  const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("lift-videos").upload(path, file, {
    contentType: file.type || "video/mp4",
    upsert: false,
  });
  if (error) throw error;
  const { data } = await supabase.storage.from("lift-videos").createSignedUrl(path, 60 * 60 * 24 * 365);
  return { path, url: data?.signedUrl ?? null };
}

export async function getSignedVideoUrl(path: string) {
  const { data, error } = await supabase.storage.from("lift-videos").createSignedUrl(path, 60 * 60 * 6);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function statusTone(s: LiftVideoStatus) {
  switch (s) {
    case "New Upload": return "border-primary/40 bg-primary/10 text-primary";
    case "Awaiting Review": return "border-warning/40 bg-warning/10 text-warning";
    case "Watched": return "border-blue-500/40 bg-blue-500/10 text-blue-600";
    case "Commented": return "border-purple-500/40 bg-purple-500/10 text-purple-600";
    case "Needs Follow-Up": return "border-destructive/40 bg-destructive/10 text-destructive";
    case "Reviewed": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
    default: return "border-border text-muted-foreground";
  }
}

export function clientFacingStatus(v: LiftVideo): string {
  if (v.reviewed_at) return "Reviewed";
  if (v.status === "Commented" || v.status === "Watched" || v.status === "Needs Follow-Up") return v.status;
  return "Awaiting Review";
}

export function isYouTube(url: string) {
  return /youtube\.com|youtu\.be/i.test(url);
}
export function isDrive(url: string) {
  return /drive\.google\.com/i.test(url);
}
export function youTubeEmbed(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}
export function drivePreview(url: string) {
  const m = url.match(/\/file\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
}