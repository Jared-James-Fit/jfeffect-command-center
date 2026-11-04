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

  it("marks session days on the week and month and lists that day's sessions under the workout (no legend line)", () => {
    expect(exp.match(/sessionDays=\{sessionDays\}/g)?.length).toBe(2);
    // No Planned / In progress / Done legend under the strip: the marks say it, and a
    // session day names its session in the day's aria-label and in the card under the workout.
    expect(exp).not.toContain("WorkoutMarkLegend");
    expect(read("src/components/workouts/week-strip.tsx")).toContain('${hasSession ? ", session with your coach" : ""}');
    expect(exp).toContain("{sessions.length > 0 && <DaySessionsCard sessions={sessions} date={date} clientId={clientId} />}");
    expect(exp).toContain('"Session with your coach"');
    // A session opens its quick view right there; an appointment opens the Calendar on that day.
    expect(exp).toContain("<button type=\"button\" onClick={() => setOpenSession(it.raw as ClientSession)} className={AGENDA_ROW}>{row}</button>");
    expect(exp).toContain('<Link to="/portal/calendar" search={{ date: day } as any} className={AGENDA_ROW}>{row}</Link>');
    // Cancelled / moved sessions don't show.
    expect(exp).toContain("if (/cancel|reschedul/i.test(it.status ?? \"\")) continue;");
    // Coaching clients always get a way to their appointments, even on a week with none:
    // Appointments in the header's ⋯ (a quiet menu row, not a violet link under the strip).
    expect(exp).toContain('const showAppointmentsLink = mode === "self" && isCoaching;');
    expect(exp).toMatch(/\{showAppointmentsLink && \(\s*<DropdownMenuItem asChild>\s*<Link\s+to="\/portal\/calendar"/);
    expect(exp).not.toContain("text-violet-400");
    const strip = read("src/components/workouts/week-strip.tsx");
    expect(strip).toContain("{hasSession && <SessionDot />}");
  });
});
