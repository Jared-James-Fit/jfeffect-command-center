import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deleteSavedProgramCopy,
  endProgramCopy,
  endedToast,
  historyActions,
  historyCompleted,
  historyNextLine,
  historyProgressLine,
  historyStatus,
  originLabel,
  pausedProgram,
  pausedToast,
  removeFromHistoryCopy,
  resumeCopy,
  type HistoryEntry,
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

describe("ending or pausing a program, said before the tap: nothing is ever deleted", () => {
  it("upcoming workouts come off the calendar, it moves to the history, logged ones stay", () => {
    const c = endProgramCopy({ name: "Foundation Hypertrophy", logged: 9, upcoming: 27 });
    expect(c.title).toBe("End Foundation Hypertrophy?");
    expect(c.lines).toEqual([
      "Its 27 upcoming workouts come off your calendar.",
      "It moves to your program history, where you can resume it or start it over.",
      "The 9 workouts you logged stay in your history, PRs and progress.",
    ]);
    expect(c.action).toBe("End program");
  });
  it("nothing logged is still kept (never 'removed completely'), and singulars read right", () => {
    const c = endProgramCopy({ name: "", logged: 0, upcoming: 1 });
    expect(c.title).toBe("End this program?");
    expect(c.lines[0]).toBe("Its 1 upcoming workout comes off your calendar.");
    expect(c.lines[2]).toBe("You haven't logged a workout in it yet.");
    expect(c.lines.join(" ")).not.toMatch(/removed completely|deleted/);
    expect(endedToast({ name: "Push Pull", logged: 0 })).toBe(
      "Push Pull ended. It's in your program history.",
    );
  });
  it("pausing says the workouts are off until they resume", () => {
    expect(pausedToast({ name: "Apex", upcoming: 18 })).toBe(
      "Apex paused. Its 18 upcoming workouts are off your calendar until you resume.",
    );
    expect(pausedToast({ name: "Apex", upcoming: 1 })).toBe(
      "Apex paused. Its 1 upcoming workout is off your calendar until you resume.",
    );
    expect(pausedToast({ name: "Apex", upcoming: 0 })).toBe("Apex paused. Resume it any time.");
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
  const history = readFileSync(
    "supabase/migrations/20270424090000_member_program_history.sql",
    "utf8",
  );
  it("ending or pausing checks ownership and archives the whole program, never deleting a block", () => {
    const end = history.slice(
      history.indexOf("CREATE OR REPLACE FUNCTION public.member_program_end("),
    );
    const body = end.slice(0, end.indexOf("$$;"));
    expect(body).toContain(
      "WHERE id = _block_id AND client_id = v_client AND created_by = v_uid AND archived = false;",
    );
    expect(body).toContain(
      "PERFORM public._member_program_archive(v_client, v_uid, v_ids, v_reason);",
    );
    expect(body).not.toMatch(/DELETE FROM public\.pl_blocks/);
    // asked without _confirm it only reports; older apps' two arguments still work
    expect(body).toContain("IF NOT coalesce(_confirm, false) THEN");
    expect(history).toContain(
      "_confirm boolean DEFAULT false,\n                                                     _reason text DEFAULT 'ended')",
    );
    expect(history).toContain(
      "GRANT EXECUTE ON FUNCTION public.member_program_end(uuid, boolean, text) TO authenticated;",
    );
    // the archive helper only ever sets archived; it never deletes
    const helper = history.slice(
      history.indexOf("FUNCTION public._member_program_archive("),
      history.indexOf("-- 2. End or pause"),
    );
    expect(helper).not.toMatch(/DELETE/);
    expect(helper).toContain(
      "GRANT EXECUTE ON FUNCTION public._member_program_archive(uuid, uuid, uuid[], text) TO service_role;",
    );
    expect(helper).toContain(
      "REVOKE ALL ON FUNCTION public._member_program_archive(uuid, uuid, uuid[], text) FROM PUBLIC, anon, authenticated;",
    );
  });
  it("every archive of a member's own program lands in their history; a coach's never does", () => {
    expect(history).toContain("AFTER UPDATE OF archived ON public.pl_blocks");
    expect(history).toContain(
      "IF v_owner IS NULL OR NEW.created_by IS DISTINCT FROM v_owner THEN RETURN NULL; END IF;",
    );
    // a switch from either start path is recorded as a switch
    expect(history).toContain(
      "v_reason := CASE WHEN auth.uid() = v_owner THEN 'switched' ELSE 'ended' END;",
    );
    const start = readFileSync("src/lib/member-plan-start.functions.ts", "utf8");
    expect(start).toContain('rpc("_member_program_archive", {');
    expect(start).toContain('_reason: "switched",');
  });
  it("the history and its table are the member's own: read through RLS, written only by the functions", () => {
    expect(history).toContain("FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));");
    expect(history).toContain(
      "REVOKE ALL ON public.member_program_history FROM anon, authenticated;",
    );
    expect(history).toContain("GRANT SELECT ON public.member_program_history TO authenticated;");
    // resume: members with access only; the program they run now moves to the history first
    expect(history).toContain(
      "WHERE c.user_id = _uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;",
    );
    expect(history).toContain("IF NOT public.member_can_consume(_uid) THEN");
    expect(history).toContain(
      "PERFORM public._member_program_archive(v_client, _uid, v_running, 'switched');",
    );
    // undo only removes a program nothing in it was opened or logged in, and only right after
    expect(history).toContain("created_at < now() - interval '30 minutes'");
    expect(history).toMatch(
      /public\.pl_day_logged\(d\.id\) OR EXISTS \(SELECT 1 FROM public\.pl_day_completions c WHERE c\.day_id = d\.id\)/,
    );
    // removing from the history only hides it
    const hide = history.slice(
      history.indexOf("FUNCTION public.member_program_history_hide("),
      history.indexOf("-- 7. Deleting"),
    );
    expect(hide).not.toMatch(/DELETE|UPDATE public\.pl_/);
  });
  it("a deleted program can be undone exactly: the running copy keeps its link and its sharing is kept", () => {
    const del = history.slice(
      history.indexOf("FUNCTION public.athlete_program_delete("),
      history.indexOf("FUNCTION public.athlete_program_restore("),
    );
    expect(del).not.toContain("source_athlete_program_id = NULL");
    expect(del).not.toContain("visibility = 'private'");
    expect(history).toContain(
      "GRANT EXECUTE ON FUNCTION public.athlete_program_restore(uuid) TO authenticated;",
    );
  });
  it("a running copy follows edits only on workouts nobody has touched, and keeps the cardio row", () => {
    expect(sql).toContain("IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN");
    expect(sql).toContain(
      "DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;",
    );
    expect(sql).toContain("source_athlete_program_id = _id AND archived = false");
  });
  it("today is read through the Manitoba-aware helpers, never a bare AT TIME ZONE", () => {
    expect(sql).toContain("public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'))");
    expect(history).toContain("public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'))");
    expect(history).toContain("public.instant_to_local(");
    for (const f of [sql, history]) expect(f).not.toMatch(/AT TIME ZONE/);
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

  it("Manage sits beside the program's name on Workouts and on Programs, only for a member's own program", () => {
    expect(workouts).toContain(
      'const canManageProgram = mode === "self" && isSelfServe && origin.owned && !!origin.blockId;',
    );
    expect(workouts).toContain(
      "onManage={canManageProgram ? () => setManageOpen(true) : undefined}",
    );
    expect(workouts).not.toContain("manageHint");
    // a labelled button in the heading, never a hidden ⋯ or a row at the bottom of the roadmap
    expect(card).toContain("data-manage-program");
    expect(card).not.toContain("data-manage-program-row");
    expect(card).not.toContain('aria-label="Manage program"');
    // the card is always today's program (another one is only looked at in the plan sheet)
    expect(card).toContain(
      "onManage={!(allDone && nextProgramTo) ? onManage : undefined}",
    );
    // the Programs page's running program is the same heading, with one way to Workouts
    expect(hub).toContain("<ActiveProgramHeader");
    expect(hub).toContain("onManage={canManage ? () => setManageOpen(true) : undefined}");
    expect(hub).toContain("data-open-workouts");
    // Training days has one door on Workouts (its ⋯), never a second one in Manage
    expect(sheet).not.toContain('title="Training days"');
    expect(workouts).toContain('<CalendarCheck className="mr-2 h-4 w-4" /> Training days');
  });

  it("a finished program of their own points at the next one; every week of the plan is one tap away, never a fold", () => {
    expect(card).toContain("{nextProgramTo && allDone ? (");
    expect(card).toContain("<span>Choose your next program</span>");
    expect(workouts).toContain(
      'nextProgramTo={mode === "self" && isSelfServe ? "/portal/programs" : undefined}',
    );
    expect(card).toContain("<span>Full plan</span>");
    expect(card).not.toContain("<span>Plan details</span>");
    expect(card).toContain("function ProgramPlanSheet(");
  });

  it("a rest day says what's next, and a member with no program sees only the way to one", () => {
    expect(workouts).toContain("next={nextWorkoutAfter(byDate, selectedDate)}");
    expect(workouts).toContain('{next ? "Rest day" : "No workout"}');
    expect(workouts).toContain(
      'const noProgram = mode === "self" && isSelfServe && !isLoading && dayItems.length === 0;',
    );
    expect(workouts).toContain('{mode === "self" && !noProgram && (');
    // a coaching client's past blocks are the Training plan's Training history (apart from
    // today's program); a member's past programs are Program history (in the ⋯), never listed twice
    const page = readFileSync("src/routes/_authenticated/portal/workouts.index.tsx", "utf8");
    expect(page).toContain("history={<PastPrograms clientId={client.id} />}");
    expect(page).toContain("if (loading || isSelfServe) return null;");
    expect(workouts).toContain("history={historySlot}");
  });

  it("Manage: edit (own programs), see the plan (JF Effect), switch, pause, then end set apart", () => {
    for (const label of [
      'title="Edit program"',
      'title="See the plan"',
      'title="Switch program"',
      'title="Pause program"',
      'title="End program"',
    ]) {
      expect(sheet).toContain(label);
    }
    expect(sheet).toContain("const facts = await preview.mutateAsync(origin.blockId);");
    expect(sheet).toContain("if (isImpersonating) return toast.message(PREVIEW);");
    // End is set apart from the everyday rows and says where it goes before the tap
    expect(sheet.indexOf('title="Pause program"')).toBeLessThan(
      sheet.indexOf('title="End program"'),
    );
    expect(sheet).toContain("data-manage-end");
    expect(sheet).toContain(
      "It moves to your program history. Workouts you've logged stay in your history and PRs.",
    );
    // pausing and ending both have Undo (resume the same program right where it was)
    expect(sheet).toContain('end.mutateAsync({ blockId: origin.blockId, reason: "paused" })');
    expect(sheet).toContain('end.mutateAsync({ blockId: origin.blockId, reason: "ended" })');
    expect(sheet).toContain("void resumeFn({ data: { key, startDate: null } })");
    expect(sheet.match(/\.\.\.undo\(done\.key, label\)/g)?.length).toBe(2);
    // End isn't a delete any more: no destructive red on it
    expect(sheet).not.toContain("bg-destructive");
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
  it("switching says where the current one goes, what comes off the calendar and what stays", () => {
    const c = switchCopy({
      title: "Strength 4 Day",
      current: "Upper Lower Basics",
      logged: 4,
      upcoming: 9,
    });
    expect(c.kind).toBe("switch");
    expect(c.title).toBe("Switch to Strength 4 Day");
    expect(c.lines).toEqual([
      "Upper Lower Basics moves to your program history. Its 9 upcoming workouts come off your calendar.",
      "The 4 workouts you finished stay in your history and PRs.",
    ]);
    expect(c.action).toBe("Switch program");
  });
  it("a finished program moves to the past; unknown counts still promise the history", () => {
    const c = switchCopy({ title: "B", current: "A", currentFinished: true });
    expect(c.lines).toEqual([
      "A is finished and moves to your program history.",
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
      "Replaces Upper Lower Basics, which moves to your program history.",
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
    expect(bar).not.toContain("bg-primary");
    expect(dash).not.toContain("data-[state=on]:bg-primary");
    expect(dash).toContain("data-[state=on]:bg-foreground data-[state=on]:text-background");
  });

  it("Programs pages light the Workouts tab, and the start sheet replaces itself in history", () => {
    const nav = readFileSync("src/lib/admin-nav.ts", "utf8");
    expect(nav).toContain(
      'export const WORKOUTS_AREA = ["/portal/programs", "/portal/plans", "/portal/exercises", "/portal/schedule"];',
    );
    expect(nav.match(/activeOn: WORKOUTS_AREA/g)?.length).toBe(2);
    const dialog = readFileSync("src/components/programs/start-plan-dialog.tsx", "utf8");
    expect(dialog).toContain('navigate({ to: "/portal/workouts", replace: true });');
    expect(dialog).toContain("data-switch-note");
    // the old program's days never show after a switch or an end while the list refetches
    expect(dialog).toContain('void qc.resetQueries({ queryKey: ["my-workouts"] });');
    const hook = readFileSync("src/components/athlete-programs/use-my-program.ts", "utf8");
    expect(hook).toContain('void qc.resetQueries({ queryKey: ["my-workouts"] });');
  });
});

describe("Workouts reads today first, and every page under it has a way back", () => {
  const workouts = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  it("no Week · Month · Block switch: the page is the week, the month a full-screen page behind the calendar icon", () => {
    expect(workouts).not.toContain("ScheduleViewSwitch");
    expect(workouts).not.toContain('aria-label="Schedule view"');
    expect(workouts).toContain('onClick={() => openLayer("month")}');
    expect(workouts).toContain('<FullScreenPage open={layer === "month"}');
  });

  it("no empty Recovery & Performance before there's anything in it", () => {
    // the section only with a program, and it says nothing until something's logged or flagged
    expect(workouts).toMatch(/mode === "self" && !noProgram && !isLoading && dayItems.length > 0 && \(\s*<DeferRender/);
    const section = readFileSync("src/components/workouts/recovery-performance.tsx", "utf8");
    expect(section).toContain("if (!everLogged && !recovery.pain.length && !recovery.general.length) return null;");
  });

  it("Programs and Move workouts have Back like the program, plan, builder and analytics pages", () => {
    const hub = readFileSync("src/components/athlete-programs/programs-hub.tsx", "utf8");
    expect(hub).toMatch(/title="Programs"\s+backTo="\/portal\/workouts"/);
    const move = readFileSync("src/routes/_authenticated/portal/schedule.tsx", "utf8");
    expect(move).toContain('backTo="/portal/workouts"');
  });
});

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  key: "k1",
  name: "Apex Hypertrophy",
  reason: "paused",
  off_on: "2026-11-18",
  start: "2026-11-02",
  end: "2026-11-29",
  blocks: 1,
  weeks: 4,
  total: 12,
  done: 6,
  remaining: 5,
  last_trained: "2026-11-16T23:00:00Z",
  next: { week: 3, day: 2, title: "Day 2" },
  days_per_week: 3,
  template_id: null,
  plan_id: null,
  program_id: null,
  origin: "jf",
  copied: false,
  can_resume: true,
  ...over,
});

describe("program history, in words", () => {
  const today = "2026-12-02";
  it("says why it came off the calendar and when", () => {
    expect(historyStatus(entry(), today)).toBe("Paused Nov 18");
    expect(historyStatus(entry({ reason: "switched" }), today)).toBe("Switched Nov 18");
    expect(historyStatus(entry({ reason: "ended" }), today)).toBe("Ended Nov 18");
    // a paused program with nothing left to do isn't "paused" any more
    expect(historyStatus(entry({ remaining: 0 }), today)).toBe("Ended Nov 18");
    expect(historyStatus(entry({ remaining: 0, done: 12 }), today)).toBe("Completed Nov 18");
    expect(historyCompleted(entry({ remaining: 0, done: 12 }))).toBe(true);
    // last year's say the year
    expect(historyStatus(entry({ off_on: "2025-06-01", reason: "ended" }), today)).toBe(
      "Ended Jun 1, 2025",
    );
  });
  it("says how far they got and over which days, ending where it came off", () => {
    expect(historyProgressLine(entry(), today)).toBe("6 of 12 workouts done · Nov 2 – Nov 18");
    expect(historyProgressLine(entry({ off_on: "2026-12-20" }), today)).toBe(
      "6 of 12 workouts done · Nov 2 – Nov 29",
    );
  });
  it("says where it picks up, naming the workout only when it says more than its number", () => {
    expect(historyNextLine(entry())).toBe("Picks up at Week 3 · Day 2");
    expect(historyNextLine(entry({ next: { week: 3, day: 2, title: "Lower A" } }))).toBe(
      "Picks up at Week 3 · Day 2 (Lower A)",
    );
    expect(historyNextLine(entry({ next: null }))).toBeNull();
  });
  it("offers Resume while there's work left, Start over while its source still exists, nothing to a coaching client", () => {
    expect(historyActions(entry({ plan_id: "p" }), { member: true })).toEqual({
      resume: true,
      restart: "plan",
    });
    expect(historyActions(entry({ program_id: "x" }), { member: true })).toEqual({
      resume: true,
      restart: "program",
    });
    expect(historyActions(entry({ remaining: 0, can_resume: false }), { member: true })).toEqual({
      resume: false,
      restart: null,
    });
    expect(historyActions(entry({ plan_id: "p" }), { member: false })).toEqual({
      resume: false,
      restart: null,
    });
  });
  it("Workouts offers back only a paused program, only while nothing else runs", () => {
    const list = [entry({ key: "a", reason: "switched" }), entry({ key: "b" })];
    expect(pausedProgram(list, false)?.key).toBe("b");
    expect(pausedProgram(list, true)).toBeNull();
    expect(pausedProgram([entry({ remaining: 0 })], false)).toBeNull();
    expect(pausedProgram(null, false)).toBeNull();
  });
  it("the resume sheet says where it picks up, what's left, and where the current one goes", () => {
    const c = resumeCopy({
      name: "Apex",
      next: { week: 3, day: 2, title: null },
      remaining: 5,
      current: "Builder",
    });
    expect(c.title).toBe("Resume Apex");
    expect(c.lines).toEqual([
      "Picks up at Week 3 · Day 2. 5 workouts left.",
      "Builder moves to your program history.",
      "Workouts you already did keep their dates.",
    ]);
    expect(c.action).toBe("Resume program");
  });
  it("removing from the history and deleting a saved program each say exactly what goes and what stays", () => {
    const r = removeFromHistoryCopy({ name: "Apex", done: 6 });
    expect(r.title).toBe("Remove Apex from your history?");
    expect(r.lines[1]).toBe(
      "The 6 workouts you logged in it stay in your training history, PRs and progress.",
    );
    const d = deleteSavedProgramCopy({ title: "My Split", shared: true, running: true });
    expect(d.title).toBe("Delete My Split?");
    expect(d.lines).toEqual([
      "It's removed from My programs and from the crew.",
      "Workouts you logged from it stay in your history and PRs. Copies other people saved stay theirs.",
      "It stays on your calendar. To take it off, use End program in Manage.",
    ]);
    expect(d.action).toBe("Delete program");
    expect(
      deleteSavedProgramCopy({ title: "X", shared: false, running: false }).lines,
    ).toHaveLength(2);
  });
});

describe("program history screens", () => {
  const workouts = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  const hub = readFileSync("src/components/athlete-programs/programs-hub.tsx", "utf8");
  const page = readFileSync("src/components/athlete-programs/program-history.tsx", "utf8");
  const dialog = readFileSync("src/components/programs/start-plan-dialog.tsx", "utf8");
  it("Workouts: a paused program comes back with one tap where the empty state was; the ⋯ opens the history", () => {
    expect(workouts).toContain(
      "const paused = noProgram ? pausedProgram(history.data, false) : null;",
    );
    expect(workouts).toContain("<PausedProgramCard entry={paused} />");
    expect(workouts).toContain('navigate({ to: "/portal/programs/history" as any })');
    // every ⋯ on the page is a bottom sheet on a phone, never a corner dropdown
    expect(workouts).not.toContain("DropdownMenu");
    expect(workouts.match(/<CardMenu\b/g)?.length).toBe(2);
  });
  it("My programs: a paused program in place of what's on the calendar, and one row to the history", () => {
    expect(hub).toContain("{!hasRunning && paused && (");
    expect(hub).toContain(
      "{isSelfServe && pastCount > 0 && <ProgramHistoryRow count={pastCount} />}",
    );
  });
  it("a past program's sheet: Resume, Start over, then Remove set apart with Undo", () => {
    expect(page.indexOf("data-history-resume")).toBeLessThan(page.indexOf("data-history-restart"));
    expect(page.indexOf("data-history-restart")).toBeLessThan(page.indexOf("data-history-remove"));
    expect(page).toContain(
      "void hide\n              .mutateAsync({ key: target.key, hidden: false })",
    );
    expect(page).toContain(
      "Only takes it off this list. Your logged workouts, PRs and progress stay.",
    );
  });
  it("switching has Undo, and resuming goes through the same sheet as starting", () => {
    expect(dialog).toContain("res.replacedKey && res.blockId");
    expect(dialog).toContain(
      "data: { blockId: res.blockId!, restoreKey: res.replacedKey, previousDays: res.previousDays ?? null },",
    );
    expect(dialog).toContain(
      "const r = await resumeFn({ data: { key: resume.key, startDate: startDate || null, trainingDays: days } });",
    );
  });
});
