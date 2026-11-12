import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { weekPurposeLabelsByDay } from "@/lib/program-editor-labels";

const read = (p: string) => readFileSync(p, "utf8");
const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
const blockPage = read("src/routes/_authenticated/admin/blocks.$blockId.tsx");

const squat = { id: "sq", name: "Competition Squat", is_competition_lift: true, competition_lift_type: "squat", movement_family: "squat" };
const bench = { id: "bp", name: "Competition Bench", is_competition_lift: true, competition_lift_type: "bench", movement_family: "bench" };
const hip = { id: "ht", name: "Hip Thrust - Barbell", movement_family: "lower" };

describe("purpose labels in the program editor", () => {
  it("reads rows that have no id (the builder's rows never do): a competition lift is never Assistance", () => {
    const days = [
      { day_index: 1, rows: [{ _dbId: "r1", exercise_id: "sq" }, { exercise_id: "ht" }] },
      { day_index: 2, rows: [{ exercise_id: "bp" }] },
    ];
    const labels = weekPurposeLabelsByDay(days, [squat, bench, hip]);
    expect(labels[0][0]).not.toBe("Assistance");
    expect(labels[0][1]).toBe("Assistance");
    expect(labels[1][0]).not.toBe("Assistance");
    expect(labels.map((d) => d.length)).toEqual([2, 1]);
  });
  it("a manual label on the row still wins", () => {
    const labels = weekPurposeLabelsByDay([{ rows: [{ exercise_id: "ht", purpose_label: "Secondary" }] }], [hip]);
    expect(labels[0][0]).toBe("Secondary");
  });
});

describe("the builder's exercise library", () => {
  const lib = read("src/lib/builder-exercise-library.ts");
  it("is read whole, page by page, with the video and volume columns", () => {
    expect(lib).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
    expect(lib).toContain('"video_url"');
    expect(lib).toContain('"muscle_groups"');
  });
  it("both editors (and the maxes picker) use it: no capped one-shot read under a shared key", () => {
    expect(editor).toContain("useBuilderExerciseLibrary()");
    expect(blockPage).toContain("useBuilderExerciseLibrary()");
    expect(editor).not.toContain(".limit(10000)");
    expect(blockPage).not.toContain(".limit(10000)");
    expect(read("src/components/block-maxes-panel.tsx")).toContain("queryFn: fetchBuilderExerciseLibrary");
  });
});

describe("the editor's layout", () => {
  it("one header: the canvas's toolbar (undo, redo, weeks) sits in the page header's second row", () => {
    expect(blockPage).toContain("toolbarTarget={toolbarEl}");
    expect(blockPage).toContain("onToolbarEl={setToolbarEl}");
    expect(editor).toContain("toolbarTarget={toolbarEl}");
    expect(editor).toContain("{portalToolbar && createPortal(toolbar, toolbarTarget!)}");
    expect(editor).toContain("{weekNavSlot ? createPortal(weekNav, weekNavSlot) : (");
  });
  it("a client's block is one block: no program / Add block strip that never saved", () => {
    expect(blockPage).toMatch(/<StructureCanvas[\s\S]*?singleBlock\s*\n\s*\/>/);
    expect(editor).toContain("{!singleBlock && (");
  });
  it("a day's name is what the athlete reads (subtitle, else the title), written to both", () => {
    expect(editor).toContain("const dayName = formatDaySubtitle(d) ?? \"\";");
    expect(editor).toContain("setDayAt(i, { ...d, subtitle: v, title: v });");
  });
  it("an open card's fields are a module-level component, so a commit never remounts the box being typed in", () => {
    expect(editor).toContain("function RowField({");
    expect(editor).not.toMatch(/const Field = \(\{/);
  });
  it("no white input boxes or red / green toggles in the builder", () => {
    expect(editor).not.toContain("bg-white text-slate-900");
    expect(editor).not.toContain('"border-red-500 bg-red-500 text-white');
    expect(editor).toContain('aria-label="Suggested load"');
  });
  it("the panels under a client's block fold away until opened", () => {
    expect(blockPage).toContain("<AutoSchedulePanel blockId={blockId} bare />");
    expect(blockPage).toContain('<BuilderSection id="roadmap"');
  });
});
