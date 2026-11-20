import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { draftIssue, draftProblem, type ProgramDraft } from "@/lib/athlete-programs";
import {
  DRAFT_BACKUP_MAX_AGE_MS,
  draftBackupKey,
  sameDraft,
  topMuscleGroups,
  usableBackup,
} from "@/lib/athlete-program-draft";
import {
  addExercises,
  newPlan,
  newPlanExercise,
  planPayload,
  scopeWeeks,
  setExercise,
} from "@/lib/program-plan";
import { cellInvalid, cellPatch, cellText, loadModeOf, parseRest } from "@/lib/program-cells";

const EX = "11111111-1111-4111-8111-111111111111";
const lib = (id: string, name: string, muscle_group: string | null = null) => ({ id, name, muscle_group, equipment: null });
const read = (p: string) => readFileSync(p, "utf8");

function program(): ProgramDraft {
  let plan = newPlan(4);
  const day = plan.blocks[0].weeks[0].days[0].key;
  plan = addExercises(plan, scopeWeeks(plan, { b: 0, w: 0 }, "block"), day, [newPlanExercise(lib(EX, "Bench"))]).plan;
  return { id: null, title: "Upper / Lower", description: "", goal: "muscle", level: null, plan };
}

describe("program builder: where the problem is", () => {
  it("points at the name, or the exact block, week and day to fix", () => {
    expect(draftIssue(program())).toBeNull();
    expect(draftIssue({ ...program(), title: " " })).toMatchObject({ at: "title" });
    expect(draftProblem({ ...program(), plan: newPlan(4) })).toBe("Add an exercise to Day 1 (week 1).");
  });
});

describe("program builder: the cells", () => {
  const e = newPlanExercise(lib(EX, "Bench"));
  it("each cell reads its number and the word beside it", () => {
    expect(cellText(e, "sets")).toEqual({ value: "3" });
    expect(cellText({ ...e, rir: "2" }, "effort")).toEqual({ value: "2", unit: "RIR" });
    expect(cellText({ ...e, pct: 90, pct_of: "top_set" }, "load")).toEqual({ value: "90", unit: "% top" });
    expect(cellText({ ...e, load: 102.5, unit: "kg" }, "load")).toEqual({ value: "102.5", unit: "kg" });
    expect(cellText(e, "rest")).toEqual({ value: "2:00" });
  });
  it("what's typed becomes the number only when it reads; nothing is invented", () => {
    expect(cellPatch(e, "sets", "5")).toEqual({ sets: 5 });
    expect(cellPatch(e, "sets", "0")).toBeNull();
    expect(cellPatch(e, "sets", "")).toBeNull();
    expect(cellPatch(e, "reps", "6-8")).toEqual({ reps: "6-8" });
    expect(cellPatch(e, "effort", "8,5")).toEqual({ rpe: "8.5", rir: null });
    expect(cellPatch({ ...e, rir: "2" }, "effort", "1")).toEqual({ rir: "1", rpe: null });
    expect(cellPatch(e, "load", "225", "lb")).toEqual({ load: 225, unit: "lb", pct: null, pct_of: null });
    expect(cellPatch(e, "load", "75", "pct_1rm")).toEqual({ pct: 75, pct_of: "1rm", load: null, unit: null });
    expect(cellPatch(e, "load", "")).toEqual({ load: null, pct: null, pct_of: null, unit: null });
    expect(cellPatch(e, "load", "abc")).toBeNull();
    expect(cellPatch(e, "rest", "2:30")).toEqual({ rest_seconds: 150 });
  });
  it("rest reads like people type it", () => {
    expect(parseRest("90")).toEqual({ ok: true, seconds: 90 });
    expect(parseRest("2")).toEqual({ ok: true, seconds: 120 });
    expect(parseRest("1.5")).toEqual({ ok: true, seconds: 90 });
    expect(parseRest("")).toEqual({ ok: true, seconds: null });
    expect(parseRest("x")).toEqual({ ok: false });
  });
  it("a load's meaning is kept with it (a relabel, never a conversion)", () => {
    expect(loadModeOf({ load: 100, unit: "kg", pct: null, pct_of: null })).toBe("kg");
    expect(loadModeOf({ load: null, unit: null, pct: 90, pct_of: "top_set" })).toBe("pct_top");
    expect(loadModeOf({ load: null, unit: null, pct: null, pct_of: null }, "kg")).toBe("kg");
  });
  it("outlines what wouldn't save, never blocking the typing", () => {
    expect(cellInvalid({ ...e, reps: " " }, "reps")).toBe(true);
    expect(cellInvalid({ ...e, rpe: "12" }, "effort")).toBe(true);
    expect(cellInvalid({ ...e, rpe: "7.5-8" }, "effort")).toBe(false);
  });
  it("browse chips are the library's biggest muscle groups, any spelling once", () => {
    const groups = topMuscleGroups([
      lib("a", "A", "Chest"),
      lib("b", "B", "chest "),
      lib("c", "C", "Back"),
      lib("d", "D", null),
    ]);
    expect(groups).toEqual(["Chest", "Back"]);
  });
});

describe("program builder: the draft kept on the phone", () => {
  const now = Date.UTC(2026, 10, 19);
  const ok = program();
  const backup = (over: Record<string, unknown> = {}) => ({ v: 2, base: null, savedAt: now - 60_000, draft: ok, ...over });

  it("is per login and per program", () => {
    expect(draftBackupKey("u1", null)).toBe("jf.program-draft.v1:u1:new");
    expect(draftBackupKey("u1", "p1")).toBe("jf.program-draft.v1:u1:p1");
  });

  it("is picked up only from the same saved version, while it's fresh", () => {
    expect(usableBackup(backup(), null, now)?.title).toBe("Upper / Lower");
    expect(usableBackup(backup({ base: "2026-11-01T00:00:00Z" }), null, now)).toBeNull();
    expect(usableBackup(backup({ savedAt: now - DRAFT_BACKUP_MAX_AGE_MS - 1 }), null, now)).toBeNull();
  });

  it("a copy from before plans (one week of days) comes back as that week repeated", () => {
    const v1 = {
      v: 1,
      base: null,
      savedAt: now - 1000,
      draft: { title: "Old", description: "", goal: null, level: null, weeks: 3, days: [{ title: "A", exercises: [{ exercise_id: EX, sets: 3, reps: "5" }] }] },
    };
    const d = usableBackup(v1, null, now)!;
    expect(d.plan.blocks[0].weeks).toHaveLength(3);
    expect(d.plan.blocks[0].weeks[2].days[0].exercises[0].reps).toBe("5");
  });

  it("anything that isn't a draft is ignored", () => {
    expect(usableBackup(null, null, now)).toBeNull();
    expect(usableBackup("x", null, now)).toBeNull();
    expect(usableBackup(backup({ v: 3 }), null, now)).toBeNull();
    expect(usableBackup(backup({ draft: { title: "x" } }), null, now)).toBeNull();
    expect(usableBackup(backup({ draft: { ...ok, plan: { blocks: [] } } }), null, now)).toBeNull();
  });

  it("a copy that matches the saved program isn't offered (keys and names don't count)", () => {
    const again: ProgramDraft = { ...ok, plan: JSON.parse(JSON.stringify(planPayload(ok.plan))) };
    expect(sameDraft(ok, again)).toBe(true);
    const day = ok.plan.blocks[0].weeks[0].days[0];
    const changed = setExercise(ok.plan, [{ b: 0, w: 2 }], day.key, day.exercises[0].key, { reps: "5" });
    expect(sameDraft(ok, { ...ok, plan: changed })).toBe(false);
  });
});

describe("program builder: one screen for phones and computers", () => {
  const builder = read("src/components/athlete-programs/program-builder.tsx");
  const bench = read("src/components/athlete-programs/workbench/program-workbench.tsx");
  const rows = read("src/components/athlete-programs/workbench/rows.tsx");
  const cells = read("src/components/athlete-programs/workbench/cells.tsx");
  const css = read("src/styles.css");

  it("a new program starts as 12 weeks; an existing one opens on its plan", () => {
    expect(builder).toContain("plan: newPlan(12)");
    expect(builder).toContain("plan: detailPlan(existing)");
    expect(builder).toContain("return <ProgramWorkbench editor={editor} />;");
  });

  it("on a phone it owns the screen: its header at the notch, its week bar where the tab bar was", () => {
    expect(bench).toContain('html.setAttribute("data-program-builder", "");');
    expect(css).toContain("html[data-program-builder] [data-mobile-bottom-nav] { display: none !important; }");
    expect(css).toContain(".pb-header { top: var(--app-chrome-top); padding-top: var(--app-safe-top); }");
    // the week bar steps aside for the keyboard; the quick-value bar sits on it
    expect(rows).toContain("data-hide-on-keyboard");
    expect(cells).toContain("style={{ top: box.top + box.height - 52 }}");
  });

  it("says which weeks an edit reaches, in words and on the week tabs", () => {
    expect(rows).toContain('<span className="shrink-0">Edits apply to</span>');
    expect(rows).toContain("data-week-reached={reached ? \"\" : undefined}");
    expect(bench).toContain("const targets = useMemo(() => scopeWeeks(plan, cur, scope)");
  });

  it("numbers are typed straight in; Enter moves down a column like a spreadsheet", () => {
    expect(cells).toContain("focusNextCell(ev.currentTarget, ev.shiftKey ? -1 : 1, true);");
    expect(cells).toContain("const p = cellPatch(latest.current.e, field, text, latest.current.mode);");
  });

  it("Undo / Redo for every edit, and leaving with changes asks first", () => {
    expect(bench).toContain("onClick={editor.undo}");
    expect(bench).toContain("if (editor.dirty) setLeave(true);");
    expect(read("src/components/athlete-programs/use-program-editor.ts")).toContain(
      "writeBackup(key, { v: 2, base, savedAt: Date.now(), draft: d });",
    );
  });
});

describe("coach builder: the phone layout", () => {
  const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");

  it("a phone gets the canvas full width, with the tip and no desktop tools", () => {
    expect(editor).toContain("const phone = useIsMobileNow();");
    expect(editor).toContain("const zoom = phone ? 1 : zoomPref;");
    expect(editor).toContain('<BestOnComputerTip storageKey="jf.coach-builder.desktop-tip">');
    expect(editor).toMatch(/\{!phone && \(\s*<ExerciseLibraryPanel/);
    expect(editor).toContain("<BuilderPhoneContext.Provider value={phone}>");
  });

  it("one week at a time on a phone, without changing the desktop choice", () => {
    expect(editor).toContain('const view: EditorView = phone ? "week" : viewPref;');
    expect(editor).toContain("writePos({ view: viewPref, activeIdx: idx })");
  });

  it("exercises are added and swapped from a searchable sheet, never the long dropdown", () => {
    expect(editor).toContain("function PhoneExercisePickerSheet(");
    expect(editor).toContain("<PhoneAddExerciseButton");
    expect(editor).toContain(
      'title={row.exercise_id || row.exercise_name_override ? "Swap exercise" : "Pick an exercise"}',
    );
  });

  it("a row's ⋯ never opens the card under it", () => {
    expect(editor).toContain("if (collapsed && !inFloatingLayer(e.target)) openCard();");
    expect(editor).toContain("if (inFloatingLayer(e.relatedTarget)) return;");
    expect(editor).toContain('<DropdownMenuContent align="end" className="w-56" data-row-menu>');
  });

  it("copies a week or a day onto the weeks the coach picks (the member builder's picker), with Undo", () => {
    expect(editor).toContain("<WeekPickerSheet");
    expect(editor).toContain("Copy to weeks…");
    expect(editor).not.toContain('confirm("Remove this week?")');
    expect(editor).not.toContain('confirm("Remove day?")');
    expect(read("src/components/athlete-programs/workbench/sheets.tsx")).toContain("<WeekPickerSheet");
  });
});

describe("programs: whose program it is, and whose calendar it changes", () => {
  it("the three kinds are named for what they are, and each card says who it's from on top", () => {
    const hub = read("src/components/athlete-programs/programs-hub.tsx");
    expect(hub).toContain('mine: { full: "My programs", short: "Mine" }');
    expect(hub).toContain('jf: { full: "JF Effect plans", short: "JF Effect" }');
    expect(hub).toContain('crew: { full: "Crew programs", short: "Crew" }');
    expect(read("src/components/programs/program-card.tsx")).toContain('data-program-source="jf"');
    expect(read("src/components/athlete-programs/program-list-card.tsx")).toContain('data-program-source="crew"');
  });

  it("saving a member's program never rewrites a coach-managed calendar or skips the access check", () => {
    const sql = read("supabase/migrations/20270418091000_member_program_sync_self_serve_only.sql");
    expect(sql).toContain("WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false LIMIT 1;");
    expect(sql).toContain("IF v_client IS NULL OR NOT public.member_can_consume(v_uid) THEN RETURN NULL; END IF;");
    // and only the member's own blocks started from this program, untouched workouts only
    expect(sql).toContain("WHERE b.client_id = v_client AND b.created_by = v_uid AND b.source_athlete_program_id = _id AND b.archived = false;");
    expect(sql).toContain("pl_day_touched");
  });

  it("coaches follow one exercise week to week from its ⋯, the member builder's way", () => {
    const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
    expect(editor).toContain("Progress across weeks…");
    expect(editor).toContain("<ProgressAcrossWeeksSheet");
    const sheet = read("src/components/program-editor/progress-across-weeks.tsx");
    expect(sheet).toContain("const res = applyCell(row, field, progressionText(row, field, values[i]));");
    expect(sheet).toContain('action: { label: "Undo", onClick: () => setWeeksData(before) }');
    expect(read("src/components/athlete-programs/workbench/sheets.tsx")).toContain(
      'export { BuilderSheet } from "@/components/program-editor/builder-sheet";',
    );
  });
});

