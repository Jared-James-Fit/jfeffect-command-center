import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { draftIssue, draftProblem, type ProgramDraft } from "@/lib/athlete-programs";
import {
  DRAFT_BACKUP_MAX_AGE_MS,
  MAX_EXERCISES,
  addExercises,
  clampSets,
  clampWeeks,
  draftBackupKey,
  duplicateDay,
  insertAt,
  newDay,
  newExercise,
  removeAt,
  sameDraft,
  swapExercise,
  topMuscleGroups,
  usableBackup,
} from "@/lib/athlete-program-draft";

const EX = "11111111-1111-4111-8111-111111111111";
const EX2 = "22222222-2222-4222-8222-222222222222";
const lib = (id: string, name: string, muscle_group: string | null = null) => ({
  id,
  name,
  muscle_group,
  equipment: null,
});

const ok: ProgramDraft = {
  id: null,
  title: "Upper / Lower",
  description: "",
  goal: "muscle",
  level: null,
  weeks: 4,
  days: [
    { title: "Upper", exercises: [newExercise(lib(EX, "Bench"))] },
    { title: "Lower", exercises: [newExercise(lib(EX2, "Squat"))] },
  ],
};

describe("program builder: where the problem is", () => {
  it("points at the name, the week or the day to fix", () => {
    expect(draftIssue(ok)).toBeNull();
    expect(draftIssue({ ...ok, title: " " })).toMatchObject({ at: "title" });
    expect(draftIssue({ ...ok, days: [] })).toMatchObject({ at: "days" });
    expect(draftIssue({ ...ok, days: [ok.days[0], { title: "Lower", exercises: [] }] })).toEqual({
      message: "Add an exercise to Lower.",
      at: 1,
    });
    const badReps = { ...ok.days[1], exercises: [{ ...ok.days[1].exercises[0], reps: "" }] };
    expect(draftIssue({ ...ok, days: [ok.days[0], badReps] })).toMatchObject({ at: 1 });
    // the old one-line check still reads the same
    expect(draftProblem({ ...ok, title: "" })).toBe("Give your program a name.");
  });
});

describe("program builder: day and exercise edits", () => {
  it("a picked exercise lands as 3 × 8-10 with 2:00 rest", () => {
    expect(newExercise(lib(EX, "Bench", "Chest"))).toEqual({
      exercise_id: EX,
      name: "Bench",
      muscle_group: "Chest",
      equipment: null,
      sets: 3,
      reps: "8-10",
      rpe: null,
      rest_seconds: 120,
      notes: null,
    });
  });

  it("adds several at once in the order picked, never past the day's limit", () => {
    const r = addExercises({ title: "A", exercises: [] }, [lib(EX, "Bench"), lib(EX2, "Row")]);
    expect(r.day.exercises.map((e) => e.name)).toEqual(["Bench", "Row"]);
    expect(r).toMatchObject({ added: 2, skipped: 0 });

    const nearlyFull = {
      title: "A",
      exercises: Array.from({ length: MAX_EXERCISES - 1 }, () => newExercise(lib(EX, "Bench"))),
    };
    const r2 = addExercises(nearlyFull, [lib(EX2, "Row"), lib(EX, "Bench")]);
    expect(r2.day.exercises).toHaveLength(MAX_EXERCISES);
    expect(r2).toMatchObject({ added: 1, skipped: 1 });
  });

  it("a swap keeps the prescription and changes only the exercise", () => {
    const e = { ...newExercise(lib(EX, "Bench")), sets: 5, reps: "5", rpe: "8", notes: "pause" };
    expect(swapExercise(e, lib(EX2, "Close-Grip Bench", "Triceps"))).toEqual({
      ...e,
      exercise_id: EX2,
      name: "Close-Grip Bench",
      muscle_group: "Triceps",
      equipment: null,
    });
  });

  it("duplicates a day right after itself, as its own copy, and holds at 7", () => {
    const days = duplicateDay(ok.days, 0);
    expect(days.map((d) => d.title)).toEqual(["Upper", "Upper (copy)", "Lower"]);
    days[1].exercises[0].sets = 9;
    expect(ok.days[0].exercises[0].sets).toBe(3);
    const week = Array.from({ length: 7 }, (_, i) => newDay(i));
    expect(duplicateDay(week, 0)).toBe(week);
  });

  it("remove and Undo put a thing back where it was", () => {
    const list = ["a", "b", "c"];
    const gone = removeAt(list, 1);
    expect(gone).toEqual(["a", "c"]);
    expect(insertAt(gone, 1, "b")).toEqual(list);
    expect(insertAt(["a"], 5, "b")).toEqual(["a", "b"]);
    expect(removeAt(list, 9)).toBe(list);
  });

  it("sets and weeks stay in what the database takes", () => {
    expect(clampSets(0)).toBe(1);
    expect(clampSets(25)).toBe(20);
    expect(clampSets(Number.NaN)).toBe(1);
    expect(clampWeeks(0)).toBe(1);
    expect(clampWeeks(40)).toBe(16);
  });

  it("browse chips are the library's biggest muscle groups, any spelling once", () => {
    const library = [
      { muscle_group: "Chest" },
      { muscle_group: "chest" },
      { muscle_group: "Back" },
      { muscle_group: "Back" },
      { muscle_group: "Back" },
      { muscle_group: "Quads" },
      { muscle_group: null },
      { muscle_group: " " },
    ];
    expect(topMuscleGroups(library)).toEqual(["Back", "Chest", "Quads"]);
    expect(topMuscleGroups(library, 1)).toEqual(["Back"]);
  });
});

describe("program builder: the draft kept on the phone", () => {
  const now = Date.UTC(2026, 10, 9);
  const backup = (over: Record<string, unknown> = {}) => ({
    v: 1,
    base: null,
    savedAt: now - 60_000,
    draft: ok,
    ...over,
  });

  it("is per login and per program", () => {
    expect(draftBackupKey("u1", null)).toBe("jf.program-draft.v1:u1:new");
    expect(draftBackupKey("u1", "p1")).toBe("jf.program-draft.v1:u1:p1");
  });

  it("is picked up only from the same saved version, while it's fresh", () => {
    expect(usableBackup(backup(), null, now)?.title).toBe("Upper / Lower");
    // the program was saved again since (another phone): never offer the old copy
    expect(usableBackup(backup({ base: "2026-11-01T00:00:00Z" }), null, now)).toBeNull();
    expect(
      usableBackup(backup({ base: "2026-11-01T00:00:00Z" }), "2026-11-02T00:00:00Z", now),
    ).toBeNull();
    expect(
      usableBackup(backup({ savedAt: now - DRAFT_BACKUP_MAX_AGE_MS - 1 }), null, now),
    ).toBeNull();
  });

  it("anything that isn't a draft is ignored", () => {
    expect(usableBackup(null, null, now)).toBeNull();
    expect(usableBackup("x", null, now)).toBeNull();
    expect(usableBackup(backup({ v: 2 }), null, now)).toBeNull();
    expect(usableBackup(backup({ draft: { title: "x" } }), null, now)).toBeNull();
    expect(
      usableBackup(
        backup({ draft: { ...ok, days: [{ title: "A", exercises: [{ sets: 3 }] }] } }),
        null,
        now,
      ),
    ).toBeNull();
    expect(
      usableBackup(
        backup({ draft: { ...ok, days: Array.from({ length: 8 }, (_, i) => newDay(i)) } }),
        null,
        now,
      ),
    ).toBeNull();
  });

  it("a copy that matches the saved program isn't offered (names don't count)", () => {
    const withoutNames: ProgramDraft = {
      ...ok,
      days: ok.days.map((d) => ({
        ...d,
        exercises: d.exercises.map(({ name: _n, muscle_group: _m, equipment: _e, ...e }) => e),
      })),
    };
    expect(sameDraft(ok, withoutNames)).toBe(true);
    expect(sameDraft(ok, { ...ok, weeks: 5 })).toBe(false);
  });
});

describe("program builder: the phone layout", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const builder = read("src/components/athlete-programs/program-builder.tsx");
  const mobile = read("src/components/athlete-programs/program-builder-mobile.tsx");

  it("a phone gets its own layout from the first frame, on the same draft", () => {
    expect(builder).toContain("useIsMobileNow()");
    expect(builder).toContain("<MobileProgramBuilder editor={editor} />");
    expect(builder).toContain("<DesktopBuilder editor={editor} />");
  });

  it("says it's best on a computer, once, without blocking anyone", () => {
    const tip = read("src/components/best-on-computer-tip.tsx");
    expect(tip).toContain("Best on a computer");
    expect(tip).toContain('aria-label="Hide this tip"');
    expect(mobile).toContain("<BestOnComputerTip storageKey={TIP_KEY}>");
  });

  it("its action bar steps aside for the keyboard", () => {
    expect(mobile).toContain("data-hide-on-keyboard");
    expect(read("src/styles.css")).toContain(
      'html[data-keyboard-open="true"] [data-hide-on-keyboard]',
    );
  });
});

describe("coach builder: the phone layout", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");

  it("a phone gets the canvas full width, with the tip and no desktop tools", () => {
    expect(editor).toContain("const phone = useIsMobileNow();");
    expect(editor).toContain("const zoom = phone ? 1 : zoomPref;");
    expect(editor).toContain('<BestOnComputerTip storageKey="jf.coach-builder.desktop-tip">');
    // the drag-and-drop library sidebar is desktop only
    expect(editor).toMatch(/\{!phone && \(\s*<ExerciseLibraryPanel/);
    expect(editor).toContain("<BuilderPhoneContext.Provider value={phone}>");
  });

  it("one week at a time on a phone, without changing the desktop choice", () => {
    expect(editor).toContain('const view: "block" | "week" = phone ? "week" : viewPref;');
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
    // nothing in a layer the card opened (its ⋯, a list, the picker) opens or folds it
    expect(editor).toContain("if (collapsed && !inFloatingLayer(e.target)) openCard();");
    expect(editor).toContain("if (inFloatingLayer(e.relatedTarget)) return;");
    expect(editor).toContain('<DropdownMenuContent align="end" className="w-56" data-row-menu>');
  });
});
