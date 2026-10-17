import { describe, expect, it } from "vitest";
import {
  bodyweightSummary, estimate1rm, formatLoad, formatSessions, groupSessions, matchesExercise, mergeBodyweight,
  type LoggedSet,
} from "@/lib/cleo-data";
import { CLEO_ACTION_PARAMS, actionPermission, isStale, routeFor, statusLabel } from "@/lib/cleo-actions";

const set = (over: Partial<LoggedSet> = {}): LoggedSet => ({
  completed_at: "2026-10-08T23:10:00Z",
  exercise: "High-Bar Back Squat",
  day_title: "Lower A",
  set_index: 1,
  entered_value: 315,
  entered_unit: "lb",
  normalized_kg: 142.88,
  normalized_lb: 315,
  reps: 3,
  rpe: 8,
  rir: null,
  is_working_set: true,
  load_type: "external",
  is_bodyweight: false,
  notes: null,
  ...over,
});

describe("matchesExercise", () => {
  it("matches the way coaches say a lift", () => {
    expect(matchesExercise("High-Bar Back Squat", "high bar squat")).toBe(true);
    expect(matchesExercise("High-Bar Back Squat", "highbar")).toBe(true);
    expect(matchesExercise("Low-Bar Back Squat", "high bar squat")).toBe(false);
    expect(matchesExercise("Bench Press", "")).toBe(true);
  });
});

describe("logged sets", () => {
  it("shows the load the client typed, with RPE and warm-ups marked", () => {
    expect(formatLoad(set())).toBe("315 lb");
    expect(formatLoad(set({ entered_value: null, entered_unit: null }), "kg")).toBe("143 kg");
    expect(formatLoad(set({ load_type: "bodyweight", entered_value: null, entered_unit: null, normalized_kg: null, normalized_lb: null }))).toBe("BW");
    expect(formatLoad(set({ load_type: "assisted", entered_value: 40 }))).toBe("assisted 40 lb");
  });

  it("groups sets into training days, newest first, with the top set's e1RM", () => {
    const sessions = groupSessions(
      [
        set({ completed_at: "2026-10-01T22:00:00Z", reps: 5, normalized_kg: 130 }),
        set({ is_working_set: false, reps: 5, entered_value: 225, normalized_kg: 102 }),
        set({ set_index: 2 }),
      ],
      "America/Winnipeg",
    );
    expect(sessions.map((s) => s.date)).toEqual(["2026-10-08", "2026-10-01"]);
    const out = formatSessions(sessions, "lb");
    expect(out).toContain("2026-10-08 | Lower A");
    expect(out).toContain("225 lb x 5 @RPE 8 (warm-up)");
    expect(formatSessions(groupSessions([set({ row_id: "row-1" })], "America/Winnipeg"))).toContain("High-Bar Back Squat (top set e1RM ~346 lb) (row id row-1)");
    expect(out).toMatch(/top set e1RM ~346 lb/);
    expect(out).toContain("set 1: 225 lb x 5 @RPE 8 (warm-up)");
    expect(out).toContain("set 2: 315 lb x 3 @RPE 8");
    expect(out).not.toContain("set 0:");
  });

  it("lists a workout's sets in the order they were done, never by when they saved", () => {
    // fill-down saved bench 3, 1, 2 at the same second; squat (row 0) was first
    const at = (s: number) => `2026-10-08T23:10:0${s}Z`;
    const bench = (set_index: number, s: number) =>
      set({ day_id: "day-1", row_id: "bench", row_order: 1, exercise: "Bench Press", set_index, completed_at: at(s), reps: set_index });
    const sessions = groupSessions(
      [
        bench(3, 1),
        bench(1, 2),
        set({ day_id: "day-1", row_id: "squat", row_order: 0, set_index: 2, completed_at: at(3) }),
        bench(2, 4),
        set({ day_id: "day-1", row_id: "squat", row_order: 0, set_index: 1, completed_at: at(5) }),
      ],
      "America/Winnipeg",
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].exercises.map((e) => e.name)).toEqual(["High-Bar Back Squat", "Bench Press"]);
    expect(sessions[0].exercises.map((e) => e.sets.map((x) => x.set_index))).toEqual([[1, 2], [1, 2, 3]]);
    const lines = formatSessions(sessions, "lb").split("\n").filter((l) => l.includes("Bench") || l.startsWith("    set"));
    expect(lines.slice(-3)).toEqual(["    set 1: 315 lb x 1 @RPE 8", "    set 2: 315 lb x 2 @RPE 8", "    set 3: 315 lb x 3 @RPE 8"]);
  });

  it("only estimates a 1RM from 1 to 12 reps", () => {
    expect(estimate1rm(100, 1)).toBe(100);
    expect(estimate1rm(100, 15)).toBeNull();
  });
});

describe("body weight", () => {
  it("keeps the app weigh-in over a coach entry on the same day", () => {
    const merged = mergeBodyweight(
      [{ date: "2026-10-08", value: 181.2, unit: "lb", source: "logged in app", note: null }],
      [
        { date: "2026-10-08", value: 80, unit: "kg", source: "coach metrics", note: null },
        { date: "2026-10-01", value: 82, unit: "kg", source: "coach metrics", note: null },
      ],
    );
    expect(merged.map((e) => e.source)).toEqual(["logged in app", "coach metrics"]);
  });

  it("gives the latest and the weekly average change in the latest unit", () => {
    const s = bodyweightSummary(
      [
        { date: "2026-10-08", value: 180, unit: "lb", source: "logged in app", note: null },
        { date: "2026-10-06", value: 182, unit: "lb", source: "logged in app", note: null },
        { date: "2026-09-30", value: 184, unit: "lb", source: "logged in app", note: null },
      ],
      "2026-10-09",
    );
    expect(s).toContain("Latest: 180 lb on 2026-10-08");
    expect(s).toContain("7-day average 181 lb");
    expect(s).toContain("Change vs the week before: -3 lb");
  });
});

describe("Cleo actions: who can do what", () => {
  const admin = { isAdmin: true, permissions: [] };
  const finance = { isAdmin: false, permissions: ["admin.view", "payments.record", "payments.request", "tasks.manage", "discounts.manage"] };

  it("admins run everything themselves", () => {
    expect(routeFor("admin", admin)).toBe("run");
    expect(routeFor("tasks.manage", admin)).toBe("run");
  });

  it("the finance login runs what's in its role and asks the owner for the rest", () => {
    expect(routeFor(actionPermission("create_task", {}), finance)).toBe("run");
    expect(routeFor(actionPermission("send_payment_link", {}), finance)).toBe("run");
    expect(routeFor(actionPermission("update_payment_status", { payment_status: "Paid" }), finance)).toBe("run");
    expect(routeFor(actionPermission("update_payment_status", { payment_status: "Refunded" }), finance)).toBe("ask_owner");
    expect(routeFor(actionPermission("send_message", {}), finance)).toBe("ask_owner");
    expect(routeFor(actionPermission("book_appointment", {}), finance)).toBe("ask_owner");
  });

  it("someone with no role permissions always asks", () => {
    expect(routeFor("tasks.manage", { isAdmin: false, permissions: [] })).toBe("ask_owner");
  });

  it("validates what Cleo proposes", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(CLEO_ACTION_PARAMS.send_message.safeParse({ client_id: id, body: "Nice work today." }).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.send_message.safeParse({ client_id: "nope", body: "x" }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.schedule_message.safeParse({ client_id: id, body: "x", date: "2026-10-12", time: "9am" }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.update_payment_status.safeParse({ purchase_id: id, payment_status: "Totally Paid" }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.book_appointment.parse({ title: "Form check", appointment_type: "Coaching Call", date: "2026-10-12", time: "15:00" })).toMatchObject({ duration_minutes: 60, video_call: false });
  });

  it("cards go stale after a day", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(isStale("2026-10-09T08:00:00Z", now)).toBe(false);
    expect(isStale("2026-10-08T08:00:00Z", now)).toBe(true);
  });

  it("names the owner on a waiting card", () => {
    expect(statusLabel("awaiting_approval", "Jared")).toBe("Waiting on Jared");
    expect(statusLabel("declined", "Jared")).toBe("Jared said no");
  });
});

describe("Cleo never answers with her own rules", () => {
  it("spots a reply that just restates the formatting rules", async () => {
    const { looksLikeLeakedInstructions } = await import("@/lib/summer-voice-text");
    expect(looksLikeLeakedInstructions("1 to 3 short sentences. No list, no emoji, no markdown, no money symbols, no numbers at start of lines. Write money as $1,234.56. Put the link at the very end.")).toBe(true);
    expect(looksLikeLeakedInstructions("VOICE: they are talking to you out loud")).toBe(true);
  });

  it("leaves real answers alone, even ones that mention a list or money", async () => {
    const { looksLikeLeakedInstructions } = await import("@/lib/summer-voice-text");
    expect(looksLikeLeakedInstructions("Jared is at 181 lb, down 1.2 lb this week. I put a card below to add calf raises to today's workout.")).toBe(false);
    expect(looksLikeLeakedInstructions("Here's the list of who owes money: Marc owes $400.00.")).toBe(false);
    expect(looksLikeLeakedInstructions("")).toBe(false);
  });
});
