import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  earlierVersions,
  editedLabel,
  isNoteEdited,
  noteDay,
  noteEditedAt,
  originalNotKept,
  type NoteRevision,
} from "@/lib/exercise-note-versions";
import { selectExerciseNoteHistory } from "@/lib/exercise-note-history";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-19T20:00:00");

const rev = (id: string, content: string, written_at: string, replaced_at: string): NoteRevision => ({ id, content, written_at, replaced_at });

describe("an edited note says so, quietly", () => {
  it("edited_at is when the words changed; a note never edited has no label", () => {
    expect(noteEditedAt({ created_at: "2026-11-10T18:00:00Z" })).toBeNull();
    expect(isNoteEdited({ created_at: "2026-11-10T18:00:00Z", status: "new", updated_at: "2026-11-12T10:00:00Z" })).toBe(false);
    expect(editedLabel({ created_at: "2026-11-10T18:00:00Z" }, NOW)).toBeNull();
  });
  it("a seen mark moves updated_at, never the edited date", () => {
    expect(noteEditedAt({ edited_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-15T10:00:00Z", status: "edited" })).toBe("2026-11-12T10:00:00Z");
  });
  it("a note edited before edited_at existed still reads as edited", () => {
    expect(noteEditedAt({ status: "edited", updated_at: "2026-10-01T10:00:00Z" })).toBe("2026-10-01T10:00:00Z");
  });
  it("today it's the time, this year the day, another year with the year", () => {
    expect(editedLabel({ edited_at: new Date("2026-11-19T14:14:00").toISOString() }, NOW)).toBe("Edited 2:14 PM");
    expect(editedLabel({ edited_at: new Date("2026-11-12T09:00:00").toISOString() }, NOW)).toBe("Edited Nov 12");
    expect(editedLabel({ edited_at: new Date("2025-12-30T09:00:00").toISOString() }, NOW)).toBe("Edited Dec 30, 2025");
    expect(noteDay(new Date("2026-11-10T18:00:00").toISOString(), NOW)).toBe("Nov 10");
  });
});

describe("earlier versions, oldest first, the original marked", () => {
  const note = { created_at: "2026-11-10T18:00:00Z", edited_at: "2026-11-15T09:00:00Z" };
  it("the first wording saved when the note was written is the original", () => {
    const v = earlierVersions(note, [
      rev("b", "felt strong, shoulder pinch", "2026-11-12T10:00:00Z", "2026-11-15T09:00:00Z"),
      rev("a", "felt strong", "2026-11-10T18:00:00Z", "2026-11-12T10:00:00Z"),
    ]);
    expect(v.map((x) => [x.content, x.original])).toEqual([["felt strong", true], ["felt strong, shoulder pinch", false]]);
    expect(originalNotKept(note, v)).toBe(false);
  });
  it("a note first edited before history was kept says its first words weren't kept", () => {
    const legacy = { created_at: "2026-09-30T10:00:00Z", edited_at: "2026-10-01T10:00:00Z", status: "edited" };
    expect(originalNotKept(legacy, earlierVersions(legacy, []))).toBe(true);
    const later = earlierVersions(legacy, [rev("a", "legacy edited", "2026-10-01T10:00:00Z", "2026-11-19T10:00:00Z")]);
    expect(later[0].original).toBe(false);
    expect(originalNotKept(legacy, later)).toBe(true);
  });
  it("a note never edited has nothing to say about history", () => {
    expect(originalNotKept({ created_at: "2026-11-10T18:00:00Z" }, [])).toBe(false);
    expect(earlierVersions({ created_at: "2026-11-10T18:00:00Z" }, null)).toEqual([]);
  });
});

describe("history keeps each note on the day it was written", () => {
  const n = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
    id, exercise_id: "ex-1", exercise_name: "Bench", content: "x", status: "new",
    created_at, updated_at: created_at, day_id: `day-${id}`, ...over,
  });
  it("editing an old note never moves it up", () => {
    const rows = [
      n("old", "2026-07-01T10:00:00Z", { status: "edited", edited_at: "2026-11-19T10:00:00Z", updated_at: "2026-11-19T10:00:00Z" }),
      n("new", "2026-08-17T10:00:00Z"),
    ];
    expect(selectExerciseNoteHistory(rows as any, { exerciseId: "ex-1" }).map((r) => r.id)).toEqual(["new", "old"]);
  });
  it("blank notes are left out", () => {
    const rows = [n("blank", "2026-08-17T10:00:00Z", { content: "  " }), n("kept", "2026-08-10T10:00:00Z")];
    expect(selectExerciseNoteHistory(rows as any, { exerciseId: "ex-1" }).map((r) => r.id)).toEqual(["kept"]);
  });
});

describe("the database keeps every version and the coach's card in step (20270419090000)", () => {
  const sql = read("supabase/migrations/20270419090000_exercise_note_edits.sql");
  it("the wording an edit replaces is kept, by the trigger only", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.pl_exercise_note_revisions");
    expect(sql).toContain("VALUES (OLD.id, OLD.client_id, OLD.content, coalesce(OLD.edited_at, OLD.created_at), (SELECT auth.uid()));");
    expect(sql).toContain("REVOKE ALL ON public.pl_exercise_note_revisions FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT ON public.pl_exercise_note_revisions TO authenticated;");
    expect(sql).not.toMatch(/CREATE POLICY[^;]+pl_exercise_note_revisions\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it("versions hang off the client, so a note put back from the trash keeps its history", () => {
    expect(sql).toContain("note_id uuid NOT NULL,\n  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,");
  });
  it("a note's day and workout never change; a seen mark isn't an edit", () => {
    expect(sql).toContain("NEW.created_at := OLD.created_at;");
    expect(sql).toContain("NEW.day_id := OLD.day_id;");
    expect(sql).toContain("NEW.edited_at := OLD.edited_at;");
    expect(sql).toContain("CREATE TRIGGER tg_pl_exercise_notes_keep_version");
    // runs before the updated_at trigger and the coach trigger (alphabetical)
    expect(["tg_pl_exercise_notes_keep_version", "tg_pl_exercise_notes_updated", "trg_exercise_note_to_coach"].slice().sort()[0]).toBe("tg_pl_exercise_notes_keep_version");
  });
  it("an edit updates the card the coach has, as the server; it never posts a second card", () => {
    expect(sql).toContain("UPDATE public.messages m");
    expect(sql).toContain("PERFORM set_config('request.jwt.claims', '', true);");
    expect(sql).toContain("PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);");
    expect(sql).toContain("IF v_old IS NOT NULL THEN RETURN NEW; END IF;");
    expect(sql).not.toContain("workout_note_needs_card(NEW.coach_message_id");
  });
  it("the backfill never moves updated_at", () => {
    expect(sql).toContain("ALTER TABLE public.pl_exercise_notes DISABLE TRIGGER tg_pl_exercise_notes_updated;");
    expect(sql).toContain("ALTER TABLE public.pl_exercise_notes ENABLE TRIGGER tg_pl_exercise_notes_updated;");
  });
});

describe("the notes sheet edits any note in place", () => {
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  const sheet = day.slice(day.indexOf("function ExerciseNotesSheet"), day.indexOf("/** How long a weight typed in the other unit waits"));
  it("one row per note: an edit updates it by id, never inserts", () => {
    expect(sheet).toContain('const { error } = await sb.from("pl_exercise_notes").update(payload).eq("id", id);');
    expect(sheet).toContain("await updateNote(existingNote.id, trimmed);");
    expect(sheet).toContain("await updateNote(n.id, content);");
  });
  it("an edit never resurfaces the note or pushes the coach", () => {
    expect(sheet).not.toContain("coach_seen_at: null");
    expect(sheet).toContain("if (toCoach && !cardBefore) {");
  });
  it("history by the day each note was written; earlier versions only when asked for", () => {
    expect(sheet).toContain('.order("created_at", { ascending: false })');
    expect(sheet).toContain("<EditedToggle note={existingNote} open={versionsOpen}");
    expect(sheet).toContain("onRestore={(content) => setDraft(content)}");
  });
  it("one save button on screen: an older note being edited has its own", () => {
    expect(sheet).toContain("{!editingOlder && (");
    expect(sheet).toContain("data-note-history-save");
  });
});

describe("the coach sees the same note, edited in place", () => {
  it("the chat card reads the note again when its message updates, and opens its versions", () => {
    const card = read("src/components/messages/workout-note-card.tsx");
    expect(card).toContain('queryKey: ["workout-note-card", source, sourceId ?? null, version ?? null]');
    expect(card).toContain("<NoteVersions noteId={sourceId} note={live.dates} open={versionsOpen}");
    expect(read("src/components/message-thread.tsx")).toContain("version={message.updated_at ?? null}");
  });
  it("the coach's notes log opens an exercise note's versions", () => {
    expect(read("src/components/messages/client-notes-log.tsx")).toContain("<NoteVersions noteId={e.id} note={dates} open={versionsOpen}");
  });
});
