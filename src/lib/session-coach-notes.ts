/**
 * The coach's own note on a PT session (why it was cancelled, moved or not
 * counted). Lives in pt_session_coach_notes, which only staff can read:
 * clients read their own pt_sessions rows, so it never goes in
 * pt_sessions.notes. Client screens must never read this table.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCoachNote } from "@/lib/session-credit";

export const COACH_NOTES_KEY = "pt-session-coach-notes";

const table = () => (supabase as any).from("pt_session_coach_notes");

/** Notes by session id: one client's (clientId) or every session the coach can see. */
export function useCoachNotes(clientId?: string | null, enabled = true) {
  return useQuery<Map<string, string>>({
    queryKey: [COACH_NOTES_KEY, clientId ?? "all"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      let q = table().select("pt_session_id, note");
      if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw error;
      return new Map(((data ?? []) as Array<{ pt_session_id: string; note: string }>).map((r) => [r.pt_session_id, r.note]));
    },
  });
}

/** One session's note. */
export function useCoachNote(sessionId?: string | null, enabled = true) {
  return useQuery<string | null>({
    queryKey: [COACH_NOTES_KEY, "session", sessionId],
    enabled: enabled && !!sessionId,
    queryFn: async () => {
      const { data, error } = await table().select("note").eq("pt_session_id", sessionId).maybeSingle();
      if (error) throw error;
      return (data?.note as string | undefined) ?? null;
    },
  });
}

/** Save (or, when empty, remove) a session's note. */
export async function saveCoachNote(sessionId: string, text: string | null | undefined): Promise<string | null> {
  const note = normalizeCoachNote(text);
  if (!note) {
    const { error } = await table().delete().eq("pt_session_id", sessionId);
    if (error) throw error;
    return null;
  }
  // client_id is filled from the session by the table's trigger (a caller can't point a note elsewhere).
  const { error } = await table().upsert({ pt_session_id: sessionId, note }, { onConflict: "pt_session_id" });
  if (error) throw error;
  return note;
}
