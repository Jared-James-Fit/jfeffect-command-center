import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("sessions show on the Workouts calendar too", () => {
  const exp = read("src/components/workouts/WorkoutsExperience.tsx");

  it("loads the client's sessions and appointments from the same source as the Calendar page", () => {
    // Client view only (a coach's own workouts view of a client doesn't link to the portal).
    expect(exp).toContain('useClientSessionItems(mode === "self" ? clientId : null)');
    const src = read("src/lib/calendar-sources.ts");
    expect(src).toContain("export function useClientSessionItems(");
    // The Calendar page's source uses the same hook, so one fetch serves both.
    expect(src).toContain("const sessions = useClientSessionItems(clientId);");
    expect(src).toContain("out.push(...sessions.items);");
  });

  it("marks session days on the week and month, explains the dot, and lists that day's sessions under the workout", () => {
    expect(exp.match(/sessionDays=\{sessionDays\}/g)?.length).toBe(2);
    expect(exp).toContain("<WorkoutMarkLegend className=\"min-w-0 flex-1\" sessions={sessionDays.size > 0} />");
    expect(exp).toContain("{sessions.length > 0 && <DaySessionsCard sessions={sessions} date={date} />}");
    expect(exp).toContain('"Session with your coach"');
    // Each opens the Calendar on that day.
    expect(exp).toContain('<Link to="/portal/calendar" search={{ date: day } as any} className={AGENDA_ROW}>');
    // Cancelled / moved sessions don't show.
    expect(exp).toContain("if (/cancel|reschedul/i.test(it.status ?? \"\")) continue;");
    // Coaching clients always get a way to their appointments, even on a week with none.
    expect(exp).toContain('const showAppointmentsLink = mode === "self" && isCoaching;');
    expect(exp).toMatch(/\{showAppointmentsLink && \(\s*<Link\s+to="\/portal\/calendar"/);
    const strip = read("src/components/workouts/week-strip.tsx");
    expect(strip).toContain("{hasSession && <SessionDot onPrimary={isSelected} />}");
  });
});
