import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  endProgramCopy,
  endedToast,
  originLabel,
  programOwnership,
  programProgress,
  programProgressLine,
  replacesLine,
  switchCopy,
  savedEditLine,
  splitOwnPrograms,
} from "@/lib/my-program";

const ME = "user-me";
const COACH = "user-coach";

describe("programOwnership: who may change the program on the calendar", () => {
  it("a JF Effect plan the member started is theirs, from the library", () => {
    const blocks = [
      { id: "b1", created_by: ME, source_template_id: "t1" },
      { id: "b2", created_by: ME, source_template_id: "t1" },
    ];
    expect(programOwnership(blocks, ["b1", "b2"], ME)).toEqual({
      owned: true,
      origin: { kind: "jf", templateId: "t1" },
      blockId: "b1",
    });
  });

  it("a program they built points at it, even when it also has a template", () => {
    const blocks = [
      { id: "b1", created_by: ME, source_template_id: "t1", source_athlete_program_id: "p1" },
    ];
    expect(programOwnership(blocks, ["b1"], ME).origin).toEqual({ kind: "own", programId: "p1" });
  });

  it("a coach's program isn't the member's to change, even with one of their own blocks in it", () => {
    const blocks = [
      { id: "b1", created_by: COACH, source_template_id: "t1" },
      { id: "b2", created_by: ME },
    ];
    expect(programOwnership(blocks, ["b1", "b2"], ME)).toMatchObject({
      owned: false,
      origin: { kind: "coach" },
    });
  });

  it("only the program's own blocks count, and nobody signed in owns nothing", () => {
    const blocks = [
      { id: "b1", created_by: ME },
      { id: "old", created_by: COACH },
    ];
    expect(programOwnership(blocks, ["b1"], ME)).toEqual({
      owned: true,
      origin: { kind: "unknown" },
      blockId: "b1",
    });
    expect(programOwnership(blocks, ["b1"], null).owned).toBe(false);
    expect(programOwnership(blocks, ["missing"], ME)).toEqual({
      owned: false,
      origin: { kind: "unknown" },
      blockId: null,
    });
  });
});

describe("where a program came from, in words", () => {
  it("names the source plainly", () => {
    expect(originLabel("jf")).toBe("JF Effect plan");
    expect(originLabel("own")).toBe("Built by you");
    expect(originLabel("own", { copiedFrom: "@jane" })).toBe("Your copy of @jane's program");
    expect(originLabel("coach")).toBe("Written by your coach");
    expect(originLabel("unknown")).toBe("Your program");
  });

  it("splits built from copied", () => {
    const { built, copied } = splitOwnPrograms([
      { id: "a", forked_from: null },
      { id: "b", forked_from: { id: "x" } },
      { id: "c", forked_from: null },
    ]);
    expect(built.map((p) => p.id)).toEqual(["a", "c"]);
    expect(copied.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("progress line", () => {
  const base = {
    programWeek: 4,
    totalWeeks: 12,
    start: "2026-10-20",
    end: "2027-01-10",
    today: "2026-11-10",
  };
  it("says the week and the end while it runs", () => {
    expect(programProgressLine(base)).toBe("Week 4 of 12 · Ends Jan 10");
    expect(programProgress(base)).toBeCloseTo(4 / 12);
  });
  it("says when it starts before it has", () => {
    expect(programProgressLine({ ...base, programWeek: null, start: "2026-11-16" })).toBe(
      "Starts Nov 16 · 12 weeks",
    );
  });
  it("says when it finished after it has", () => {
    expect(programProgressLine({ ...base, end: "2026-11-08" })).toBe("Finished Nov 8");
    expect(programProgress({ ...base, end: "2026-11-08" })).toBe(1);
  });
});

describe("ending a program, said before the tap", () => {
  it("logged workouts stay; upcoming ones come off the calendar", () => {
    const c = endProgramCopy({ name: "Foundation Hypertrophy", logged: 9, upcoming: 27 });
    expect(c.title).toBe("End Foundation Hypertrophy?");
    expect(c.lines[0]).toBe("Its 27 upcoming workouts come off your calendar.");
    expect(c.lines[1]).toBe("The 9 workouts you logged stay in your history and PRs.");
    expect(c.action).toBe("End program");
  });
  it("nothing logged: it's removed, and singulars read right", () => {
    const c = endProgramCopy({ name: "", logged: 0, upcoming: 1 });
    expect(c.title).toBe("End this program?");
    expect(c.lines[0]).toBe("Its 1 upcoming workout comes off your calendar.");
    expect(c.lines[1]).toBe("You haven't logged anything in it, so it's removed completely.");
    expect(endedToast({ name: "Push Pull", logged: 0 })).toBe(
      "Push Pull removed from your calendar.",
    );
    expect(endedToast({ name: "Push Pull", logged: 1 })).toBe(
      "Push Pull ended. Your logged workouts are in your history.",
    );
  });
});

describe("saving an edit to a running program", () => {
  it("says how many upcoming workouts followed it", () => {
    expect(savedEditLine({ updated: 20, added: 4, removed: 0, kept: 9 })).toBe(
      "Saved. 24 upcoming workouts on your calendar updated. Workouts you've done or started stay as they were.",
    );
    expect(savedEditLine({ updated: 0, added: 0, removed: 0, kept: 3 })).toBe(
      "Saved. Nothing upcoming on your calendar needed changing.",
    );
    expect(savedEditLine(null)).toBe("Saved");
  });
});

describe("the database lets a member manage only their own program, and never loses history", () => {
  const sql = readFileSync("supabase/migrations/20270225090000_member_program_manage.sql", "utf8");
  it("ending checks ownership, keeps logged blocks (archived) and only removes untouched ones", () => {
    expect(sql).toContain(
      "WHERE id = _block_id AND client_id = v_client AND created_by = v_uid AND archived = false;",
    );
    expect(sql).toMatch(
      /IF EXISTS \(SELECT 1 FROM public\.pl_weeks w JOIN public\.pl_days d ON d\.week_id = w\.id\s+WHERE w\.block_id = v_id AND public\.pl_day_logged\(d\.id\)\) THEN\s+UPDATE public\.pl_blocks SET status = 'Archived'/,
    );
    // asked without _confirm it only reports
    expect(sql).toContain("IF NOT coalesce(_confirm, false) THEN");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.member_program_end(uuid, boolean) TO authenticated;",
    );
  });
  it("a running copy follows edits only on workouts nobody has touched, and keeps the cardio row", () => {
    expect(sql).toContain("IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN");
    expect(sql).toContain(
      "DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;",
    );
    expect(sql).toContain("source_athlete_program_id = _id AND archived = false");
  });
  it("today is read through the Manitoba-aware helper, never a bare AT TIME ZONE", () => {
    expect(sql).toContain("public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'))");
    expect(sql).not.toMatch(/AT TIME ZONE 'America\/Winnipeg'/);
  });
});

describe("the screens: one Programs page, every program says where it's from, and the running one can be managed", () => {
  const hub = readFileSync("src/components/athlete-programs/programs-hub.tsx", "utf8");
  const sheet = readFileSync("src/components/athlete-programs/manage-program-sheet.tsx", "utf8");
  const workouts = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");

  it("My programs: on your calendar first, then built, copied and saved JF Effect plans as their own sections", () => {
    const order = [
      "<OnYourCalendar",
      'title="Built by you"',
      'title="Copied from the crew"',
      'title="Saved JF Effect plans"',
    ];
    const at = order.map((s) => hub.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // saved JF Effect plans are read back (they used to be saved and never shown anywhere)
    expect(hub).toContain("const saved = useSavedPlans(isSelfServe);");
  });

  it("the tab rides in the address, so Back lands on the tab a program was opened from", () => {
    expect(hub).toContain(
      'navigate({ to: "/portal/programs", search: { tab: t }, replace: true } as any);',
    );
  });

  it("the Workouts program card ends in a Manage program row (with where it came from) only for a member's own program", () => {
    expect(workouts).toContain(
      'const canManageProgram = mode === "self" && isSelfServe && origin.owned && !!origin.blockId;',
    );
    expect(workouts).toContain(
      "onManage={canManageProgram ? () => setManageOpen(true) : undefined}",
    );
    expect(workouts).toContain("manageHint={canManageProgram ? origin.label : null}");
    // a plain row, never a hidden ⋯ in the header
    expect(card).toContain("data-manage-program-row");
    expect(card).not.toContain('aria-label="Manage program"');
    expect(card).toContain(") : !browsing && onManage ? (");
  });

  it("a finished program of their own points at the next one; a one-block program's weeks fold like a roadmap", () => {
    expect(card).toContain("{!browsing && nextProgramTo && allDone ? (");
    expect(card).toContain("<span>Choose your next program</span>");
    expect(workouts).toContain('nextProgramTo={mode === "self" && isSelfServe ? "/portal/programs" : undefined}');
    expect(card).toContain('showAll ? "Hide the weeks" : "See all weeks"');
    expect(card).toContain("{showAll && (");
    expect(card).not.toContain("(showAll || blocks.length === 1)");
  });

  it("a rest day says what's next, and a member with no program sees only the way to one", () => {
    expect(workouts).toContain("next={nextWorkoutAfter(byDate, selectedDate)}");
    expect(workouts).toContain('{next ? "Rest day" : "No workout"}');
    expect(workouts).toContain(
      'const noProgram = mode === "self" && isSelfServe && !isLoading && dayItems.length === 0;',
    );
    expect(workouts).toContain("{!noProgram && (");
  });

  it("Manage: edit (own programs), see the plan (JF Effect), switch, end, with what ending does said before the tap", () => {
    for (const label of [
      'title="Edit program"',
      'title="See the plan"',
      'title="Switch program"',
      'title="End program"',
    ]) {
      expect(sheet).toContain(label);
    }
    expect(sheet).toContain("const facts = await preview.mutateAsync(origin.blockId);");
    expect(sheet).toContain("if (isImpersonating) return toast.message(PREVIEW);");
  });

  it("saving an edit to the running program updates the calendar's untouched workouts", () => {
    const editor = readFileSync("src/components/athlete-programs/use-program-editor.ts", "utf8");
    expect(editor).toContain("const r = await syncRunning({ data: { programId: id } });");
    const fn = readFileSync("src/lib/athlete-programs.functions.ts", "utf8");
    expect(fn).toContain('rpc("athlete_program_sync_running", {');
    expect(fn).toContain("if (r.added || r.removed) {");
  });
});

describe("starting or switching a program, said before the tap", () => {
  it("a first program just starts", () => {
    expect(switchCopy({ title: "Strength 4 Day", current: null })).toEqual({
      kind: "start",
      title: "Start Strength 4 Day",
      lines: [],
      action: "Start program",
    });
  });
  it("switching says what ends, what comes off the calendar and what stays", () => {
    const c = switchCopy({ title: "Strength 4 Day", current: "Upper Lower Basics", logged: 4, upcoming: 9 });
    expect(c.kind).toBe("switch");
    expect(c.title).toBe("Switch to Strength 4 Day");
    expect(c.lines).toEqual([
      "Upper Lower Basics ends. Its 9 upcoming workouts come off your calendar.",
      "The 4 workouts you finished stay in your history and PRs.",
    ]);
    expect(c.action).toBe("Switch program");
  });
  it("a finished program moves to the past; unknown counts still promise the history", () => {
    const c = switchCopy({ title: "B", current: "A", currentFinished: true });
    expect(c.lines).toEqual([
      "A is finished and moves to your past programs.",
      "Every workout you finished stays in your history and PRs.",
    ]);
  });
  it("the same program again is starting over", () => {
    const c = switchCopy({ title: "A", current: "A", same: true, logged: 0 });
    expect(c.kind).toBe("restart");
    expect(c.action).toBe("Start over");
    expect(c.lines[1]).toBe("You haven't finished a workout in it yet.");
  });
  it("the line under a program's button names what it replaces", () => {
    expect(replacesLine("Upper Lower Basics")).toBe(
      "Replaces Upper Lower Basics. Workouts you've finished stay in your history.",
    );
    expect(replacesLine(null)).toBeNull();
  });
});

describe("the membership screens stay calm and never dead-end", () => {
  it("an empty JF Effect library says so and points at building or the crew, never an empty search", () => {
    const lib = readFileSync("src/route-pages/_authenticated/portal/plans.tsx", "utf8");
    expect(lib).toContain("if (!isLoading && !isError && plans.length === 0) {");
    expect(lib).toContain("JF Effect plans are on the way");
    expect(lib).toContain('<Link to="/portal/programs/new">Build your own</Link>');
  });

  it("training analytics' picked chips and unit switch are neutral, never the brand red", () => {
    const bar = readFileSync("src/components/analytics/analytics-filter-bar.tsx", "utf8");
    const dash = readFileSync("src/components/analytics/client-analytics-dashboard.tsx", "utf8");
    expect(bar).not.toContain("border-primary bg-primary text-primary-foreground");
    expect(bar).toContain('? "border-foreground bg-foreground text-background"');
    expect(dash).not.toContain("data-[state=on]:bg-primary");
  });

  it("Programs pages light the Workouts tab, and the start sheet replaces itself in history", () => {
    const nav = readFileSync("src/lib/admin-nav.ts", "utf8");
    expect(nav).toContain('export const WORKOUTS_AREA = ["/portal/programs", "/portal/plans", "/portal/exercises"];');
    expect(nav.match(/activeOn: WORKOUTS_AREA/g)?.length).toBe(2);
    const dialog = readFileSync("src/components/programs/start-plan-dialog.tsx", "utf8");
    expect(dialog).toContain('navigate({ to: "/portal/workouts", replace: true });');
    expect(dialog).toContain("data-switch-note");
  });
});
