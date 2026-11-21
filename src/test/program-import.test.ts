import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parsePrescription, effortRange, repsText, restSeconds } from "@/lib/program-import/prescription";
import { parseCsv, parseDocx, parseXlsx, readLocalFile, fileKind, sheetsToText } from "@/lib/program-import/extract";
import { parseSource } from "@/lib/program-import/parse";
import { readAiImport, groundingFlags, UnreadableAnswer } from "@/lib/program-import/ai";
import { matchExerciseNames } from "@/lib/program-import/match";
import { importNames, repeatWeeks, resolveName, toDraft, unmatchedNames } from "@/lib/program-import/review";
import { planIssue, planPayload, totalWeeks } from "@/lib/program-plan";
import type { ImportedProgram, SourceDoc } from "@/lib/program-import/types";

/* ---------------- fixtures: real files built in memory ---------------- */

type CellIn = string | number | { pct: number };
const colName = (i: number) => {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** A real .xlsx (the parts Excel writes), with shared strings, % formats and merged cells. */
function xlsx(sheets: Array<{ name: string; rows: CellIn[][]; merges?: string[]; hidden?: boolean }>): Uint8Array {
  const shared: string[] = [];
  const si = (t: string) => {
    const i = shared.indexOf(t);
    if (i >= 0) return i;
    shared.push(t);
    return shared.length - 1;
  };
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((sh, n) => {
    const rows = sh.rows
      .map((r, ri) => {
        const cells = r
          .map((c, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (c === "" || c == null) return "";
            if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
            if (typeof c === "object") return `<c r="${ref}" s="1"><v>${c.pct}</v></c>`;
            return `<c r="${ref}" t="s"><v>${si(c)}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    const merges = sh.merges?.length
      ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "";
    files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${merges}</worksheet>`,
    );
  });
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ""}/>`)
      .join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships>${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  files["xl/sharedStrings.xml"] = strToU8(
    `<?xml version="1.0"?><sst>${shared.map((t) => `<si><t>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`,
  );
  files["xl/styles.xml"] = strToU8(
    `<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="9" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  );
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0"?><Types/>`);
  return zipSync(files);
}

/** A real .docx: paragraphs and tables in order. */
function docx(blocks: Array<string | string[][]>): Uint8Array {
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`;
  const body = blocks
    .map((b) =>
      typeof b === "string"
        ? p(b)
        : `<w:tbl>${b.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`,
    )
    .join("");
  return zipSync({
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
  });
}

const allExercises = (p: ImportedProgram) => p.blocks.flatMap((b) => b.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises)));
const weeksOf = (p: ImportedProgram) => p.blocks.flatMap((b) => b.weeks);

const LIB = [
  { id: "sq", name: "Competition Squat", muscle_group: "Quads", equipment: "Barbell", category: null },
  { id: "bs", name: "Back Squat", muscle_group: "Quads", equipment: "Barbell", category: null },
  { id: "bp", name: "Bench Press", muscle_group: "Chest", equipment: "Barbell", category: null },
  { id: "dl", name: "Deadlift", muscle_group: "Back", equipment: "Barbell", category: null },
  { id: "rdl", name: "Romanian Deadlift", muscle_group: "Hamstrings", equipment: "Barbell", category: null },
  { id: "dbrdl", name: "Dumbbell Romanian Deadlift", muscle_group: "Hamstrings", equipment: "Dumbbell", category: null },
  { id: "lp", name: "Leg Press", muscle_group: "Quads", equipment: "Machine", category: null },
  { id: "cu", name: "Chin Up", muscle_group: "Back", equipment: "Bodyweight", category: null },
  { id: "dbr", name: "Dumbbell Row", muscle_group: "Back", equipment: "Dumbbell", category: null },
  { id: "ohp", name: "Overhead Press", muscle_group: "Shoulders", equipment: "Barbell", category: null },
  { id: "lr", name: "Dumbbell Lateral Raise", muscle_group: "Shoulders", equipment: "Dumbbell", category: null },
  { id: "inc", name: "Incline Dumbbell Press", muscle_group: "Chest", equipment: "Dumbbell", category: null },
  { id: "lpd", name: "Lat Pulldown", muscle_group: "Back", equipment: "Cable", category: null },
  { id: "lc", name: "Lying Leg Curl", muscle_group: "Hamstrings", equipment: "Machine", category: null },
  { id: "pd", name: "Cable Triceps Pushdown", muscle_group: "Triceps", equipment: "Cable", category: null },
];

/* ---------------- prescriptions ---------------- */

describe("prescriptions are read exactly as written", () => {
  it("reads sets, reps, RPE, RIR, percentages, loads, rest, tempo and velocity", () => {
    expect(parsePrescription("4x5 @ RPE 7").rx).toMatchObject({ sets: 4, reps: "5", rpe: "7" });
    expect(parsePrescription("3 x 8-10 @ 75%").rx).toMatchObject({ sets: 3, reps: "8-10", pct: 75 });
    expect(parsePrescription("5x3 @ 100kg").rx).toMatchObject({ sets: 5, reps: "3", load: 100, unit: "kg" });
    expect(parsePrescription("3x10 RIR 2").rx).toMatchObject({ sets: 3, reps: "10", rir: "2" });
    expect(parsePrescription("3x8, 2 min rest").rx).toMatchObject({ sets: 3, reps: "8", rest_seconds: 120 });
    expect(parsePrescription("4x6 tempo 3-1-1-0").rx).toMatchObject({ sets: 4, reps: "6", tempo: "3-1-1-0" });
    expect(parsePrescription("6x2 @ 0.8 m/s").rx.velocity).toMatch(/0\.8\s*m\/s/);
    expect(parsePrescription("3x8 @ 7-8").rx).toMatchObject({ sets: 3, reps: "8", rpe: "7-8" });
  });
  it("keeps the app's scales and never stretches one", () => {
    expect(effortRange("7.5", "rpe")).toBe("7.5");
    expect(effortRange("11", "rpe")).toBeNull();
    expect(repsText("AMRAP")).toBeTruthy();
    expect(restSeconds("90s").seconds).toBe(90);
    expect(restSeconds("2-3 min").seconds).toBe(120);
  });
});

/* ---------------- plain text ---------------- */

const TEXT_PROGRAM = `Off-Season Strength
Week 1
Day 1: Lower
Back Squat 4x5 @ RPE 7
Romanian Deadlift 3x8, 2 min rest
Leg Press 3x10-12
Day 2: Upper
Bench Press 5x5 @ 75%
A1. Chin Up 3x8
A2. Dumbbell Row 3x10
Week 2 (Deload)
Day 1: Lower
Back Squat 3x5 @ RPE 6
Romanian Deadlift 2x8
Day 2: Upper
Bench Press 3x5 @ 65%
Add 5 lb to your squat every week if every rep moved well.`;

describe("a program typed out as text", () => {
  const out = parseSource({ kind: "text", name: "", text: TEXT_PROGRAM });
  it("finds every week, day and exercise in order", () => {
    expect(out.confident).toBe(true);
    const weeks = weeksOf(out.program);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].days.map((d) => d.title)).toEqual(["Lower", "Upper"].map((t) => expect.stringContaining(t)));
    expect(weeks[0].days[0].exercises.map((e) => e.name)).toEqual(["Back Squat", "Romanian Deadlift", "Leg Press"]);
    expect(weeks[1].deload).toBe(true);
    expect(weeks[1].days[1].exercises[0]).toMatchObject({ name: "Bench Press", sets: 3, reps: "5", pct: 65 });
  });
  it("keeps supersets, rest and progression written in words", () => {
    const upper = weeksOf(out.program)[0].days[1].exercises;
    expect(upper[1]).toMatchObject({ name: "Chin Up", group: "A1" });
    expect(upper[2]).toMatchObject({ name: "Dumbbell Row", group: "A2" });
    expect(weeksOf(out.program)[0].days[0].exercises[1].rest_seconds).toBe(120);
    expect(out.program.progression.join(" ")).toMatch(/Add 5 lb/);
    // a sentence is never read as an exercise
    expect(allExercises(out.program).some((e) => /^add\b/i.test(e.name))).toBe(false);
    expect(out.program.title).toBe("Off-Season Strength");
  });
});

/* ---------------- spreadsheets ---------------- */

describe("an Excel workbook, one sheet a week", () => {
  const bytes = xlsx([
    { name: "Read Me", rows: [["Run each week in order. Weights in lb."]] },
    {
      name: "Week 1",
      rows: [
        ["Day", "Exercise", "Sets", "Reps", "%1RM", "RPE", "Rest", "Notes"],
        ["Day 1", "Competition Squat", 4, 5, { pct: 0.75 }, 7, "3 min", "Belt on top set"],
        ["Day 1", "Romanian Deadlift", 3, 8, "", 7, "2 min", ""],
        ["Day 2", "Bench Press", 5, 5, { pct: 0.725 }, "", "3 min", ""],
        ["Day 2", "Lat Pulldown", 3, "10-12", "", "", 90, ""],
      ],
    },
    {
      name: "Week 2",
      rows: [
        ["Day", "Exercise", "Sets", "Reps", "%1RM", "RPE", "Rest", "Notes"],
        ["Day 1", "Competition Squat", 4, 4, { pct: 0.8 }, 7.5, "3 min", ""],
        ["Day 1", "Romanian Deadlift", 3, 8, "", 7, "2 min", ""],
        ["Day 2", "Bench Press", 5, 4, { pct: 0.775 }, "", "3 min", ""],
        ["Day 2", "Lat Pulldown", 3, "10-12", "", "", 90, ""],
      ],
    },
    { name: "Old", hidden: true, rows: [["Exercise", "Sets"], ["Should not appear", 3]] },
  ]);
  const doc = readLocalFile("Strength Block.xlsx", "xlsx", bytes);
  const out = parseSource(doc);

  it("reads cells as they're shown (a % format is a percentage, never 0.75)", () => {
    const sheets = parseXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["Read Me", "Week 1", "Week 2"]);
    expect(sheets[1].rows[1][4]).toBe("75%");
    expect(sheets[1].rows[3][4]).toBe("72.5%");
    expect(sheetsToText(sheets)).not.toMatch(/Should not appear/);
  });
  it("keeps every sheet's week, every day, and the numbers in each cell", () => {
    expect(out.confident).toBe(true);
    const weeks = weeksOf(out.program);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].days).toHaveLength(2);
    const sq1 = weeks[0].days[0].exercises[0];
    expect(sq1).toMatchObject({ name: "Competition Squat", sets: 4, reps: "5", pct: 75, rpe: "7", rest_seconds: 180 });
    expect(sq1.notes).toMatch(/Belt/);
    expect(weeks[1].days[0].exercises[0]).toMatchObject({ reps: "4", pct: 80, rpe: "7.5" });
    expect(weeks[0].days[1].exercises[1]).toMatchObject({ name: "Lat Pulldown", reps: "10-12", rest_seconds: 90 });
    expect(out.program.notes ?? "").toMatch(/Run each week in order/);
  });
});

describe("a powerlifting block with the weeks across (one row per exercise)", () => {
  const bytes = xlsx([
    {
      name: "Peak",
      rows: [
        ["Exercise", "Week 1", "Week 2", "Week 3", "Week 4"],
        ["Day 1 - Squat / Bench", "", "", "", ""],
        ["Competition Squat", "4x4 @ 77.5%", "4x3 @ 82.5%", "3x2 @ 87.5%", "1x1 @ RPE 8"],
        ["Bench Press", "5x4 @ 75%", "5x3 @ 80%", "4x2 @ 85%", "1x1 @ RPE 8"],
        ["Day 2 - Deadlift", "", "", "", ""],
        ["Deadlift", "4x3 @ 80%", "3x3 @ 85%", "2x2 @ 90%", "1x1 @ RPE 8"],
        ["Romanian Deadlift", "3x6", "3x6", "2x6", ""],
      ],
    },
  ]);
  const out = parseSource(readLocalFile("peak.xlsx", "xlsx", bytes));
  it("makes a week of each column, keeping each week's own numbers", () => {
    const weeks = weeksOf(out.program);
    expect(weeks).toHaveLength(4);
    expect(weeks[0].days).toHaveLength(2);
    expect(weeks[2].days[0].exercises[0]).toMatchObject({ name: "Competition Squat", sets: 3, reps: "2", pct: 87.5 });
    expect(weeks[3].days[0].exercises[0]).toMatchObject({ sets: 1, reps: "1", rpe: "8" });
    // an empty cell is nothing that week, never a made-up prescription
    expect(weeks[3].days[1].exercises.map((e) => e.name)).toEqual(["Deadlift"]);
  });
});

describe("a bodybuilding split as CSV", () => {
  const csv = `Day,Exercise,Sets,Reps,Rest (sec),Tempo
Push,Incline Dumbbell Press,4,8-10,120,3-1-1-0
Push,Dumbbell Lateral Raise,4,12-15,60,
Push,Cable Triceps Pushdown,3,12,60,
Pull,Lat Pulldown,4,10,90,
Pull,Dumbbell Row,3,10,90,
Legs,Leg Press,4,10-12,120,
Legs,Lying Leg Curl,3,12,60,`;
  const out = parseSource(readLocalFile("ppl.csv", "csv", strToU8(csv)));
  it("reads the days from the Day column and keeps rest and tempo", () => {
    expect(out.confident).toBe(true);
    const days = weeksOf(out.program)[0].days;
    expect(days.map((d) => d.title)).toEqual(["Push", "Pull", "Legs"]);
    expect(days[0].exercises[0]).toMatchObject({ name: "Incline Dumbbell Press", sets: 4, reps: "8-10", rest_seconds: 120, tempo: "3-1-1-0" });
    expect(days[2].exercises).toHaveLength(2);
  });
  it("detects ; and tab separated files", () => {
    expect(parseCsv("Exercise;Sets;Reps\nBench Press;3;5").rows[1]).toEqual(["Bench Press", "3", "5"]);
    expect(parseCsv("Exercise\tSets\nSquat\t3").rows[1]).toEqual(["Squat", "3"]);
  });
});

describe("a Word document with headings and tables", () => {
  const bytes = docx([
    "Hypertrophy Phase",
    "Week 1",
    "Day 1: Upper",
    [
      ["Exercise", "Sets", "Reps", "RIR"],
      ["Bench Press", "4", "8", "2"],
      ["Dumbbell Row", "4", "10", "2"],
    ],
    "Day 2: Lower",
    [
      ["Exercise", "Sets", "Reps", "RIR"],
      ["Back Squat", "4", "8", "2"],
    ],
    "Week 2",
    "Day 1: Upper",
    [
      ["Exercise", "Sets", "Reps", "RIR"],
      ["Bench Press", "4", "8", "1"],
      ["Dumbbell Row", "4", "10", "1"],
    ],
    "Day 2: Lower",
    [
      ["Exercise", "Sets", "Reps", "RIR"],
      ["Back Squat", "4", "8", "1"],
    ],
    "Rest 2 minutes between sets.",
  ]);
  it("keeps the weeks named above the tables (never only the nearest heading)", () => {
    const doc = readLocalFile("phase.docx", "docx", bytes);
    expect(parseDocx(bytes).sheets.length).toBeGreaterThanOrEqual(4);
    const out = parseSource(doc);
    const weeks = weeksOf(out.program);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].days.map((d) => d.title)).toEqual([expect.stringContaining("Upper"), expect.stringContaining("Lower")]);
    expect(weeks[1].days[0].exercises[0]).toMatchObject({ name: "Bench Press", sets: 4, reps: "8", rir: "1" });
    expect(out.program.title).toBe("Hypertrophy Phase");
  });
});

describe("files", () => {
  it("knows what it can read and says what it can't", () => {
    expect(fileKind("Program.XLSX", "")).toBe("xlsx");
    expect(fileKind("old.xls", "")).toBe("xls");
    expect(fileKind("scan.pdf", "application/pdf")).toBe("pdf");
    expect(fileKind("IMG_2231.HEIC", "")).toBe("image");
    expect(fileKind("notes.pages", "")).toBe("unsupported");
    expect(() => parseXlsx(zipSync({ "a.txt": strToU8("x") }))).toThrow();
  });
});

/* ---------------- the AI's answer ---------------- */

const SOURCE = `Week 1
Mon - Squat 5x5 at 225, Bench 5x5 at 185
Wed - Deadlift 1x5 at 315`;

describe("an AI read is checked, never taken on trust", () => {
  it("reads the JSON, fixes formats and drops what's out of range", () => {
    const p = readAiImport(
      "```json\n" +
        JSON.stringify({
          title: "5x5",
          unit: "lb",
          blocks: [
            {
              weeks: [
                {
                  days: [
                    {
                      title: "Mon",
                      exercises: [
                        { name: "Squat", sets: 5, reps: "5", load: 225, unit: "lb", rpe: "@8", src: "Squat 5x5 at 225" },
                        { name: "Bench", sets: 5, reps: 5, load: 185, unit: "lb", pct: 0.75 },
                        { name: "Curl", sets: 99, reps: "10" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }) +
        "\n```",
    );
    const ex = allExercises(p);
    expect(ex[0]).toMatchObject({ name: "Squat", sets: 5, reps: "5", load: 225, rpe: "8" });
    // a fraction is a percentage; a percentage wins over a weight
    expect(ex[1]).toMatchObject({ pct: 75, load: null });
    expect(ex[2].sets).toBeNull();
    expect(ex[2].unsure).toMatch(/Sets/);
  });
  it("says when the answer was cut off", () => {
    expect(() => readAiImport('{"blocks":[{"weeks":[{"days":[{"title":"Mon","exercises":[{"name":"Sq')).toThrow(UnreadableAnswer);
  });
  it("flags a number the file doesn't have", () => {
    const ok = { name: "Squat", sets: 5, reps: "5", load: 225, unit: "lb" as const, pct: null, pct_of: null, rpe: null, rir: null, tempo: null, rest_seconds: null, group: null, velocity: null, notes: null, src: "Squat 5x5 at 225", unsure: null };
    expect(groundingFlags(ok, SOURCE)).toEqual([]);
    expect(groundingFlags({ ...ok, load: 245, src: null }, SOURCE).join(" ")).toMatch(/245/);
  });
});

/* ---------------- matching and the draft ---------------- */

describe("the draft the builder opens on", () => {
  const out = parseSource({ kind: "text", name: "", text: TEXT_PROGRAM.replace("Romanian Deadlift 3x8", "Sumo Snatch Grip Thing 3x8") });
  const matches = matchExerciseNames(LIB, importNames(out.program), [
    { exercise_id: "bp", alias_name: "Flat Bench" },
  ]);
  const draft = toDraft(out.program, { matches, source: TEXT_PROGRAM, method: "parsed", fileName: null });

  it("matches the library and never invents an exercise", () => {
    expect(matches.get("back squat")?.exercise?.id).toBe("bs");
    expect(matches.get("sumo snatch grip thing")?.exercise ?? null).toBeNull();
    const w1 = draft.plan.blocks[0].weeks[0];
    expect(w1.days[0].exercises.map((e) => e.exercise_id)).toEqual(["bs", "", "lp"]);
    expect(draft.flags.some((f) => f.level === "fix" && f.code === "unmatched")).toBe(true);
  });
  it("shares day and exercise keys across the weeks, so builder edits reach them all", () => {
    const [w1, w2] = draft.plan.blocks[0].weeks;
    expect(w2.days[0].key).toBe(w1.days[0].key);
    expect(w2.days[0].exercises[0].key).toBe(w1.days[0].exercises[0].key);
  });
  it("won't save until the unmatched exercise is picked, then saves everywhere it was used", () => {
    expect(planIssue(draft.title, draft.plan)?.message).toMatch(/Pick the library exercise/);
    expect(unmatchedNames(draft.plan)).toEqual([expect.objectContaining({ name: "Sumo Snatch Grip Thing", count: 1 })]);
    const fixed = resolveName(draft.plan, "Sumo Snatch Grip Thing", { id: "rdl", name: "Romanian Deadlift" });
    expect(unmatchedNames(fixed)).toEqual([]);
    expect(planIssue("Off-Season Strength", fixed)).toBeNull();
    // the save payload keeps the numbers exactly and leaves the file's own names out
    const payload = planPayload(fixed);
    const ex = payload.blocks[0].weeks[1].days[1].exercises[0];
    expect(ex).toMatchObject({ exercise_id: "bp", sets: 3, reps: "5", pct: 65, pct_of: "1rm" });
    expect(JSON.stringify(payload)).not.toMatch(/source_name/);
  });
  it("leaves a missing number missing (never a guess)", () => {
    const p = parseSource({ kind: "text", name: "", text: "Day 1\nBack Squat 3x5\nLeg Press" });
    const d = toDraft(p.program, { matches: matchExerciseNames(LIB, importNames(p.program)), source: null, method: "parsed" });
    const lp = d.plan.blocks[0].weeks[0].days[0].exercises.find((e) => e.exercise_id === "lp");
    if (lp) {
      expect(lp.sets).toBe(0);
      expect(lp.reps).toBe("");
      expect(planIssue("x y", d.plan)?.message).toMatch(/Sets|reps/);
    }
  });
  it("runs a one-week program for more weeks, linked", () => {
    const one = parseSource({ kind: "text", name: "", text: "Day 1\nBack Squat 3x5\nDay 2\nBench Press 3x5" });
    const d = toDraft(one.program, { matches: matchExerciseNames(LIB, importNames(one.program)), source: null, method: "parsed" });
    expect(d.oneWeek).toBe(true);
    const eight = repeatWeeks(d.plan, 8);
    expect(totalWeeks(eight)).toBe(8);
    expect(eight.blocks[0].weeks[7].days[1].exercises[0].key).toBe(eight.blocks[0].weeks[0].days[1].exercises[0].key);
  });
});

describe("a long program is cut to what the app holds, and says so", () => {
  const p: ImportedProgram = {
    title: "Long",
    notes: null,
    unit: "kg",
    progression: [],
    issues: [],
    blocks: [
      {
        name: "All",
        weeks: Array.from({ length: 30 }, () => ({
          label: null,
          deload: false,
          notes: null,
          days: [{ title: "Day 1", notes: null, exercises: [{ name: "Deadlift", sets: 3, reps: "5", load: 200, unit: null, pct: null, pct_of: null, rpe: null, rir: null, tempo: null, rest_seconds: null, group: null, velocity: null, notes: null, src: null, unsure: null }] }],
        })),
      },
    ],
  };
  const d = toDraft(p, { matches: matchExerciseNames(LIB, ["Deadlift"]), source: null, method: "ai" });
  it("keeps 24 weeks, flags the rest, and the unit-less weight", () => {
    expect(totalWeeks(d.plan)).toBe(24);
    expect(d.flags.some((f) => f.code === "weeks_cut")).toBe(true);
    expect(d.flags.some((f) => f.code === "no_unit")).toBe(true);
    expect(d.flags.some((f) => f.code === "read_from_image")).toBe(true);
    expect(d.plan.blocks[0].weeks[0].days[0].exercises[0]).toMatchObject({ load: 200, unit: "kg" });
  });
});

/* a SourceDoc type check (the phone builds these) */
const _typecheck: SourceDoc = { kind: "text", name: "", text: "" };
void _typecheck;
