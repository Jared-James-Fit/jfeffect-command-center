/**
 * Telling someone a note was shared with them. The caller names the notes and
 * who was just added; the server re-reads the notes as the caller (so only
 * notes they're on), keeps only the people actually on them and sends one
 * push per person. Content-free on the lockscreen (never the note's words),
 * once per note per person.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { firstName } from "@/lib/tasks";

const Input = z.object({
  noteIds: z.array(z.string().uuid()).min(1).max(50),
  to: z.array(z.string().uuid()).min(1).max(20),
});

/** The push for one person: what they were given, and where it opens. */
export function teamNoteSharedPush(sender: string, noteIds: string[]) {
  const who = firstName(sender) || "Your team";
  const one = noteIds.length === 1;
  return {
    title: one ? `${who} shared a note with you` : `${who} shared ${noteIds.length} notes with you`,
    body: one ? "It's in Team notes on your Tasks." : "They're in Team notes on your Tasks.",
    url: one ? `/admin/content#note=${noteIds[0]}` : "/admin/content",
  };
}

export const notifyTeamNoteSharedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    // Read as the caller: a note they aren't on is never announced.
    const { data: rows } = await (supabase as any)
      .from("team_notes")
      .select("id, members")
      .in("id", data.noteIds);
    const notes = (rows ?? []) as { id: string; members: string[] }[];
    if (!notes.length) return { sent: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { data: me } = await (supabaseAdmin as any).from("profiles").select("full_name").eq("id", userId).maybeSingle();

    let sent = 0;
    for (const uid of new Set(data.to)) {
      if (uid === userId) continue;
      const theirs = notes.filter((n) => (n.members ?? []).includes(uid)).map((n) => String(n.id)).sort();
      if (!theirs.length) continue;
      const push = teamNoteSharedPush(me?.full_name ?? "", theirs);
      const r = await sendWebPushToUser(
        supabaseAdmin as any,
        uid,
        { ...push, tag: `team_note_shared:${uid}`, data: { kind: "team_note_shared", noteIds: theirs } },
        {
          category: "reminders",
          eventKey: `team_note_shared:${theirs.join(",")}:${uid}`,
          rateKey: `team_note_shared:${userId}:${uid}`,
          rateWindowMinutes: 2,
          priority: "normal",
        },
      );
      sent += r.sent;
    }
    return { sent };
  });
