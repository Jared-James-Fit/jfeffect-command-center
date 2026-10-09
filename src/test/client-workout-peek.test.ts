import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialWorkoutDate, lastCompletedDate, neighbourWorkoutDates } from "@/components/messages/client-workout-peek";
import type { WorkoutItem } from "@/lib/workout-today";

const w = (completedAt: string | null) => ({ day: { id: "d" }, completion: completedAt ? { completed_at: completedAt } : null } as unknown as WorkoutItem);

describe("coach's workout peek: where it opens", () => {
  const byDate = new Map<string, WorkoutItem[]>([
    ["2026-10-01", [w("2026-10-01T18:00:00Z")]],
    ["2026-10-03", [w(null), w("2026-10-04T09:00:00Z")]], // moved workout finished a day late
    ["2026-10-06", [w(null)]],
    ["2026-10-10", [w(null)]],
  ]);

  it("opens on the most recently completed workout (by when it was finished)", () => {
    expect(lastCompletedDate(byDate)).toBe("2026-10-03");
    expect(initialWorkoutDate(byDate, "2026-10-08")).toBe("2026-10-03");
  });

  it("with nothing completed, opens on the next workout coming (else the latest)", () => {
    const fresh = new Map<string, WorkoutItem[]>([["2026-10-06", [w(null)]], ["2026-10-10", [w(null)]]]);
    expect(initialWorkoutDate(fresh, "2026-10-08")).toBe("2026-10-10");
    expect(initialWorkoutDate(fresh, "2026-11-01")).toBe("2026-10-10");
    expect(initialWorkoutDate(new Map(), "2026-11-01")).toBeNull();
  });

  it("Prev / Next step between workout days, skipping rest days", () => {
    const dates = [...byDate.keys()].sort();
    expect(neighbourWorkoutDates(dates, "2026-10-03")).toEqual({ prev: "2026-10-01", next: "2026-10-06" });
    expect(neighbourWorkoutDates(dates, "2026-10-08")).toEqual({ prev: "2026-10-06", next: "2026-10-10" }); // a rest day
    expect(neighbourWorkoutDates(dates, "2026-10-01")).toEqual({ prev: null, next: "2026-10-03" });
  });
});

describe("coach's workout peek: wiring", () => {
  const peek = readFileSync("src/components/messages/client-workout-peek.tsx", "utf8");
  const inbox = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
  const thread = readFileSync("src/components/message-thread.tsx", "utf8");
  const preview = readFileSync("src/components/workout/shared/inline-workout-preview.tsx", "utf8");

  it("sits under the coach's chat header", () => {
    expect(inbox).toContain("<ClientWorkoutPeek clientId={selected.id} clientName={selected.full_name} />");
    expect(inbox.indexOf("<ClientWorkoutPeek")).toBeLessThan(inbox.indexOf("<MessageThread"));
  });

  it("reuses the client's own Workouts data, dates, week strip and day card", () => {
    expect(peek).toContain('queryKey: ["my-workouts", clientId]');
    expect(peek).toContain("buildWorkoutDateMap(");
    expect(peek).toContain("<WeekStrip");
    expect(peek).toContain("<InlineWorkoutPreview");
  });

  it("shows that date's sets only (not another copy of the same day), and all of them", () => {
    expect(peek).toContain("scheduledWorkoutId={item.scheduledWorkoutId ?? null}");
    expect(preview).toContain('if (scheduledWorkoutId) q = q.eq("scheduled_workout_id", scheduledWorkoutId);');
    expect(preview).toContain('else if (scheduledWorkoutId === null) q = q.is("scheduled_workout_id", null);');
    expect(preview).toContain("results.slice(0, maxSetsShown)");
  });

  it("is a bottom sheet on phones and a side panel on desktop", () => {
    expect(peek).toContain('side={isMobile ? "bottom" : "right"}');
  });

  it("'Reply about this workout' fills this client's composer", () => {
    expect(peek).toContain("insertIntoComposer(clientId, text);");
    expect(thread).toContain("window.addEventListener(COMPOSER_INSERT_EVENT, onInsert);");
    expect(thread).toContain("if (!d || d.clientId !== clientId || !d.text) return;");
  });
});
