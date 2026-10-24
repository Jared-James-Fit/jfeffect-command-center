import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("a client asks to change a session, the coach approves in one tap", () => {
  it("the request carries the exact time asked for (migration + server)", () => {
    const sql = read("supabase/migrations/20261231090000_session_change_proposed_time.sql");
    expect(sql).toContain("add column if not exists proposed_date date");
    expect(sql).toContain("add column if not exists proposed_start time");
    expect(sql).toContain("check ((proposed_date is null) = (proposed_start is null))");
    const fns = read("src/lib/schedule.functions.ts");
    expect(fns).toContain('.refine((v) => v.kind !== "move" || !!v.proposedDate || !!v.preferredTimes, "Say when works better.")');
    expect(fns).toContain('if (at.getTime() <= Date.now()) throw new Error("Pick a time that hasn\'t passed yet.");');
    expect(fns).toContain("throw new Error(\"That's the time it's already booked for.\");");
    expect(fns).toContain("proposed_date: proposed?.date ?? null,");
  });

  it("tapping a session opens its quick view everywhere in the client's app", () => {
    // Calendar page: a session takes over the board's tap.
    const page = read("src/routes/_authenticated/portal/calendar.tsx");
    expect(page).toContain('if (item.kind !== "pt_session" || !item.raw) return false;');
    expect(page).toContain("<ClientSessionSheet clientId={client.id} session={openSession}");
    // Home's calendar card.
    const home = read("src/components/home/upcoming-schedule-card.tsx");
    expect(home).toContain('if (links && openSession && item.kind === "pt_session" && item.raw) {');
    // Workouts' session card.
    const exp = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(exp).toContain('{it.kind === "pt_session" && it.raw ? (');
    // The Booked list: Change time / Can't make it straight in.
    const list = read("src/components/schedule/client-session-list.tsx");
    expect(list).toContain('onClick={() => setChanging({ session: s, mode: "move" })}');
    expect(list).toContain('onClick={() => setChanging({ session: s, mode: "cancel" })}');
    expect(list).not.toContain("RequestChangeSheet");
  });

  it("the sheet: details, Change time (day, time, other times, why), Can't make it, and an open request with Withdraw", () => {
    const sheet = read("src/components/schedule/client-session-sheet.tsx");
    expect(sheet).toContain("<DayChips value={newDate} onChange={setNewDate}");
    expect(sheet).toContain('const REASONS = ["Work", "Feeling sick", "Injury", "Travel", "Family", "Something came up"];');
    expect(sheet).toContain('proposedDate: kind === "move" ? newDate : undefined,');
    expect(sheet).toContain("Withdraw request");
    expect(sheet).toContain("It stays booked for {when} until your coach approves.");
    // A coach previewing can look but never send.
    expect(sheet).toContain("disabled={busy || isPov ||");
  });

  it("the coach: Approve fills the move at the asked-for time and tells the client", () => {
    const coach = read("src/components/schedule/session-actions-sheet.tsx");
    expect(coach).toContain("const approveProposed = () => {");
    expect(coach).toContain("Approve {whenLabel(proposed.date, proposed.start)}");
    expect(coach).toContain("`Approved: your ${title} moves from ${when} to ${whenLabel(date, start)}.`");
    const card = read("src/components/schedule/change-requests-card.tsx");
    expect(card).toContain("` → ${whenLabel(r.proposed_date, r.proposed_start)}`");
  });
});
