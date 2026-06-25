import { supabase } from "@/integrations/supabase/client";

export type SearchHit = {
  id: string;
  kind:
    | "content"
    | "task"
    | "note"
    | "draft"
    | "campaign"
    | "asset"
    | "page"
    | "testimonial"
    | "person";
  title: string;
  subtitle?: string | null;
  to: string;
};

const PAGE = 5;

/** Debounced, parallel multi-source search across the Media Manager. */
export async function searchMediaWorkspace(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const db: any = supabase;

  const [content, tasks, notes, drafts, campaigns, assets, pages, testimonials, profiles] =
    await Promise.all([
      db
        .from("media_content_records")
        .select("id,title,description,hook,script,caption,content_type,platform")
        .or(
          `title.ilike.${like},description.ilike.${like},hook.ilike.${like},script.ilike.${like},caption.ilike.${like}`,
        )
        .eq("archived", false)
        .limit(PAGE),
      db
        .from("tasks")
        .select("id,title,description,status")
        .or(`title.ilike.${like},description.ilike.${like}`)
        .is("archived_at", null)
        .limit(PAGE),
      db
        .from("media_quick_notes")
        .select("id,title,body")
        .or(`title.ilike.${like},body.ilike.${like}`)
        .limit(PAGE),
      db
        .from("media_drafts")
        .select("id,title,body")
        .or(`title.ilike.${like},body.ilike.${like}`)
        .eq("is_archived", false)
        .limit(PAGE),
      db
        .from("media_campaigns")
        .select("id,name,description,status")
        .or(`name.ilike.${like},description.ilike.${like}`)
        .eq("archived", false)
        .limit(PAGE),
      db
        .from("media_resources")
        .select("id,name,description,kind")
        .or(`name.ilike.${like},description.ilike.${like}`)
        .eq("is_archived", false)
        .limit(PAGE),
      db
        .from("media_pages")
        .select("id,title,url,page_type")
        .or(`title.ilike.${like},url.ilike.${like}`)
        .eq("archived", false)
        .limit(PAGE),
      db
        .from("media_testimonials")
        .select("id,client_name,quote")
        .or(`client_name.ilike.${like},quote.ilike.${like}`)
        .eq("is_archived", false)
        .limit(PAGE),
      db
        .from("profiles")
        .select("id,full_name,email")
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .limit(PAGE),
    ]);

  const hits: SearchHit[] = [];
  for (const r of content.data ?? [])
    hits.push({
      id: r.id,
      kind: "content",
      title: r.title || "Untitled content",
      subtitle: [r.content_type, r.platform].filter(Boolean).join(" · ") || null,
      to: `/media/content?openId=${r.id}`,
    });
  for (const r of tasks.data ?? [])
    hits.push({
      id: r.id,
      kind: "task",
      title: r.title,
      subtitle: r.status,
      to: `/media/work?taskId=${r.id}`,
    });
  for (const r of notes.data ?? [])
    hits.push({
      id: r.id,
      kind: "note",
      title: r.title || "Quick note",
      subtitle: (r.body || "").slice(0, 80),
      to: `/media/work?noteId=${r.id}`,
    });
  for (const r of drafts.data ?? [])
    hits.push({
      id: r.id,
      kind: "draft",
      title: r.title || "Untitled draft",
      subtitle: (r.body || "").slice(0, 80),
      to: `/media/drafts?openId=${r.id}`,
    });
  for (const r of campaigns.data ?? [])
    hits.push({
      id: r.id,
      kind: "campaign",
      title: r.name,
      subtitle: r.status,
      to: `/media/campaigns?openId=${r.id}`,
    });
  for (const r of assets.data ?? [])
    hits.push({
      id: r.id,
      kind: "asset",
      title: r.name,
      subtitle: r.kind,
      to: `/media/assets?openId=${r.id}`,
    });
  for (const r of pages.data ?? [])
    hits.push({
      id: r.id,
      kind: "page",
      title: r.title,
      subtitle: r.url,
      to: `/media/pages?openId=${r.id}`,
    });
  for (const r of testimonials.data ?? [])
    hits.push({
      id: r.id,
      kind: "testimonial",
      title: r.client_name || "Testimonial",
      subtitle: (r.quote || "").slice(0, 80),
      to: `/media/testimonials?openId=${r.id}`,
    });
  for (const r of profiles.data ?? [])
    hits.push({
      id: r.id,
      kind: "person",
      title: r.full_name || r.email || "Member",
      subtitle: r.email,
      to: `/media/team?userId=${r.id}`,
    });

  return hits;
}

export const KIND_LABEL: Record<SearchHit["kind"], string> = {
  content: "Content",
  task: "Tasks",
  note: "Quick Notes",
  draft: "Drafts",
  campaign: "Campaigns",
  asset: "Assets",
  page: "Pages & Links",
  testimonial: "Testimonials",
  person: "People",
};