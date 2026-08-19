import { supabase } from "@/integrations/supabase/client";
import * as tus from "tus-js-client";

export type ProgressAngle = "front" | "left" | "back" | "right" | "all";
export type ProgressOwnerType = "client" | "member";
export type ProgressSubmissionType = "photo" | "video";
export type ProgressVideoFormat = "four_angle" | "continuous";
export type ProgressReviewStatus =
  | "draft" | "submitted" | "awaiting_review" | "reviewed" | "needs_update" | "self_tracking";
export type ProgressUploadStatus =
  | "draft" | "uploading" | "processing" | "ready" | "syncing_drive" | "saved_to_drive" | "upload_failed" | "sync_failed";

export type ProgressSubmission = {
  id: string;
  user_id: string;
  owner_type: ProgressOwnerType;
  client_id: string | null;
  member_id: string | null;
  assigned_coach_id: string | null;
  submission_type: ProgressSubmissionType;
  video_format: ProgressVideoFormat | null;
  submission_date: string;
  check_in_label: string | null;
  training_phase_id: string | null;
  bodyweight: number | null;
  weight_unit: "kg" | "lb" | null;
  notes: string | null;
  review_status: ProgressReviewStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProgressMedia = {
  id: string;
  submission_id: string;
  user_id: string;
  media_type: ProgressSubmissionType;
  angle: ProgressAngle;
  original_filename: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  storage_path: string | null;
  thumbnail_path: string | null;
  drive_file_id: string | null;
  drive_url: string | null;
  upload_status: ProgressUploadStatus;
  drive_sync_status: string | null;
  retry_count: number;
  processing_error: string | null;
  created_at: string;
  synced_at: string | null;
};

export type ProgressBodyweight = {
  id: string; user_id: string; logged_date: string;
  weight_value: number; weight_unit: "kg" | "lb"; note: string | null;
  created_at: string;
};

export type ProgressMeasurement = {
  id: string; user_id: string; measured_date: string;
  unit: "cm" | "in"; fields: Record<string, number | string | null>;
  note: string | null; created_at: string;
};

export type ProgressReviewResponse = {
  id: string; submission_id: string; reviewer_id: string;
  body: string; angle: ProgressAngle | null; kind: "overall" | "angle" | "internal";
  created_at: string;
};

export const PHOTO_ANGLES: ProgressAngle[] = ["front", "left", "back", "right"];
export const ANGLE_LABEL: Record<ProgressAngle, string> = {
  front: "Front", left: "Left Side", back: "Back", right: "Right Side", all: "All Angles",
};

export const CHECK_IN_LABELS = [
  "Starting Photos", "Weekly Check-In", "Monthly Progress",
  "End of Block", "Competition Prep", "Transformation Update",
];

export const MEASUREMENT_FIELDS = [
  { key: "waist", label: "Waist" },
  { key: "hips", label: "Hips" },
  { key: "chest", label: "Chest" },
  { key: "arm_l", label: "Left Arm" },
  { key: "arm_r", label: "Right Arm" },
  { key: "thigh_l", label: "Left Thigh" },
  { key: "thigh_r", label: "Right Thigh" },
  { key: "calf", label: "Calf" },
  { key: "neck", label: "Neck" },
] as const;

const db = supabase as any;

// ---------- Submissions ----------

export async function listSubmissions(opts: { userId?: string; type?: ProgressSubmissionType } = {}) {
  let q = db.from("progress_submissions").select("*").order("submission_date", { ascending: false });
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.type) q = q.eq("submission_type", opts.type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProgressSubmission[];
}

/**
 * Lightweight, paginated submissions list for the Progress Snapshot / list views.
 * Selects ONLY the fields needed to render a card — no notes, no review metadata,
 * no media. Use {@link listPrimaryThumbsForSubmissions} to fetch one thumbnail
 * per submission in a single batched query.
 */
export type ProgressSubmissionCard = Pick<
  ProgressSubmission,
  | "id"
  | "user_id"
  | "submission_type"
  | "video_format"
  | "submission_date"
  | "check_in_label"
  | "bodyweight"
  | "weight_unit"
  | "review_status"
>;

export async function listSubmissionsPaged(opts: {
  userId?: string;
  type?: ProgressSubmissionType;
  /** "awaiting" matches both submitted+awaiting_review. */
  reviewStatus?: "awaiting" | "reviewed";
  limit?: number;
  offset?: number;
}) {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 6));
  const offset = Math.max(0, opts.offset ?? 0);
  let q = db
    .from("progress_submissions")
    .select(
      "id, user_id, submission_type, video_format, submission_date, check_in_label, bodyweight, weight_unit, review_status",
    )
    .order("submission_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.type) q = q.eq("submission_type", opts.type);
  if (opts.reviewStatus === "awaiting") q = q.in("review_status", ["submitted", "awaiting_review"]);
  else if (opts.reviewStatus === "reviewed") q = q.eq("review_status", "reviewed");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProgressSubmissionCard[];
}

/**
 * One batched query that returns the primary (first ready) media row for each
 * submission id, keyed by submission_id. Replaces N+1 per-card fetches.
 * Never returns Drive URLs — list cards must not embed Drive players.
 */
export async function listPrimaryThumbsForSubmissions(submissionIds: string[]) {
  const out = new Map<string, { thumbPath: string | null; mediaType: ProgressSubmissionType }>();
  if (!submissionIds.length) return out;
  const { data, error } = await db
    .from("progress_media")
    .select("submission_id, media_type, thumbnail_path, storage_path, upload_status, created_at")
    .in("submission_id", submissionIds)
    .neq("upload_status", "draft")
    .order("created_at", { ascending: true });
  if (error) throw error;
  for (const m of (data ?? []) as any[]) {
    if (out.has(m.submission_id)) continue;
    out.set(m.submission_id, {
      thumbPath: (m.thumbnail_path as string | null) || (m.storage_path as string | null) || null,
      mediaType: m.media_type as ProgressSubmissionType,
    });
  }
  return out;
}

/** Batch sign a set of storage paths in parallel. Failed paths resolve to null. */
export async function getSignedMediaUrlsBatch(paths: string[], expiresIn = 60 * 60 * 6) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (p) => [p, await getSignedMediaUrl(p, expiresIn)] as const),
  );
  return new Map(entries);
}

export async function getSubmission(id: string) {
  const { data, error } = await db.from("progress_submissions").select("*").eq("id", id).single();
  if (error) throw error;
  return data as ProgressSubmission;
}

export async function createSubmission(input: Partial<ProgressSubmission> & {
  user_id: string; owner_type: ProgressOwnerType; submission_type: ProgressSubmissionType;
}) {
  const row: any = {
    user_id: input.user_id,
    owner_type: input.owner_type,
    client_id: input.client_id ?? null,
    member_id: input.member_id ?? null,
    assigned_coach_id: input.assigned_coach_id ?? null,
    submission_type: input.submission_type,
    video_format: input.video_format ?? null,
    submission_date: input.submission_date ?? new Date().toISOString().slice(0, 10),
    check_in_label: input.check_in_label ?? null,
    training_phase_id: input.training_phase_id ?? null,
    bodyweight: input.bodyweight ?? null,
    weight_unit: input.weight_unit ?? null,
    notes: input.notes ?? null,
    review_status: input.review_status
      ?? (input.owner_type === "client" ? "draft" : "self_tracking"),
  };
  const { data, error } = await db.from("progress_submissions").insert(row).select().single();
  if (error) throw error;
  return data as ProgressSubmission;
}

export async function updateSubmission(id: string, patch: Partial<ProgressSubmission>) {
  const { error } = await db.from("progress_submissions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteSubmission(id: string) {
  const { error } = await db.from("progress_submissions").delete().eq("id", id);
  if (error) throw error;
}

export async function submitForReview(submissionId: string) {
  const { submitProgressForReview } = await import("./progress.functions");
  await submitProgressForReview({ data: { submissionId } });
}

// ---------- Media ----------

export async function listMediaForSubmission(submissionId: string) {
  const { data, error } = await db.from("progress_media").select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProgressMedia[];
}

export async function createMedia(input: Partial<ProgressMedia> & {
  submission_id: string; user_id: string; media_type: ProgressSubmissionType; angle: ProgressAngle;
}) {
  const row: any = {
    submission_id: input.submission_id,
    user_id: input.user_id,
    media_type: input.media_type,
    angle: input.angle,
    original_filename: input.original_filename ?? null,
    file_size_bytes: input.file_size_bytes ?? null,
    mime_type: input.mime_type ?? null,
    storage_path: input.storage_path ?? null,
    thumbnail_path: input.thumbnail_path ?? null,
    upload_status: input.upload_status ?? "draft",
    drive_sync_status: input.drive_sync_status ?? "pending",
  };
  const { data, error } = await db.from("progress_media").insert(row).select().single();
  if (error) throw error;
  return data as ProgressMedia;
}

export async function updateMedia(id: string, patch: Partial<ProgressMedia>) {
  const { error } = await db.from("progress_media").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteMedia(id: string) {
  const { error } = await db.from("progress_media").delete().eq("id", id);
  if (error) throw error;
}

export async function getSignedMediaUrl(path: string, expiresIn = 60 * 60 * 6) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("progress-media").createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ---------- Upload (tus) ----------

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";

export type ProgressUploadResult = {
  path: string;
  mimeType: string;
  sizeBytes: number;
};

export async function uploadProgressFile(args: {
  file: File;
  userId: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<ProgressUploadResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Storage not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");

  const ext = (args.file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${args.userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const contentType = args.file.type || guessContentType(ext);

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(args.file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${token}`,
        "x-upsert": "false",
        apikey: SUPABASE_ANON,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: "progress-media",
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => {
        if (!args.onProgress || !total) return;
        args.onProgress(Math.max(1, Math.min(99, Math.round((sent / total) * 100))));
      },
      onSuccess: () => resolve(),
    });
    if (args.signal) {
      args.signal.addEventListener("abort", () => {
        try { void upload.abort(true); } catch { /* noop */ }
        reject(new Error("Upload cancelled."));
      });
    }
    upload.start();
  });

  return { path, mimeType: contentType, sizeBytes: args.file.size };
}

function guessContentType(ext: string) {
  switch (ext) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "heic": return "image/heic";
    case "mp4": return "video/mp4";
    case "mov": return "video/quicktime";
    case "webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

// ---------- Bodyweight ----------

export const bodyweightQueryKey = (userId: string) => ["progress-bw", userId] as const;
export const legacyBodyweightQueryKey = (clientId: string) => ["progress-metrics", clientId] as const;

export async function listBodyweight(userId: string) {
  const { data, error } = await db.from("progress_bodyweight").select("*")
    .eq("user_id", userId).order("logged_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProgressBodyweight[];
}

function assertBodyweightInput(input: {
  weight_value: number; weight_unit: "kg" | "lb"; logged_date: string;
}) {
  if (!Number.isFinite(input.weight_value) || input.weight_value <= 0) {
    throw new Error("Enter a valid bodyweight.");
  }
  if (input.weight_unit !== "kg" && input.weight_unit !== "lb") {
    throw new Error("Choose kg or lb.");
  }
  if (!input.logged_date) {
    throw new Error("Choose a date.");
  }
}

/**
 * Saves one canonical bodyweight row. The staged RPC serializes per-user/date
 * writes and updates an existing same-date row rather than inserting a duplicate.
 * Offline inserts remain queued; edit/delete fail truthfully while offline.
 */
export async function logBodyweight(input: {
  user_id: string; weight_value: number; weight_unit: "kg" | "lb"; logged_date?: string; note?: string | null;
}) {
  const row = {
    user_id: input.user_id,
    weight_value: input.weight_value,
    weight_unit: input.weight_unit,
    logged_date: input.logged_date ?? new Date().toISOString().slice(0, 10),
    note: input.note ?? null,
  };
  assertBodyweightInput(row);

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    const { enqueueOfflineWrite } = await import("@/lib/workout-offline-queue");
    enqueueOfflineWrite({
      id: `bw:${row.user_id}:${row.logged_date}`,
      label: "Bodyweight entry",
      handlerKey: "bodyweight_save",
      payload: row,
    });
    return { id: `pending-bw-${row.logged_date}`, ...row, created_at: new Date().toISOString() } as unknown as ProgressBodyweight;
  }

  const { data, error } = await db.rpc("save_progress_bodyweight", {
    p_user_id: row.user_id,
    p_weight_value: row.weight_value,
    p_weight_unit: row.weight_unit,
    p_logged_date: row.logged_date,
    p_note: row.note,
    p_entry_id: null,
  });
  if (error) throw error;
  return data as ProgressBodyweight;
}

export async function updateBodyweight(
  userId: string,
  id: string,
  patch: Pick<ProgressBodyweight, "weight_value" | "weight_unit" | "logged_date"> & { note?: string | null },
) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) throw new Error("Editing bodyweight requires a connection. Your entry was not changed.");
  assertBodyweightInput(patch);

  const { data, error } = await db.rpc("save_progress_bodyweight", {
    p_user_id: userId,
    p_weight_value: patch.weight_value,
    p_weight_unit: patch.weight_unit,
    p_logged_date: patch.logged_date,
    p_note: patch.note ?? null,
    p_entry_id: id,
  });
  if (error) throw error;
  return data as ProgressBodyweight;
}

export async function deleteBodyweight(userId: string, id: string) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) throw new Error("Deleting bodyweight requires a connection. Your entry was not removed.");

  const { error } = await db.rpc("delete_progress_bodyweight", {
    p_user_id: userId,
    p_entry_id: id,
  });
  if (error) throw error;
}

// ---------- Measurements ----------

export async function listMeasurements(userId: string) {
  const { data, error } = await db.from("progress_measurements").select("*")
    .eq("user_id", userId).order("measured_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProgressMeasurement[];
}

export async function logMeasurement(input: {
  user_id: string; unit: "cm" | "in"; fields: Record<string, number | string | null>;
  measured_date?: string; note?: string | null;
}) {
  const row = {
    user_id: input.user_id,
    unit: input.unit,
    fields: input.fields,
    measured_date: input.measured_date ?? new Date().toISOString().slice(0, 10),
    note: input.note ?? null,
  };
  const { data, error } = await db.from("progress_measurements").insert(row).select().single();
  if (error) throw error;
  return data as ProgressMeasurement;
}

export async function deleteMeasurement(id: string) {
  const { error } = await db.from("progress_measurements").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Review responses ----------

export async function listReviewResponses(submissionId: string) {
  const { data, error } = await db.from("progress_review_responses").select("*")
    .eq("submission_id", submissionId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProgressReviewResponse[];
}

export async function addReviewResponse(input: {
  submission_id: string; reviewer_id: string; body: string;
  angle?: ProgressAngle | null; kind?: "overall" | "angle" | "internal";
}) {
  const row = {
    submission_id: input.submission_id,
    reviewer_id: input.reviewer_id,
    body: input.body,
    angle: input.angle ?? null,
    kind: input.kind ?? "overall",
  };
  const { data, error } = await db.from("progress_review_responses").insert(row).select().single();
  if (error) throw error;
  // auto-mark as reviewed on overall public response
  if ((input.kind ?? "overall") !== "internal") {
    await updateSubmission(input.submission_id, {
      review_status: "reviewed",
      reviewed_at: new Date().toISOString(),
      reviewer_id: input.reviewer_id,
    } as any);
  }
  return data as ProgressReviewResponse;
}

// ---------- Stats helpers ----------

export function bodyweightStats(rows: ProgressBodyweight[]) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
  const latest = sorted[sorted.length - 1];
  const unit = latest.weight_unit;
  const inUnit = (r: ProgressBodyweight) =>
    r.weight_unit === unit ? r.weight_value
      : r.weight_unit === "kg" ? +(r.weight_value * 2.20462).toFixed(2)
      : +(r.weight_value / 2.20462).toFixed(2);
  const last7 = sorted.slice(-7);
  const avg7 = last7.length ? last7.reduce((s, r) => s + inUnit(r), 0) / last7.length : null;
  const startWeight = inUnit(sorted[0]);
  const change = inUnit(latest) - startWeight;
  return {
    latest: inUnit(latest), latestDate: latest.logged_date, unit,
    avg7: avg7 != null ? +avg7.toFixed(2) : null,
    change: +change.toFixed(2), startWeight, count: rows.length,
  };
}

export function formatAngleLabel(a: ProgressAngle) { return ANGLE_LABEL[a]; }
