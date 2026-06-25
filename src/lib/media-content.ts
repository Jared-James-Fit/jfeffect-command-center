import { supabase } from "@/integrations/supabase/client";

export type ProductionStatus =
  | "idea" | "scripting" | "ready_to_film" | "filmed" | "editing"
  | "review" | "approved" | "scheduled" | "published" | "blocked";
export const PRODUCTION_STAGES: ProductionStatus[] = [
  "idea","scripting","ready_to_film","filmed","editing","review","approved","scheduled","published","blocked",
];
export const STAGE_LABELS: Record<ProductionStatus, string> = {
  idea: "Idea", scripting: "Scripting", ready_to_film: "Ready to Film",
  filmed: "Filmed", editing: "Editing", review: "Review", approved: "Approved",
  scheduled: "Scheduled", published: "Published", blocked: "Blocked",
};

export type ApprovalStatus =
  | "not_submitted" | "awaiting_review" | "changes_requested" | "approved";
export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  not_submitted: "Not Submitted",
  awaiting_review: "Awaiting Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Low", 2: "Normal", 3: "High", 4: "Urgent",
};

export type ContentRecord = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  content_type: string | null;
  platform: string | null;
  production_status: ProductionStatus | string;
  approval_status: ApprovalStatus | string;
  campaign_id: string | null;
  pillar: string | null;
  assignee_id: string | null;
  reviewer_id: string | null;
  priority: number;
  due_date: string | null;
  publish_date: string | null;
  publish_time: string | null;
  hook: string | null;
  script: string | null;
  caption: string | null;
  cta: string | null;
  internal_notes: string | null;
  reference_links: any[];
  linked_asset_ids: any[];
  linked_task_ids: any[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  archived: boolean;
  submitted_by: string | null;
  submitted_at: string | null;
  submitted_version: number | null;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  current_version: number;
  last_change_request: string | null;
  last_change_requested_by: string | null;
  last_change_requested_at: string | null;
};

const sb = supabase as any;

export async function fetchContent(id: string): Promise<ContentRecord | null> {
  const { data, error } = await sb.from("media_content_records").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listContent(opts?: { archived?: boolean; statuses?: string[]; limit?: number }) {
  let q = sb.from("media_content_records").select("*").eq("archived", opts?.archived ?? false);
  if (opts?.statuses?.length) q = q.in("production_status", opts.statuses);
  q = q.order("updated_at", { ascending: false }).limit(opts?.limit ?? 500);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ContentRecord[];
}

export async function patchContent(id: string, patch: Partial<ContentRecord>) {
  const { error } = await sb.from("media_content_records").update(patch).eq("id", id);
  if (error) throw error;
}

export async function createContent(input: Partial<ContentRecord>) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await sb.from("media_content_records").insert({
    title: input.title ?? "Untitled",
    description: input.description ?? null,
    production_status: input.production_status ?? "idea",
    approval_status: input.approval_status ?? "not_submitted",
    priority: input.priority ?? 2,
    reference_links: input.reference_links ?? [],
    linked_asset_ids: input.linked_asset_ids ?? [],
    linked_task_ids: input.linked_task_ids ?? [],
    created_by: userData.user?.id ?? null,
    ...input,
  }).select("*").single();
  if (error) throw error;
  return data as ContentRecord;
}

export async function deleteContent(id: string) {
  const { error } = await sb.from("media_content_records").delete().eq("id", id);
  if (error) throw error;
}

export async function archiveContent(ids: string[], archived = true) {
  const { error } = await sb.from("media_content_records")
    .update({ archived, archived_at: archived ? new Date().toISOString() : null })
    .in("id", ids);
  if (error) throw error;
}

async function insertReviewEvent(content_id: string, kind: string, notes?: string | null, version?: number | null) {
  const { data: userData } = await supabase.auth.getUser();
  await sb.from("media_content_review_events").insert({
    content_id, kind, notes: notes ?? null, version: version ?? null,
    actor_id: userData.user?.id ?? null,
  });
}

async function notify(user_id: string | null, kind: string, source_id: string) {
  if (!user_id) return;
  await sb.from("notification_state").insert({ user_id, kind, source_id });
}

export async function submitForReview(id: string) {
  const rec = await fetchContent(id);
  if (!rec) throw new Error("Content not found");
  const version = rec.current_version ?? 1;
  const { data: userData } = await supabase.auth.getUser();
  await patchContent(id, {
    approval_status: "awaiting_review",
    submitted_by: userData.user?.id ?? null,
    submitted_at: new Date().toISOString(),
    submitted_version: version,
    production_status: rec.production_status === "approved" || rec.production_status === "published"
      ? rec.production_status : "review",
  } as any);
  await insertReviewEvent(id, "submitted", null, version);
  await notify(rec.reviewer_id, "media_content_submitted", id);
}

export async function requestChanges(id: string, notes: string) {
  if (!notes.trim()) throw new Error("Explanation required");
  const rec = await fetchContent(id);
  if (!rec) throw new Error("Content not found");
  const { data: userData } = await supabase.auth.getUser();
  const nextVersion = (rec.current_version ?? 1) + 1;
  await patchContent(id, {
    approval_status: "changes_requested",
    last_change_request: notes,
    last_change_requested_by: userData.user?.id ?? null,
    last_change_requested_at: new Date().toISOString(),
    current_version: nextVersion,
    production_status: "editing",
  } as any);
  await insertReviewEvent(id, "changes_requested", notes, rec.submitted_version);
  await notify(rec.assignee_id, "media_content_changes_requested", id);
}

export async function approveContent(id: string, notes?: string) {
  const rec = await fetchContent(id);
  if (!rec) throw new Error("Content not found");
  const { data: userData } = await supabase.auth.getUser();
  await patchContent(id, {
    approval_status: "approved",
    approved_by: userData.user?.id ?? null,
    approved_at: new Date().toISOString(),
    approved_version: rec.submitted_version ?? rec.current_version,
    production_status: rec.production_status === "published" ? "published" : "approved",
  } as any);
  await insertReviewEvent(id, "approved", notes ?? null, rec.submitted_version);
  await notify(rec.assignee_id, "media_content_approved", id);
}

export async function markPublished(id: string) {
  await patchContent(id, {
    production_status: "published",
    published_at: new Date().toISOString(),
  } as any);
  await insertReviewEvent(id, "published");
}

export async function returnToEditing(id: string) {
  await patchContent(id, {
    production_status: "editing",
    approval_status: "not_submitted",
  } as any);
  await insertReviewEvent(id, "reopened");
}

export async function schedulePublish(id: string, date: string, time?: string | null) {
  await patchContent(id, {
    production_status: "scheduled",
    publish_date: date,
    publish_time: time ?? null,
  } as any);
  await insertReviewEvent(id, "scheduled");
}

export async function addComment(content_id: string, body: string, version?: number | null) {
  if (!body.trim()) return;
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await sb.from("media_content_comments").insert({
    content_id, body, version: version ?? null, author_id: userData.user?.id ?? null,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function listComments(content_id: string) {
  const { data, error } = await sb.from("media_content_comments")
    .select("*").eq("content_id", content_id).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listReviewHistory(content_id: string) {
  const { data, error } = await sb.from("media_content_review_events")
    .select("*").eq("content_id", content_id).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function readinessChecklist(c: ContentRecord) {
  return [
    { key: "approved", label: "Approved", ok: c.approval_status === "approved" },
    { key: "final_asset", label: "Final asset attached",
      ok: Array.isArray(c.linked_asset_ids) && c.linked_asset_ids.length > 0 },
    { key: "caption", label: "Caption complete", ok: !!c.caption?.trim() },
    { key: "cta", label: "CTA complete", ok: !!c.cta?.trim() },
    { key: "platform", label: "Platform selected", ok: !!c.platform },
    { key: "publish_date", label: "Publish date set", ok: !!c.publish_date },
    { key: "publish_time", label: "Publish time set", ok: !!c.publish_time },
  ];
}