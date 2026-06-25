import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const TEMPLATE_CATEGORIES = [
  "logos","brand_colours","font_references","brand_voice","ctas","offers",
  "bio_options","hook_templates","caption_templates","reel_structures",
  "story_templates","testimonial_templates","transformation_templates",
  "email_templates","youtube_templates","thumbnail_guidance","content_pillars",
] as const;
export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  logos: "Logos",
  brand_colours: "Brand Colours",
  font_references: "Font References",
  brand_voice: "Brand Voice",
  ctas: "CTAs",
  offers: "Offers",
  bio_options: "Bio Options",
  hook_templates: "Hook Templates",
  caption_templates: "Caption Templates",
  reel_structures: "Reel Structures",
  story_templates: "Story Templates",
  testimonial_templates: "Testimonial Templates",
  transformation_templates: "Transformation Templates",
  email_templates: "Email Templates",
  youtube_templates: "YouTube Templates",
  thumbnail_guidance: "Thumbnail Guidance",
  content_pillars: "Content Pillars",
};

export type Template = {
  id: string;
  category: TemplateCategory | string;
  title: string;
  body: string | null;
  metadata: Record<string, any>;
  tags: string[];
  is_archived: boolean;
  archived_at: string | null;
  attached_campaign: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listTemplates(opts?: { archived?: boolean }): Promise<Template[]> {
  const { data, error } = await sb.from("media_templates").select("*")
    .eq("is_archived", opts?.archived ?? false)
    .order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function createTemplate(input: Partial<Template>): Promise<Template> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await sb.from("media_templates").insert({
    category: input.category ?? "caption_templates",
    title: input.title ?? "Untitled template",
    body: input.body ?? null,
    metadata: input.metadata ?? {},
    tags: input.tags ?? [],
    created_by: u.user?.id ?? null,
    ...input,
  }).select("*").single();
  if (error) throw error;
  return data as Template;
}

export async function patchTemplate(id: string, patch: Partial<Template>) {
  const { error } = await sb.from("media_templates").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTemplate(id: string) {
  const { error } = await sb.from("media_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateTemplate(id: string): Promise<Template> {
  const cur = await sb.from("media_templates").select("*").eq("id", id).single();
  if (cur.error) throw cur.error;
  const { id: _i, created_at: _c, updated_at: _u, ...rest } = cur.data;
  return createTemplate({ ...rest, title: `${cur.data.title} (copy)`, is_archived: false });
}

export async function archiveTemplate(id: string, archived = true) {
  await patchTemplate(id, {
    is_archived: archived,
    archived_at: archived ? new Date().toISOString() : null,
  } as any);
}

export async function convertTemplateToDraft(id: string): Promise<string> {
  const cur = await sb.from("media_templates").select("*").eq("id", id).single();
  if (cur.error || !cur.data) throw cur.error ?? new Error("Not found");
  const t = cur.data as Template;
  const { createDraft } = await import("@/lib/media-drafts");
  const draftType = t.category === "hook_templates" ? "hook"
    : t.category === "caption_templates" ? "caption"
    : t.category === "email_templates" ? "email"
    : t.category === "youtube_templates" ? "youtube_outline"
    : t.category === "offers" ? "offer"
    : t.category === "reel_structures" ? "script"
    : "other";
  const d = await createDraft({
    title: `${t.title}`,
    draft_type: draftType as any,
    body: t.body,
    notes: `From template: ${t.title}`,
  });
  return d.id;
}