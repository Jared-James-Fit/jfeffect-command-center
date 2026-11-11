import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("a coach's reason never lands in the client's note", () => {
  const dialog = read("src/components/pt-session-dialog.tsx");

  it("the session editor's note is the coach's own, saved where his notes live", () => {
    expect(dialog).toContain('import { COACH_NOTES_KEY, saveCoachNote, useCoachNote } from "@/lib/session-coach-notes";');
    expect(dialog).toContain('<span className="text-xs font-normal text-muted-foreground">Only you see it</span>');
    expect(dialog).toContain("await Promise.all(noteIds.map((id) => saveCoachNote(id, privateNote)));");
    // a new booking's note goes on every session it booked
    expect(dialog).toContain("const noteIds = form.id ? [form.id] : createdIds;");
    // the old unlabelled box that reached the client
    expect(dialog).not.toContain("<Label>Notes</Label>");
  });

  it("the client's note is said to be theirs, and there's no 'hidden' note that isn't private", () => {
    expect(dialog).toContain("Note to {noteFirst}");
    expect(dialog).toContain("On their session and calendar");
    expect(dialog).not.toContain('label="Show notes to client"');
    expect(dialog).toContain("client_visible_notes: true,");
    // a booking type's notes the client isn't meant to see start as the coach's note
    expect(dialog).toContain('notes: card?.client_visible_notes === false ? "" : card?.default_notes ?? "",');
    expect(dialog).toContain('setPrivateNote(card?.client_visible_notes === false ? card?.default_notes ?? "" : "");');
  });

  it("the Sessions list shows both, the client's labelled as theirs", () => {
    const list = read("src/components/sessions/client-sessions-panel.tsx");
    expect(list).toContain("{coachNote && (");
    expect(list).toContain("coachNote={coachNotes?.get(s.id)}");
    expect(list).toContain("To {clientFirst}: {s.notes.trim()}");
  });

  it("existing hidden notes and Colten's Oct 29 reason moved to the coach's notes", () => {
    const sql = read("supabase/migrations/20270119090000_session_notes_private.sql");
    expect(sql).toContain("AND btrim(notes) = 'Colten booked a foot tattoo friday'");
    expect(sql).toContain("WHERE client_visible_notes = false AND nullif(btrim(notes), '') IS NOT NULL;");
    expect(sql).toContain("INSERT INTO public.pt_session_coach_notes (pt_session_id, client_id, note)");
  });
});
