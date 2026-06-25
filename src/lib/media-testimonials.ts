import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const TESTIMONIAL_TYPES = [
  "written","video","audio","screenshot","transformation","case_study",
] as const;
export type TestimonialType = typeof TESTIMONIAL_TYPES[number];
export const TESTIMONIAL_TYPE_LABELS: Record<TestimonialType, string> = {
  written: "Written", video: "Video", audio: "Audio",
  screenshot: "Screenshot", transformation: "Transformation", case_study: "Case Study",
};

export const PERMISSION_STATUSES = [
  "permission_needed","requested","approved","restricted","declined",
] as const;
export type PermissionStatus = typeof PERMISSION_STATUSES[number];
export const PERMISSION_LABELS: Record<PermissionStatus, string> = {
  permission_needed: "Permission Needed", requested: "Requested",
  approved: "Approved", restricted: "Restricted", declined: "Declined",
};

export const VISIBILITY_OPTIONS = ["private","team","marketing","public"] as const;

export type Testimonial = {
  id: string;
  client_name: string;
  testimonial_type: TestimonialType | string;
  headline: string | null;
  quote: string | null;
  result: string | null;
  before_measurement: string | null;
  after_measurement: string | null;
  timeframe: string | null;
  date_received: string | null;
  source: string | null;
  media_resource_ids: string[];
  permission_status: PermissionStatus | string;
  permission_notes: string | null;
  visibility: string;
  tags: string[];
  campaign: string | null;
  connected_page: string | null;
  notes: string | null;
  is_archived: boolean;
  archived_at: string | null;
  converted_content_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listTestimonials(opts?: { archived?: boolean }): Promise<Testimonial[]> {
  const { data, error } = await sb.from("media_testimonials").select("*")
    .eq("is_archived", opts?.archived ?? false)
    .order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function createTestimonial(input: Partial<Testimonial>): Promise<Testimonial> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await sb.from("media_testimonials").insert({
    client_name: input.client_name ?? "New testimonial",
    testimonial_type: input.testimonial_type ?? "written",
    permission_status: input.permission_status ?? "permission_needed",
    visibility: input.visibility ?? "private",
    media_resource_ids: input.media_resource_ids ?? [],
    tags: input.tags ?? [],
    created_by: u.user?.id ?? null,
    ...input,
  }).select("*").single();
  if (error) throw error;
  return data as Testimonial;
}

export async function patchTestimonial(id: string, patch: Partial<Testimonial>) {
  const { error } = await sb.from("media_testimonials").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTestimonial(id: string) {
  const { error } = await sb.from("media_testimonials").delete().eq("id", id);
  if (error) throw error;
}

export async function archiveTestimonial(id: string, archived = true) {
  await patchTestimonial(id, {
    is_archived: archived,
    archived_at: archived ? new Date().toISOString() : null,
  } as any);
}

export async function uploadTestimonialMedia(testimonialId: string, file: File): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("Not signed in");
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `testimonials/${testimonialId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from("media-resource-library").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || undefined,
  });
  if (up.error) throw up.error;
  const kind = file.type.startsWith("image/") ? "image"
    : file.type.startsWith("video/") ? "video"
    : file.type.startsWith("audio/") ? "audio" : "file";
  const insert = await sb.from("media_resources").insert({
    name: file.name, storage_path: path, mime_type: file.type, size: file.size,
    kind, source: "upload", created_by: userId, visibility: "private",
  }).select("id").single();
  if (insert.error) throw insert.error;
  const resourceId: string = insert.data.id;
  const cur = await sb.from("media_testimonials").select("media_resource_ids").eq("id", testimonialId).single();
  const arr: string[] = Array.isArray(cur.data?.media_resource_ids) ? cur.data.media_resource_ids : [];
  await patchTestimonial(testimonialId, { media_resource_ids: [...arr, resourceId] } as any);
  return resourceId;
}

export async function convertTestimonialToContent(id: string): Promise<string> {
  const cur = await sb.from("media_testimonials").select("*").eq("id", id).single();
  if (cur.error || !cur.data) throw cur.error ?? new Error("Not found");
  const t = cur.data as Testimonial;
  const { createContent } = await import("@/lib/media-content");
  const created = await createContent({
    title: t.headline ? `${t.client_name} — ${t.headline}` : `${t.client_name} testimonial`,
    description: t.quote ?? null,
    platform: null,
    pillar: null,
    hook: t.headline,
    caption: t.quote,
    cta: null,
    content_type: `testimonial:${t.testimonial_type}`,
    linked_asset_ids: t.media_resource_ids ?? [],
    internal_notes: t.notes,
  } as any);
  await patchTestimonial(id, { converted_content_id: created.id } as any);
  return created.id;
}