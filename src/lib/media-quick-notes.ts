import { supabase } from "@/integrations/supabase/client";

export interface QuickNoteRow {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  converted_to: "task" | "draft" | "content_idea" | null;
  converted_ref_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchQuickNotes(opts: { includeArchived?: boolean } = {}): Promise<QuickNoteRow[]> {
  let q = (supabase.from("media_quick_notes") as any)
    .select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as QuickNoteRow[];
}

export async function createQuickNote(input: { title?: string; body?: string }): Promise<QuickNoteRow> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await (supabase.from("media_quick_notes") as any)
    .insert({ owner_id: u.user.id, title: input.title ?? "", body: input.body ?? "" })
    .select().single();
  if (error) throw error;
  return data as QuickNoteRow;
}

export async function updateQuickNote(id: string, patch: Partial<QuickNoteRow>): Promise<void> {
  const { error } = await (supabase.from("media_quick_notes") as any).update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteQuickNote(id: string): Promise<void> {
  const { error } = await (supabase.from("media_quick_notes") as any).delete().eq("id", id);
  if (error) throw error;
}

/** Convert a note → task. Returns new task id. */
export async function convertNoteToTask(note: QuickNoteRow): Promise<string> {
  const { data, error } = await (supabase.from("tasks") as any).insert({
    title: note.title || note.body.slice(0, 80) || "Untitled task",
    description: note.body,
    scope: "media",
    quadrant: "do",
  }).select("id").single();
  if (error) throw error;
  await updateQuickNote(note.id, { converted_to: "task", converted_ref_id: data.id, archived: true });
  return data.id as string;
}

/** Convert a note → content idea (creates a media_content_records row). */
export async function convertNoteToContentIdea(note: QuickNoteRow): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await (supabase.from("media_content_records") as any).insert({
    title: note.title || note.body.slice(0, 80) || "Content idea",
    description: note.body,
    production_status: "idea",
    approval_status: "draft",
    created_by: u.user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  await updateQuickNote(note.id, { converted_to: "content_idea", converted_ref_id: data.id, archived: true });
  return data.id as string;
}

/** Convert a note → broadcast draft. */
export async function convertNoteToDraft(note: QuickNoteRow): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await (supabase.from("broadcasts") as any).insert({
    title: note.title || note.body.slice(0, 80) || "Untitled draft",
    body: note.body,
    status: "Draft",
    review_status: "draft",
    audience_scope: "everyone",
    submitted_by: u.user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  await updateQuickNote(note.id, { converted_to: "draft", converted_ref_id: data.id, archived: true });
  return data.id as string;
}

/** One-time migration of localStorage notes into the DB. Idempotent via marker key. */
export async function importLocalQuickNotesOnce(storageKey: string): Promise<number> {
  if (typeof window === "undefined") return 0;
  const markerKey = `${storageKey}__db-imported`;
  if (localStorage.getItem(markerKey)) return 0;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) { localStorage.setItem(markerKey, "1"); return 0; }
    const arr = JSON.parse(raw) as { id: string; title: string; body: string }[];
    let n = 0;
    for (const note of arr) {
      if (!note.title?.trim() && !note.body?.trim()) continue;
      try { await createQuickNote({ title: note.title, body: note.body }); n++; } catch {}
    }
    localStorage.setItem(markerKey, "1");
    return n;
  } catch {
    localStorage.setItem(markerKey, "1");
    return 0;
  }
}