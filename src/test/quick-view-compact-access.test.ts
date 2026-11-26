import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { exerciseState, splitLoggedLine } from "@/lib/workout-peek";
import { purgeClientData, lostAccess } from "@/lib/pov/purge-client-cache";
import {
  accessStatusWord, changeLines, durationWords, eventWords, roleWord, sourceWord, tableWord,
} from "@/lib/pov/access-log-words";

const read = (p: string) => readFileSync(p, "utf8");
const today = "2026-11-26";
const ex = (setsPlanned: number | null, setsLogged: number, cardio = false) => ({ setsPlanned, setsLogged, cardio });

describe("quick view: each exercise's state", () => {
  it("done, partial, skipped, missed and still to do are told apart", () => {
    const done = { status: "done" as const, date: "2026-11-24" };
    expect(exerciseState(ex(3, 3), done, today, 12)).toBe("done");
    expect(exerciseState(ex(3, 4), done, today, 12)).toBe("done");
    expect(exerciseState(ex(3, 1), done, today, 12)).toBe("partial");
    // a trained workout that left this one empty: skipped, never missed
    expect(exerciseState(ex(3, 0), done, today, 12)).toBe("skipped");
    // the day's cardio isn't skipped by being empty
    expect(exerciseState(ex(1, 0, true), done, today, 12)).toBe("pending");
    // a whole workout missed: every exercise missed
    expect(exerciseState(ex(3, 0), { status: "missed", date: "2026-11-20" }, today, 0)).toBe("missed");
    // today's, nothing logged yet: still to do
    expect(exerciseState(ex(3, 0), { status: "today", date: today }, today, 0)).toBe("pending");
    // mid-session, some sets in: partial, not skipped
    expect(exerciseState(ex(3, 1), { status: "in_progress", date: today }, today, 4)).toBe("partial");
    // one ahead
    expect(exerciseState(ex(3, 0), { status: "upcoming", date: "2026-11-28" }, today, 0)).toBe("pending");
  });

  it("a logged line is split into its sets and what was lifted", () => {
    expect(splitLoggedLine("Sets 1–3: 140 kg × 5 · RPE 8")).toEqual({ sets: "1–3", text: "140 kg × 5 · RPE 8" });
    expect(splitLoggedLine("Set 4: 135 kg × 5")).toEqual({ sets: "4", text: "135 kg × 5" });
    expect(splitLoggedLine("20:00 · RPE 6")).toEqual({ sets: null, text: "20:00 · RPE 6" });
  });
});

describe("quick view: compact and scannable", () => {
  const qv = read("src/components/clients/workout-quick-view/quick-view.tsx");

  it("one list of exercises, each with a state mark, the prescription and suggested weight first, rest and muscles secondary", () => {
    expect(qv).toContain("data-quick-view-exercises");
    expect(qv).toContain("data-exercise-state={state}");
    expect(qv).toContain("exerciseState(ex, entry, today, day.setsLogged)");
    expect(qv).toContain("splitLoggedLine(l)");
    expect(qv).toContain("<GuideInline guide={guide} name={name} />");
    expect(qv).toContain("text-[11.5px] leading-snug text-muted-foreground");
  });

  it("notes are collapsed behind an indicator and an exercise opens for its details", () => {
    expect(qv).toContain("data-exercise-notes");
    expect(qv).toContain("data-quick-view-details");
    expect(qv).toContain("data-quick-view-day-notes");
  });

  it("no instructional text: the switcher's hint and the keys footer are gone, the keys ride in the buttons' titles", () => {
    expect(qv).not.toContain("Star athletes to switch between them here");
    expect(qv).not.toContain("<kbd");
    expect(qv).toContain('label="Previous workout (←)"');
    expect(qv).toContain('aria-label="Starred athletes ([ ] to switch)"');
  });

  it("an athlete this login can't reach shows nothing about them, and the attempt is on the access record", () => {
    expect(qv).toContain("data-quick-view-no-access");
    expect(qv).toContain('noteAccessAttempt(clientId, "quick_view")');
    expect(qv).toContain("src={noAccess ? null : photo}");
  });
});

describe("revocation: cached data for a lost account leaves the device", () => {
  it("removes every query naming the client, and only those", () => {
    const qc = new QueryClient();
    const lost = "11111111-2222-3333-4444-555555555555";
    const kept = "99999999-8888-7777-6666-555555555555";
    qc.setQueryData(["client-schedule", lost], { a: 1 });
    qc.setQueryData(["peek-day", lost, "day-1"], { a: 1 });
    qc.setQueryData(["client-schedule", kept], { a: 1 });
    qc.setQueryData(["my-workouts"], { a: 1 });
    expect(purgeClientData(qc, [lost, null, "short"])).toBe(2);
    expect(qc.getQueryData(["client-schedule", lost])).toBeUndefined();
    expect(qc.getQueryData(["client-schedule", kept])).toBeTruthy();
    expect(qc.getQueryData(["my-workouts"])).toBeTruthy();
    expect(purgeClientData(qc, [])).toBe(0);
  });

  it("lost access is what was reachable and isn't now", () => {
    expect(lostAccess(["a", "b", "c"], ["a", "c", "d"])).toEqual(["b"]);
    expect(lostAccess([], ["a"])).toEqual([]);
  });
});

describe("the access record in words", () => {
  it("statuses, roles and where a refusal came from", () => {
    expect(accessStatusWord("active")).toBe("Open now");
    expect(accessStatusWord("interrupted")).toBe("Interrupted");
    expect(accessStatusWord("revoked")).toBe("Access removed");
    expect(accessStatusWord("denied")).toBe("Refused");
    expect(roleWord("coach")).toBe("Coach");
    expect(roleWord(null)).toBe("Staff");
    expect(roleWord("admin_viewer")).toBe("Admin viewer");
    expect(sourceWord("quick_view")).toBe("workout quick view");
    expect(sourceWord("view_as")).toBe("View as");
  });

  it("durations and tables read like a coach would say them", () => {
    expect(durationWords(20)).toBe("Under a minute");
    expect(durationWords(720)).toBe("12 min");
    expect(durationWords(3900)).toBe("1h 5m");
    expect(tableWord("pl_row_results")).toBe("Logged set");
    expect(tableWord("some_table")).toBe("some table");
    expect(tableWord(null)).toBe("Their data");
  });

  it("events and a change's before and after values", () => {
    expect(eventWords({ kind: "start", detail: { mode: "view" } }).title).toBe("Opened view-only");
    expect(eventWords({ kind: "start", detail: { mode: "edit" } }).title).toBe("Opened with edits on");
    expect(eventWords({ kind: "change", detail: { table: "progress_bodyweight", op: "update" } }).title).toBe("Bodyweight changed");
    expect(eventWords({ kind: "edit_off", detail: { why: "timed_out" } }).detail).toBe("after 15 minutes");
    expect(changeLines({ op: "update", changes: { weight_kg: { from: 80, to: 81.5 } } })).toEqual([{ field: "Weight kg", from: "80", to: "81.5" }]);
    expect(changeLines({ op: "insert", changes: { note: "Sore", done: true } })).toEqual([
      { field: "Note", from: null, to: "Sore" },
      { field: "Done", from: null, to: "yes" },
    ]);
    expect(changeLines({ op: "delete", changes: { note: null } })).toEqual([{ field: "Note", from: "empty", to: "removed" }]);
    expect(changeLines(null)).toEqual([]);
  });
});

describe("the database keeps it: admin only, append-only, automatic", () => {
  const sql = read("supabase/migrations/20270602110000_account_access_hardening.sql");

  it("the record is the admin's to read and nobody's to change", () => {
    expect(sql).toContain("tg_access_record_append_only");
    expect(sql).toContain("tg_admin_pov_sessions_keep");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_access_log\(/);
    expect(sql).toContain("admin_access_denials");
  });

  it("changes are captured by the database with before and after values, secrets hidden", () => {
    expect(sql).toContain("tg_pov_record_change");
    expect(sql).toContain("_pov_value");
  });

  it("abandoned views end themselves and a reassignment ends views that aren't allowed any more", () => {
    expect(sql).toContain("admin_pov_sweep");
    expect(sql).toContain("admin-pov-sweep");
    expect(sql).toContain("tg_pov_revoke_unreachable");
  });

  it("opening an account asks for no reason", () => {
    expect(sql).toMatch(/admin_pov_start\(\s*_client_id uuid,\s*_reason text DEFAULT NULL/);
  });
});
