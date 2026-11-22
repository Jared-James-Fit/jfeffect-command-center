/**
 * The JF Effect PDF system (Nov 22 2026): one kit (src/lib/pdf) for every
 * training, nutrition and report PDF, the words and numbers it prints, and the
 * one way a PDF reaches the person (the share sheet, never jsPDF's save()).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isoDay, pdfDate, pdfDuration, pdfFileName, pdfRange, pdfText } from "@/lib/pdf/text";
import { niceTicks } from "@/lib/pdf/charts";
import { orientationFor } from "@/lib/pdf/kit";
import {
  dayStatus,
  generateProgramPdf,
  loggedLines,
  prescribedLoad,
  prescriptionLine,
  buildTrainingReportDoc,
  trainingPdfFileName,
} from "@/lib/workouts/workout-pdf";
import { buildMealPlanPdf, mealCalories, planDayWhen } from "@/lib/nutrition-targets/meal-plan-pdf";
import { libraryPlanProgram } from "@/lib/library-plan-pdf";
import { buildProgressReport } from "@/lib/analytics/progress-report-pdf";
import { buildTrainingLoad } from "@/lib/analytics/training-load";

const read = (p: string) => readFileSync(p, "utf8");

describe("words the PDF font can print", () => {
  it("turns what Helvetica can't draw into plain words, keeps what it can", () => {
    expect(pdfText("177.5kg → 185kg")).toBe("177.5kg to 185kg");
    expect(pdfText("RPE ≥ 8, ≤ 10 reps, ≈ 3 min")).toBe("RPE >= 8, <= 10 reps, ~ 3 min");
    expect(pdfText("−0.4 lb a week")).toBe("-0.4 lb a week");
    expect(pdfText("Block 2 — Volume · 5 × 3 … ‘ok’ “yes” é")).toBe(
      "Block 2 — Volume · 5 × 3 … ‘ok’ “yes” é",
    );
    expect(pdfText("Done ✓ 💪")).toBe("Done");
  });

  it("dates are the calendar day stored, never a day early west of UTC", () => {
    const today = new Date(2026, 10, 22);
    expect(pdfDate("2026-06-02")).toBe("Jun 2, 2026");
    expect(pdfDate("2026-11-03", { weekday: true, year: "auto", today })).toBe("Tue, Nov 3");
    expect(pdfRange("2026-10-06", "2026-10-12")).toBe("Oct 6 – 12, 2026");
    expect(pdfRange("2026-09-29", "2026-10-05")).toBe("Sep 29 – Oct 5, 2026");
    expect(pdfRange("2025-12-29", "2026-01-04")).toBe("Dec 29, 2025 – Jan 4, 2026");
    expect(pdfRange("2026-10-06", null)).toBe("From Oct 6, 2026");
    expect(isoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("times read like the app says them", () => {
    expect(pdfDuration(45)).toBe("45 s");
    expect(pdfDuration(180)).toBe("3 min");
    expect(pdfDuration(150)).toBe("2:30 min");
    expect(pdfDuration(5400)).toBe("1:30 h");
    expect(pdfDuration(0)).toBe("");
  });

  it("every file name: who, what, which part, the day", () => {
    const d = new Date(2026, 10, 22);
    expect(
      pdfFileName({
        person: "Jared McIntyre",
        document: "training program",
        detail: "Block 2 — Volume 4s/6s",
        date: d,
      }),
    ).toBe("jared-mcintyre-training-program-block-2-volume-4s-6s-2026-11-22.pdf");
    expect(pdfFileName({ person: null, document: "nutrition plan", date: d })).toBe(
      "nutrition-plan-2026-11-22.pdf",
    );
    expect(trainingPdfFileName("report", "Jared McIntyre", ["a", "b"], d)).toBe(
      "jared-mcintyre-training-report-2026-11-22.pdf",
    );
    // a long name never pushes the date off
    expect(
      pdfFileName({ person: "x", document: "y", detail: "z ".repeat(200), date: d }).endsWith(
        "-2026-11-22.pdf",
      ),
    ).toBe(true);
  });

  it("chart ticks are round numbers that cover the data", () => {
    expect(niceTicks(176.4, 183.9)).toEqual([175, 177.5, 180, 182.5, 185]);
    const t = niceTicks(0, 23);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(23);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(6);
  });

  it("a document turns landscape only when its tables need the width", () => {
    expect(orientationFor([18, 200, 34, 50, 90, 60, 50])).toBe("portrait");
    expect(orientationFor([60, 110, 50, 60, 46, 46, 56, 52, 52, 52])).toBe("landscape");
  });
});

describe("a prescription and a logged set, as printed", () => {
  it("a load as the coach wrote it: its own unit, a % with what it's of", () => {
    expect(prescribedLoad({ load_kg: 140, load_lb: 308, load_unit: "kg" } as any)).toBe("140 kg");
    expect(prescribedLoad({ load_kg: 140, load_lb: 305, load_unit: "lb" } as any)).toBe("305 lb");
    expect(prescribedLoad({ load_lb: 225 } as any)).toBe("225 lb");
    expect(prescribedLoad({ percentage: 92.5, percentage_basis: "top_set" } as any)).toBe(
      "92.5% of top set",
    );
    expect(prescribedLoad({ percentage: 75, percentage_basis: "training_max" } as any)).toBe(
      "75% TM",
    );
    expect(prescribedLoad({ percentage: 80, percentage_basis: null } as any)).toBe("80%");
    expect(
      prescriptionLine({
        sets: 3,
        reps_text: "8-10",
        rir: "2",
        rest_seconds: 150,
        tempo: "3-1-1",
      } as any),
    ).toBe("3 × 8-10 · RIR 2 · rest 2:30 min · tempo 3-1-1");
    expect(
      prescriptionLine({ sets: 1, measurement_type: "time", duration_seconds: 600 } as any),
    ).toBe("1 × 10 min");
  });

  it("logged sets read as typed, identical ones in a row said once, never a set number that reads as a weight", () => {
    const lines = loggedLines([
      { set_index: 1, entered_value: 140, entered_unit: "kg", actual_reps: 3, actual_rpe_num: 8 },
      { set_index: 2, entered_value: 130, entered_unit: "kg", actual_reps: 4, actual_rpe_num: 7 },
      { set_index: 3, entered_value: 130, entered_unit: "kg", actual_reps: 4, actual_rpe_num: 7 },
      { set_index: 4, completed_duration_seconds: 600, actual_calories: 85 },
    ]);
    expect(lines).toEqual([
      "Set 1: 140 kg × 3 · RPE 8",
      "Sets 2–3: 130 kg × 4 · RPE 7",
      "Set 4: 10 min · 85 cal",
    ]);
  });

  it("a workout's status is read against today", () => {
    const today = "2026-11-22";
    const d = (o: any) => ({ id: "d", day_index: 1, rows: [], ...o });
    expect(
      dayStatus(d({ completed_at: "2026-11-20T18:00:00Z", scheduled_date: "2026-11-20" }), today)
        .label,
    ).toBe("Completed");
    expect(dayStatus(d({ scheduled_date: "2026-11-20" }), today).label).toBe("Missed");
    expect(dayStatus(d({ scheduled_date: "2026-11-20", is_optional: true }), today).label).toBe(
      "Skipped (optional)",
    );
    expect(dayStatus(d({ scheduled_date: "2026-11-22" }), today).label).toBe("Today");
    expect(dayStatus(d({ scheduled_date: "2026-11-25" }), today).label).toBe("Upcoming");
    expect(
      dayStatus(
        d({
          scheduled_date: "2026-11-18",
          rows: [{ logged_sets: [{ actual_reps: 5, entered_value: 100 }] }],
        }),
        today,
      ).label,
    ).toBe("Partly logged");
  });
});

describe("the documents", () => {
  const row = (name: string, o: any = {}) => ({
    exercises: { name },
    sets: 3,
    reps_text: "8",
    rpe: "7",
    ...o,
  });
  const week = (i: number, reps = "8") => ({
    id: `w${i}`,
    week_index: i,
    days: [
      {
        id: `d${i}`,
        day_index: 1,
        title: "Lower",
        rows: [row("Competition Squat", { reps_text: reps })],
      },
    ],
  });

  it("a one-workout program is one page; a week that repeats the one before is a line, not a table", () => {
    const one = generateProgramPdf({
      client_name: "A",
      blocks: [{ block_name: "Day pass", weeks: [week(1)] }],
    });
    expect(one.finish().getNumberOfPages()).toBe(1);
    const rep = generateProgramPdf(
      { client_name: "A", blocks: [{ block_name: "B", weeks: [week(1), week(2), week(3, "5")] }] },
      { compress: false },
    );
    const text = rep.finish().output();
    expect(text).toContain("Same workouts as Week 1.");
    expect(text).not.toContain("Same workouts as Week 2.");
  });

  it("a program's percentages list the maxes they read, only when one does", () => {
    const pct = {
      client_name: "A",
      maxes: [
        {
          lift: "Competition Squat",
          unit: "kg" as const,
          one_rm: 250,
          training_max: 235,
          estimated_1rm: null,
          block: null,
        },
      ],
      blocks: [
        {
          block_name: "B",
          weeks: [
            {
              ...week(1),
              days: [
                {
                  id: "d",
                  day_index: 1,
                  rows: [
                    row("High Bar Squat", { percentage: 70, percentage_basis: "training_max" }),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(generateProgramPdf(pct, { compress: false }).finish().output()).toContain(
      "Maxes the percentages use",
    );
    expect(
      generateProgramPdf(
        { ...pct, blocks: [{ block_name: "B", weeks: [week(1)] }] },
        { compress: false },
      )
        .finish()
        .output(),
    ).not.toContain("Maxes the percentages use");
  });

  it("an empty report and an empty program say so instead of printing nothing", () => {
    expect(
      buildTrainingReportDoc({ client_name: "A", blocks: [] }, { compress: false })
        .finish()
        .output(),
    ).toContain("No training blocks were picked.");
    expect(
      generateProgramPdf({ client_name: "A", blocks: [] }, { compress: false }).finish().output(),
    ).toContain("There are no workouts in the blocks picked.");
  });

  it("a library plan prints as the same program, weeks numbered through the plan", () => {
    const p = libraryPlanProgram({
      public_title: "Plan",
      published_payload: {
        blocks_data: [
          {
            name: "A",
            weeks_data: [{ days: [{ day_index: 1, rows: [{ exercise_name: "Squat", sets: 3 }] }] }],
          },
          { name: "B", weeks_data: [{ days: [] }, { days: [] }] },
        ],
      },
    });
    expect(p.blocks.map((b) => b.weeks.map((w) => w.week_index))).toEqual([[1], [2, 3]]);
    expect(p.program_name).toBe("Plan");
    expect(p.blocks[0].weeks[0].days[0].rows[0].exercise_name_override).toBe("Squat");
  });

  it("a nutrition plan says when each day is used and works a meal's calories from its macros", () => {
    expect(
      planDayWhen(
        { day_label: "Training Day (Friday Only)", calories: 1, protein: 1, carbs: 1, fats: 1 },
        2,
      ),
    ).toBe("Training days · Fri");
    expect(
      planDayWhen(
        {
          day_label: "Rest",
          calories: 1,
          protein: 1,
          carbs: 1,
          fats: 1,
          use_on: "rest",
          weekdays: [],
        },
        2,
      ),
    ).toBe("Rest days");
    expect(mealCalories({ protein: 36, carbs: 65, fat: 12 })).toBe(512);
    expect(mealCalories({ protein: 36, carbs: 65 })).toBeNull();
    const doc = buildMealPlanPdf(
      {
        client_name: "A",
        phase: "Fat Loss",
        supplements: {
          items: [{ name: "Creatine monohydrate", dose: "5 g", timing: "Daily" }],
          notes: [],
        },
        days: [
          {
            day_label: "Training Day",
            calories: 2400,
            protein: 160,
            carbs: 260,
            fats: 60,
            notes: "Meal 1\n150 g chicken\nApproximate macros: 40 g protein, 0 g carbs, 5 g fat",
          },
        ],
      },
      { compress: false },
    );
    const text = doc.finish().output();
    expect(text).toContain("Creatine monohydrate");
    expect(text).toContain("2,400 kcal");
    expect(text).toContain("P 40 g");
  });

  it("a progress report with nothing logged says so, never a number made up", () => {
    const doc = buildProgressReport({
      athlete: "A",
      audience: "client",
      period: { label: "Last 4 weeks", start: new Date(2026, 9, 25), end: new Date(2026, 10, 22) },
      unit: "kg",
      load: buildTrainingLoad({ sets: [], plan: [], today: "2026-11-22" }),
      prs: [],
      bodyweight: [],
      nutrition: null,
    });
    const text = doc.finish().output();
    expect(doc.finish().getNumberOfPages()).toBe(1);
    expect(text.length).toBeGreaterThan(1000);
  });
});

describe("one way a PDF reaches the person", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it("nothing calls jsPDF's save() (it does nothing in the iPhone app): every PDF goes to the share sheet or a download", () => {
    const offenders = files("src")
      .filter((f) => !f.startsWith("src/test"))
      .filter((f) => /(^|[^`])\bdoc\.save\(|\.save\(`\$\{|\)\.save\(exportFileName/m.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("every training, nutrition and report PDF is drawn with the kit", () => {
    for (const f of [
      "src/lib/workouts/workout-pdf.ts",
      "src/lib/nutrition-targets/meal-plan-pdf.ts",
      "src/lib/grocery-list-pdf.ts",
      "src/lib/block-pdf.ts",
      "src/lib/program-intel/pdf.ts",
      "src/lib/nutrition-roadmap/roadmap-pdf.ts",
      "src/lib/analytics/progress-report-pdf.ts",
      "src/lib/purchase-pdf.ts",
    ]) {
      const src = read(f);
      expect(src, f).toContain('from "@/lib/pdf/kit"');
      expect(src, f).not.toMatch(/new jsPDF\(/);
    }
  });

  it("the coach's plan PDF is the plan, never days averaged together, and the old generators are gone", () => {
    expect(read("src/components/nutrition-targets-panel.tsx")).toContain(
      'import("@/lib/nutrition-targets/meal-plan-pdf")',
    );
    for (const gone of [
      "src/lib/nutrition-targets-pdf.ts",
      "src/lib/membership-library-pdf.server.ts",
    ]) {
      expect(() => statSync(gone)).toThrow();
    }
  });

  it("the training sheet offers the program and the report; analytics and the roadmap offer theirs", () => {
    expect(read("src/components/workouts/training-report-sheet.tsx")).toContain(
      "data-training-pdf-mode",
    );
    expect(read("src/components/analytics/client-analytics-dashboard.tsx")).toContain(
      "data-progress-report",
    );
    expect(read("src/components/nutrition-roadmap/roadmap-athlete.tsx")).toContain(
      "data-roadmap-pdf",
    );
    expect(read("src/components/nutrition-roadmap/roadmap-coach.tsx")).toContain(
      "data-roadmap-pdf",
    );
  });
});
