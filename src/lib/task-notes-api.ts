import { supabase } from "@/integrations/supabase/client";
import { noteToRow, type NoteRow, type NotesApi } from "@/lib/task-notes-sync";

export type TaskSyncScope = "admin" | "media";

const COLS = "id,title,body,edited_at,deleted_at,version";
// The generated types don't know these tables until they are regenerated
// after the migration, so go through an untyped handle (as other lib files do).
const table = (name: "task_quick_notes" | "task_preferences") => supabase.from(name as never) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** True when the table doesn't exist yet (migration not applied): sync stays off, the app keeps working locally. */
export function isMissingTableError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST200") return true;
  return /does not exist|schema cache|could not find the table/i.test(err.message ?? "");
}

export function createSupabaseNotesApi(scope: TaskSyncScope): NotesApi {
  return {
    async fetch() {
      const { data, error } = await table("task_quick_notes").select(COLS).eq("scope", scope);
      if (error) throw error;
      return (data ?? []) as NoteRow[];
    },
    async insert(n) {
      // DO NOTHING on conflict: an existing id means another device got there first.
      const { data, error } = await table("task_quick_notes")
        .upsert({ ...noteToRow(n), scope }, { onConflict: "id", ignoreDuplicates: true })
        .select(COLS);
      if (error) throw error;
      return ((data ?? [])[0] as NoteRow | undefined) ?? null;
    },
    async update(n, expectVersion) {
      const { id: _id, ...fields } = noteToRow(n);
      void _id;
      const { data, error } = await table("task_quick_notes")
        .update(fields)
        .eq("id", n.id)
        .eq("version", expectVersion)
        .select(COLS);
      if (error) throw error;
      return ((data ?? [])[0] as NoteRow | undefined) ?? null;
    },
    async remove(id, expectVersion) {
      const { data, error } = await table("task_quick_notes")
        .delete()
        .eq("id", id)
        .eq("version", expectVersion)
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  };
}
