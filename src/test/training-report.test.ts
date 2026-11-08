import { describe, expect, it } from "vitest";
import {
  blockRangeLabel,
  buildTrainingReport,
  defaultReportSelection,
  loadTrainingReportSource,
  pickCompletion,
  reportBlockOptions,
  setsForSession,
  trainingReportFileName,
  trainingReportSourceKey,
  type ReportSource,
} from "@/lib/workouts/training-report-data";
import { generateFullTrainingReportPdf, trainingReportPdfFile } from "@/lib/workouts/workout-pdf";
import { readFileSync, existsSync } from "node:fs";
import { AT_HOME_BACKUP_DEFINITIONS_KEY } from "@/lib/at-home-backup";
import { shouldPersistQueryKey } from "@/lib/query-persister";

const TODAY = "2026-11-08";

/** A fake Supabase client over in-memory tables: records every request's `.in()` size and range. */
function fakeDb(tables: Record<string, any[]>) {
  const calls: Array<{ table: string; inSize: number; from: number; to: number }> = [];
  const sb = {
    from(table: string) {
      const q: any = { table, filters: [] as Array<(r: any) => boolean>, inSize: 0 };
      const api: any = {
        select: () => api,
        eq: (col: string, v: any) => { q.filters.push((r: any) => r[col] === v); return api; },
        in: (col: string, vs: any[]) => { q.inSize = vs.length; const set = new Set(vs); q.filters.push((r: any) => set.has(r[col])); return api; },
        order: () => api,
        range: (from: number, to: number) => {
          calls.push({ table, inSize: q.inSize, from, to });
          const rows = (tables[table] ?? []).filter((r) => q.filters.every((f: any) => f(r)))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return api;
    },
  };
  return { sb, calls };
}

const id = (p: string, n: number) => `${p}-${String(n).padStart(5, "0")}`;

/** A client with `blocks` blocks of 6 weeks × 4 days × 10 exercises, 3 sets logged on each exercise of the done days. */
function bigClient(blocks: number, doneBlocks: number) {
  const t: Record<string, any[]> = { pl_blocks: [], pl_weeks: [], pl_days: [], pl_exercise_rows: [], pl_day_completions: [], pl_row_results: [], pl_exercise_notes: [] };
  let w = 0, d = 0, r = 0, s = 0;
  for (let b = 0; b < blocks; b++) {
    const start = new Date(Date.UTC(2026, 0, 1 + b * 42)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2026, 0, 1 + b * 42 + 41)).toISOString().slice(0, 10);
    t.pl_blocks.push({ id: id("b", b), client_id: "c1", name: `Block ${b + 1} — Volume`, status: b < doneBlocks ? "Completed" : "Draft", archived: false, client_visible: true, start_date: start, end_date: end, created_at: start });
    for (let wi = 1; wi <= 6; wi++) {
      const weekId = id("w", w++);
      t.pl_weeks.push({ id: weekId, block_id: id("b", b), week_index: wi });
      for (let di = 1; di <= 4; di++) {
        const dayId = id("d", d++);
        t.pl_days.push({ id: dayId, week_id: weekId, day_index: di, title: `Day ${di} — Squat focus`, notes: "Belt on top sets", notes_client_visible: false });
        const done = b < doneBlocks;
        if (done) t.pl_day_completions.push({ id: id("dc", d), client_id: "c1", day_id: dayId, scheduled_workout_id: id("sw", d), completed_at: "2026-02-01T12:00:00Z", client_notes: null });
        for (let x = 0; x < 10; x++) {
          const rowId = id("r", r++);
          t.pl_exercise_rows.push({ id: rowId, day_id: dayId, sort_order: x, sets: 3, reps_text: "5", rpe: "8", rest_seconds: 180, exercises: { name: `Exercise ${x}` } });
          if (done) for (let si = 1; si <= 3; si++) t.pl_row_results.push({ id: id("s", s++), client_id: "c1", row_id: rowId, scheduled_workout_id: id("sw", d), set_index: si, actual_reps: 5, entered_value: 225, entered_unit: "lb", actual_rpe_num: 8 });
        }
      }
    }
  }
  return t;
}

describe("loadTrainingReportSource", () => {
  it("reads every row and set in chunks and pages, never one huge request", async () => {
    const tables = bigClient(12, 9);
    const { sb, calls } = fakeDb(tables);
    const src = await loadTrainingReportSource(sb, "c1");
    expect(src.rows).toHaveLength(12 * 6 * 4 * 10); // 2,880 exercise rows
    expect(src.results).toHaveLength(9 * 6 * 4 * 10 * 3); // 6,480 sets: more than one page
    expect(src.days).toHaveLength(12 * 6 * 4);
    expect(src.missing).toEqual([]);
    // No `.in()` list longer than a URL can carry, no page past Supabase's 1,000 rows.
    expect(Math.max(...calls.map((c) => c.inSize))).toBeLessThanOrEqual(150);
    expect(Math.max(...calls.map((c) => c.to - c.from + 1))).toBeLessThanOrEqual(1000);
    // Sets are read by client, not by row id.
    expect(calls.filter((c) => c.table === "pl_row_results").every((c) => c.inSize === 0)).toBe(true);
  });

  it("makes the report without exercise notes when they can't be read, and says so", async () => {
    const { sb } = fakeDb(bigClient(1, 1));
    const broken = {
      from: (t: string) => (t === "pl_exercise_notes"
        ? { select: () => ({ eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: "denied" } }) }) }) }) }
        : sb.from(t)),
    };
    const src = await loadTrainingReportSource(broken, "c1");
    expect(src.missing).toEqual(["exercise notes"]);
    expect(src.rows.length).toBe(240);
  });
});

describe("a workout's session", () => {
  it("prefers the finished calendar instance over the old per-day row, keeping a note from either", () => {
    const c = pickCompletion([
      { day_id: "d", scheduled_workout_id: null, completed_at: "2026-07-08T10:00:00Z", client_notes: "knee felt good" },
      { day_id: "d", scheduled_workout_id: "sw1", completed_at: "2026-07-08T11:00:00Z", client_notes: null },
    ]);
    expect(c?.scheduled_workout_id).toBe("sw1");
    expect(c?.client_notes).toBe("knee felt good");
  });

  it("uses the instance's sets when it has any, else every set, in set order", () => {
    const sets = [
      { row_id: "r", scheduled_workout_id: "a", set_index: 2 },
      { row_id: "r", scheduled_workout_id: "b", set_index: 1 },
      { row_id: "r", scheduled_workout_id: "a", set_index: 1 },
    ];
    expect(setsForSession(sets, "a").map((s) => `${s.scheduled_workout_id}${s.set_index}`)).toEqual(["a1", "a2"]);
    expect(setsForSession(sets, "zzz")).toHaveLength(3);
    expect(setsForSession(sets, null).map((s) => s.set_index)).toEqual([1, 1, 2]);
  });
});

function smallSource(): ReportSource {
  return {
    blocks: [
      { id: "old", name: "Block 1 — Accumulation", status: "Completed", client_visible: true, start_date: "2026-06-15", end_date: "2026-07-05", created_at: "2026-06-01" },
      { id: "now", name: "Block 2 — Volume 4s/6s", status: "Draft", client_visible: true, start_date: "2026-11-01", end_date: "2026-12-05", created_at: "2026-10-01" },
      { id: "next", name: "Block 3 — Strength Check-In", status: "Draft", client_visible: true, start_date: "2026-12-06", end_date: "2027-01-02", created_at: "2026-10-01" },
      { id: "gone", name: "Old plan", status: "Archived", archived: true, client_visible: true, start_date: "2026-05-01", end_date: "2026-05-28", created_at: "2026-05-01" },
      { id: "gone-trained", name: "Archived but trained", status: "Archived", client_visible: true, start_date: "2026-04-01", end_date: "2026-04-28", created_at: "2026-04-01" },
      { id: "draft", name: "Generated draft", status: "Draft", client_visible: false, start_date: null, end_date: null, created_at: "2026-11-07" },
      { id: "athome", name: "At-home", status: "Active", client_visible: true, start_date: null, end_date: null, source_template_block_key: AT_HOME_BACKUP_DEFINITIONS_KEY },
    ],
    weeks: ["old", "now", "next", "gone", "gone-trained", "draft", "athome"].map((b) => ({ id: `${b}-w1`, block_id: b, week_index: 1 })),
    days: [
      ...["old", "now", "next", "gone", "draft", "athome"].flatMap((b) => [1, 2].map((i) => ({ id: `${b}-d${i}`, week_id: `${b}-w1`, day_index: i, notes: "private cue", notes_client_visible: false }))),
      { id: "gone-trained-d1", week_id: "gone-trained-w1", day_index: 1 },
      { id: "gone-trained-d2", week_id: "gone-trained-w1", day_index: 2 },
      { id: "now-d3", week_id: "now-w1", day_index: 3, notes: "for you", notes_client_visible: true },
    ],
    rows: [
      { id: "old-r1", day_id: "old-d1", sort_order: 1, exercises: { name: "Squat" } },
      { id: "now-r1", day_id: "now-d1", sort_order: 1, exercises: { name: "Bench" } },
      { id: "gt-r1", day_id: "gone-trained-d1", sort_order: 1, exercises: { name: "Deadlift" } },
    ],
    completions: [
      { day_id: "old-d1", completed_at: "2026-06-16T12:00:00Z" },
      { day_id: "old-d2", completed_at: "2026-06-18T12:00:00Z" },
      { day_id: "gone-trained-d1", completed_at: "2026-04-02T12:00:00Z" },
    ],
    results: [
      { row_id: "old-r1", set_index: 1, actual_reps: 5, entered_value: 315, entered_unit: "lb" },
      { row_id: "now-r1", set_index: 1, actual_reps: 8, entered_value: 100, entered_unit: "kg" },
      { row_id: "gt-r1", set_index: 1, actual_reps: 3, entered_value: 405, entered_unit: "lb" },
    ],
    notes: [],
    missing: [],
  };
}

describe("the block picker", () => {
  it("lists what the client was given plus anything trained: current and past newest first, then what hasn't started", () => {
    const opts = reportBlockOptions(smallSource(), TODAY);
    expect(opts.map((o) => o.id)).toEqual(["now", "old", "gone-trained", "next"]);
    const byId = Object.fromEntries(opts.map((o) => [o.id, o]));
    expect(byId.now).toMatchObject({ current: true, upcoming: false, done: 0, workouts: 3, sets: 1 });
    expect(byId.next).toMatchObject({ upcoming: true, current: false });
    expect(byId.old).toMatchObject({ done: 2, workouts: 2 });
    // An archived block shows only the days that were trained.
    expect(byId["gone-trained"]).toMatchObject({ archived: true, workouts: 1, done: 1, status: "Archived" });
  });

  it("ticks every block that has started or been trained; all of them before anything has", () => {
    const opts = reportBlockOptions(smallSource(), TODAY);
    expect(defaultReportSelection(opts).sort()).toEqual(["gone-trained", "now", "old"]);
    expect(defaultReportSelection(opts.filter((o) => o.upcoming))).toEqual(["next"]);
  });

  it("labels a block's dates", () => {
    expect(blockRangeLabel("2026-09-27", "2026-10-31", TODAY)).toBe("Sep 27 – Oct 31");
    expect(blockRangeLabel("2026-12-06", "2027-01-02", TODAY)).toBe("Dec 6 – Jan 2, 2027");
    expect(blockRangeLabel("2026-12-06", null, TODAY)).toBe("Starts Dec 6");
    expect(blockRangeLabel(null, null, TODAY)).toBeNull();
  });
});

describe("buildTrainingReport", () => {
  it("covers only the picked blocks, oldest first, with each set on its exercise", () => {
    const r = buildTrainingReport(smallSource(), ["now", "old"], { clientName: "Jared McIntyre", audience: "coach" });
    expect(r.blocks.map((b) => b.block_name)).toEqual(["Block 1 — Accumulation", "Block 2 — Volume 4s/6s"]);
    const squat = r.blocks[0].weeks[0].days[0].rows[0];
    expect(squat.logged_sets?.[0]).toMatchObject({ entered_value: 315, entered_unit: "lb" });
    expect(r.blocks[0].weeks[0].days[0].completed_at).toBe("2026-06-16T12:00:00Z");
  });

  it("gives a coach their private day notes and a client only the ones marked for them", () => {
    const coach = buildTrainingReport(smallSource(), ["now"], { audience: "coach" });
    const client = buildTrainingReport(smallSource(), ["now"], { audience: "client" });
    const notes = (r: typeof coach) => r.blocks[0].weeks[0].days.map((d) => d.notes);
    expect(notes(coach)).toEqual(["private cue", "private cue", "for you"]);
    expect(notes(client)).toEqual([null, null, "for you"]);
  });

  it("names the file after the client, and the block when it's one", () => {
    expect(trainingReportFileName("Jared McIntyre", ["Block 2 — Volume 4s/6s"])).toBe("jared-mcintyre-block-2-volume-4s-6s-training-report.pdf");
    expect(trainingReportFileName("Jared McIntyre", ["a", "b"])).toBe("jared-mcintyre-training-report.pdf");
    expect(trainingReportFileName(null, [])).toBe("training-report.pdf");
  });
});

describe("the PDF", () => {
  it("makes a long multi-block report as a PDF file", async () => {
    const { sb } = fakeDb(bigClient(12, 9));
    const src = await loadTrainingReportSource(sb, "c1");
    const opts = reportBlockOptions(src, TODAY);
    const data = buildTrainingReport(src, opts.map((o) => o.id), { clientName: "Jared McIntyre", audience: "coach" });
    const started = Date.now();
    const file = trainingReportPdfFile(data, "jared-mcintyre-training-report.pdf");
    const ms = Date.now() - started;
    expect(file.type).toBe("application/pdf");
    expect(file.name).toBe("jared-mcintyre-training-report.pdf");
    expect(file.size).toBeGreaterThan(50_000);
    const head = new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer()));
    expect(head).toBe("%PDF-");
    // Made in the sheet ahead of the tap; keep it well inside a few seconds.
    expect(ms).toBeLessThan(15_000);
  }, 30_000);

  it("keeps a block name's dash instead of dropping it", () => {
    const doc = generateFullTrainingReportPdf({ client_name: "Jared", blocks: [{ block_name: "Block 2 — Volume", weeks: [] }] }, { compress: false });
    const text = doc.output();
    expect(text).toContain("Block 2 - Volume");
  });
});

describe("one way in", () => {
  it("never saves the report's data to the phone's storage", () => {
    expect(shouldPersistQueryKey(trainingReportSourceKey("c1"))).toBe(false);
  });

  it("every Download Training Report opens the picker, and the old one-request loader is gone", () => {
    expect(existsSync("src/lib/workouts/download-full-training-report.ts")).toBe(false);
    for (const f of ["src/components/clients/quick-actions.tsx", "src/components/clients/client-training-tab.tsx", "src/components/workouts/WorkoutsExperience.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("<TrainingReportSheet");
    }
  });
});
