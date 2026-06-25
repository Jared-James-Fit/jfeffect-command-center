import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const DRAFT_TYPES = [
  "content_idea","hook","script","caption","carousel","story_sequence",
  "email","advertisement","youtube_outline","offer","other",
] as const;
export type DraftType = typeof DRAFT_TYPES[number];
export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  content_idea: "Content Idea", hook: "Hook", script: "Script", caption: "Caption",
  carousel: "Carousel", story_sequence: "Story Sequence", email: "Email",
  advertisement: "Advertisement", youtube_outline: "YouTube Outline",
  offer: "Offer", other: "Other",
};

export const DRAFT_STATUSES = ["draft","in_review","approved","converted","archived"] as const;
export type DraftStatus = typeof DRAFT_STATUSES[number];
export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "Draft", in_review: "In Review", approved: "Approved",
  converted: "Converted", archived: "Archived",
};

export type Draft = {
  id: string;
  title: string;
  draft_type: DraftType | string;
  platform: string | null;
  content_pillar: string | null;
  campaign: string | null;
  hook: string | null;
  body: string | null;
  caption: string | null;
  cta: string | null;
  notes: string | null;
  reference_links: any[];
  linked_asset_ids: string[];
  assignee: string | null;
  status: DraftStatus | string;
  is_archived: boolean;
  archived_at: string | null;
  converted_content_id: string | null;
  current_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listDrafts(opts?: { archived?: boolean }): Promise<Draft[]> {
  const { data, error } = await sb
    .from("media_drafts").select("*")
    .eq("is_archived", opts?.archived ?? false)
    .order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function getDraft(id: string): Promise<Draft | null> {
  const { data, error } = await sb.from("media_drafts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createDraft(input: Partial<Draft>): Promise<Draft> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await sb.from("media_drafts").insert({
    title: input.title ?? "Untitled draft",
    draft_type: input.draft_type ?? "other",
    status: input.status ?? "draft",
    reference_links: input.reference_links ?? [],
    linked_asset_ids: input.linked_asset_ids ?? [],
    created_by: u.user?.id ?? null,
    ...input,
  }).select("*").single();
  if (error) throw error;
  return data as Draft;
}

export async function patchDraft(id: string, patch: Partial<Draft>) {
  const { error } = await sb.from("media_drafts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDraft(id: string) {
  const { error } = await sb.from("media_drafts").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateDraft(id: string): Promise<Draft> {
  const src = await getDraft(id);
  if (!src) throw new Error("Draft not found");
  const { id: _i, created_at: _c, updated_at: _u, current_version: _v, converted_content_id: _cc, ...rest } = src;
  return createDraft({ ...rest, title: `${src.title} (copy)`, status: "draft", is_archived: false });
}

export async function archiveDraft(id: string, archived = true) {
  await patchDraft(id, {
    is_archived: archived,
    archived_at: archived ? new Date().toISOString() : null,
    status: archived ? "archived" : "draft",
  } as any);
}

export async function snapshotVersion(draft: Draft) {
  const { data: u } = await supabase.auth.getUser();
  const next = (draft.current_version ?? 1) + 1;
  await sb.from("media_draft_versions").insert({
    draft_id: draft.id, version: next, snapshot: draft,
    created_by: u.user?.id ?? null,
  });
  await patchDraft(draft.id, { current_version: next } as any);
}

export async function listDraftVersions(draftId: string) {
  const { data, error } = await sb.from("media_draft_versions")
    .select("*").eq("draft_id", draftId).order("version", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Map a draft into a new shared content record. */
export async function convertDraftToContent(draftId: string): Promise<string> {
  const d = await getDraft(draftId);
  if (!d) throw new Error("Draft not found");
  const { createContent } = await import("@/lib/media-content");
  const created = await createContent({
    title: d.title,
    description: d.notes ?? null,
    platform: d.platform,
    pillar: d.content_pillar,
    hook: d.hook,
    script: d.body,
    caption: d.caption,
    cta: d.cta,
    reference_links: d.reference_links ?? [],
    linked_asset_ids: d.linked_asset_ids ?? [],
    assignee_id: d.assignee,
    content_type: d.draft_type,
    internal_notes: d.notes,
  } as any);
  await patchDraft(d.id, { status: "converted", converted_content_id: created.id } as any);
  return created.id;
}

export async function submitDraftForReview(id: string) {
  await patchDraft(id, { status: "in_review" } as any);
}