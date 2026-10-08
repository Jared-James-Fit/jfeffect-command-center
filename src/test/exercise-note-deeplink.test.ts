import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("exercise-note notification opens the exact workout", () => {
  const bell = read("src/components/notification-bell.tsx");
  const view = read("src/components/workout-day/WorkoutDayView.tsx");
  const route = read("src/routes/_authenticated/portal/workouts.$dayId.tsx");

  it("carries the workout day, exercise row and client account on note items", () => {
    expect(bell).toContain("day_id, row_id, exercise_name");
    expect(bell).toContain("dayId: n.day_id, rowId: n.row_id ?? null");
    expect(bell).toContain('select("id, full_name, user_id")');
  });

  it("opens the workout in Client POV, focused on the exercise", () => {
    expect(bell).toContain('it.kind === "exercise_note" && role === "admin" && it.dayId && it.clientUserId');
    expect(bell).toContain("impersonation.start(");
    expect(bell).toContain('to: "/portal/workouts/$dayId"');
    expect(bell).toContain("search: it.rowId ? { focus: it.rowId } : {}");
  });

  it("the workout view scrolls to and highlights the focused exercise", () => {
    expect(route).toContain("focus: typeof s.focus === \"string\"");
    expect(view).toContain("useFocusExerciseRow(search.focus)");
    expect(view).toContain("data-workout-row={row?.id}");
  });
});

describe("client profile header is not cluttered", () => {
  const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
  const header = page.slice(page.indexOf("{!embedded && <PageHeader"), page.indexOf("{embedded && ("));

  it("drops controls that duplicate the page header, the tabs and the sticky Save bar", () => {
    expect(header).not.toContain(">Back</Button>");
    expect(header).not.toContain("<Apple");
    expect(header).not.toContain('onClick={save}><Save');
  });

  it("keeps Training program and Program history reachable from More", () => {
    expect(header).toContain("Training program");
    expect(header).toContain("Program history");
  });
});

describe("month calendar fits phone-width cells", () => {
  const cal = read("src/components/schedule/ScheduleCalendar.tsx");
  it("shows an icon + coloured edge on phones and the text badge from sm up", () => {
    expect(cal).toContain('<span className="sm:hidden">{statusIcon(status)}</span>');
    expect(cal).toContain('<div className="hidden sm:block">{statusBadge(status)}</div>');
    expect(cal).toContain("min-w-0 border border-border/60");
  });
});
