import { describe, expect, it } from "vitest";
import { deleteProgramCopy, type DeleteProgramFacts } from "@/lib/program-delete";

const base: DeleteProgramFacts = { name: "Powerbuilding Base", firstName: "Devin", weeks: 4, workouts: 24, logged: false, archived: false, start: null, end: null, today: "2026-11-09" };

describe("Delete program: what the coach is told before the tap", () => {
  it("a built draft with nothing logged is deleted, and says it isn't on the calendar", () => {
    const c = deleteProgramCopy(base);
    expect(c.outcome).toBe("delete");
    expect(c.title).toBe('Delete "Powerbuilding Base"?');
    expect(c.lines).toEqual(["4 weeks · 24 workouts, nothing logged yet.", "It isn't on the calendar.", "This can't be undone."]);
    expect(c.action).toBe("Delete program");
  });
  it("a scheduled one says its workouts come off their calendar", () => {
    const c = deleteProgramCopy({ ...base, start: "2026-11-16", end: "2026-12-13" });
    expect(c.lines[1]).toBe("Its workouts come off Devin's calendar (Nov 16 – Dec 13).");
  });
  it("a program with logged workouts is archived, never deleted", () => {
    const c = deleteProgramCopy({ ...base, logged: true, start: "2026-10-01", end: "2026-11-30" });
    expect(c.outcome).toBe("archive");
    expect(c.title).toBe('Archive "Powerbuilding Base"?');
    expect(c.action).toBe("Archive program");
    expect(c.lines.join(" ")).toMatch(/logged sets stay in their history/);
  });
  it("an archived program with logged workouts has nothing to do", () => {
    const c = deleteProgramCopy({ ...base, logged: true, archived: true });
    expect(c.outcome).toBe("none");
    expect(c.action).toBeNull();
  });
  it("one week, one workout, no name or first name", () => {
    const c = deleteProgramCopy({ ...base, name: null, firstName: null, weeks: 1, workouts: 1, start: "2026-11-10", end: "2026-11-10" });
    expect(c.title).toBe('Delete "this program"?');
    expect(c.lines[0]).toBe("1 week · 1 workout, nothing logged yet.");
    expect(c.lines[1]).toBe("Its workouts come off their calendar (Nov 10 – Nov 10).");
  });
});
