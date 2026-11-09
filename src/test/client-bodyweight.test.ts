import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { bodyweightCsv, bodyweightTiles, clientBodyweightRefreshKeys, type ClientBodyweightEntry } from "@/lib/client-bodyweight";
import { mergeBodyweightSeries } from "@/lib/bodyweight";

const read = (f: string) => readFileSync(f, "utf8");

const app = (date: string, value: number, unit: "lb" | "kg" = "lb"): ClientBodyweightEntry => ({
  id: `pb-${date}`, date, value, unit, note: null, source: "progress_bodyweight",
});

// Marc Asugui, Nov 9 2026: the coach's Progress tab said 162.5 lb on Aug 17 and
// "No bodyweight entries in this range" while he'd logged almost every morning.
const MARC = [
  app("2026-10-28", 155), app("2026-10-29", 157), app("2026-10-30", 155.6),
  app("2026-11-01", 157.6), app("2026-11-02", 156.4), app("2026-11-03", 155),
  app("2026-11-04", 156), app("2026-11-05", 156.8), app("2026-11-06", 158),
  app("2026-11-08", 157.8), app("2026-11-09", 156.6),
];

describe("the coach's bodyweight tiles read the client's real weigh-ins", () => {
  it("latest, 7-day average, the change against the week before and how many days logged", () => {
    const t = bodyweightTiles(MARC, "lb", "2026-11-09");
    expect(t.latest).toEqual({ value: 156.6, date: "2026-11-09" });
    expect(t.count7).toBe(6);
    expect(t.avg7!).toBeCloseTo(156.7, 2);
    // Oct 28 – Nov 2 averaged 156.32: a trend, never two single weigh-ins.
    expect(t.weeklyChange!).toBeCloseTo(0.38, 2);
  });

  it("converts every entry into the unit shown", () => {
    const t = bodyweightTiles([app("2026-11-08", 70, "kg"), app("2026-11-09", 154.3)], "lb", "2026-11-09");
    expect(t.avg7!).toBeCloseTo((70 / 0.45359237 + 154.3) / 2, 4);
    const kg = bodyweightTiles([app("2026-11-09", 220.462)], "kg", "2026-11-09");
    expect(kg.latest!.value).toBeCloseTo(100, 2);
  });

  it("says nothing it can't back: no weigh-in this week means no average or change", () => {
    const t = bodyweightTiles([app("2026-08-17", 162.5)], "lb", "2026-11-09");
    expect(t.latest).toEqual({ value: 162.5, date: "2026-08-17" });
    expect(t.avg7).toBeNull();
    expect(t.count7).toBe(0);
    expect(t.weeklyChange).toBeNull();
    const onlyThisWeek = bodyweightTiles([app("2026-11-08", 157), app("2026-11-09", 156)], "lb", "2026-11-09");
    expect(onlyThisWeek.avg7).toBe(156.5);
    expect(onlyThisWeek.weeklyChange).toBeNull();
    expect(bodyweightTiles([], "lb", "2026-11-09")).toEqual({ latest: null, avg7: null, count7: 0, weeklyChange: null });
  });

  it("the app's weigh-in wins a day the coach also entered", () => {
    const merged = mergeBodyweightSeries(
      [{ id: "pb", logged_date: "2026-08-17", weight_value: 160, weight_unit: "lb", note: null }],
      [
        { id: "pm1", entry_date: "2026-08-17", bodyweight: 162.5, bodyweight_unit: "lb", notes: null },
        { id: "pm2", entry_date: "2026-08-10", bodyweight: 163, bodyweight_unit: "lb", notes: null },
      ],
    );
    expect(merged.map((p) => [p.date, p.value, p.source])).toEqual([
      ["2026-08-10", 163, "progress_metrics"],
      ["2026-08-17", 160, "progress_bodyweight"],
    ]);
  });

  it("exports every weigh-in, newest first, notes quoted", () => {
    const csv = bodyweightCsv([app("2026-11-08", 157.8), { ...app("2026-11-09", 156.6), note: 'after "cheat", meal' }]);
    expect(csv.split("\n")).toEqual([
      "date,bodyweight,unit,note",
      '2026-11-09,156.6,lb,"after ""cheat"", meal"',
      "2026-11-08,157.8,lb,",
    ]);
  });

  it("a coach's change refreshes the client's own screens too", () => {
    const keys = clientBodyweightRefreshKeys("c1", "u1").map((k) => JSON.stringify(k));
    expect(keys).toEqual(expect.arrayContaining([
      '["client-bodyweight","c1"]', '["progress-bw","u1"]', '["combined-bodyweight","u1"]', '["analytics-bodyweight","c1"]',
    ]));
    expect(clientBodyweightRefreshKeys("c1", null).some((k) => k[0] === "progress-bw")).toBe(false);
  });
});

describe("the Progress tab's bodyweight panel", () => {
  const panel = read("src/components/progress-metrics-panel.tsx");

  it("reads both sources, never the retired progress_metrics table alone", () => {
    expect(panel).toContain("loadClientBodyweight(clientId)");
    expect(panel).not.toMatch(/from\("progress_metrics"\)\s*\.select/);
    const lib = read("src/lib/client-bodyweight.ts");
    expect(lib).toContain('.from("progress_bodyweight")');
    expect(lib).toContain('.from("progress_metrics")');
    expect(lib).toContain(".range(from, to)");
  });

  it("adds and fixes weigh-ins where the client logs them", () => {
    const dialog = read("src/components/bodyweight/bodyweight-entry-dialog.tsx");
    expect(dialog).toContain("logBodyweight({ user_id: userId!");
    expect(dialog).toContain("updateBodyweight(userId!, entry.id");
    expect(panel).toContain("deleteBodyweight(userId, e.id)");
  });

  it("bodyweight is shown once on the tab", () => {
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toMatch(/canOpenLog\s+hideBodyweight/);
    expect(read("src/components/analytics/client-analytics-dashboard.tsx")).toContain("{!hideBodyweight && (");
  });
});

describe("a coach reads their clients' progress", () => {
  const sql = read("supabase/migrations/20270222090000_coach_reads_client_bodyweight.sql");

  it("through the coach's sets, never assigned_coach_id against the login", () => {
    expect(sql).not.toMatch(/assigned_coach_id\s*=\s*\(?\s*SELECT auth\.uid/i);
    expect(sql).toContain("USING (user_id IN (SELECT public.coached_client_user_ids()))");
    expect(sql).toContain("USING (submission_id IN (SELECT public.coached_progress_submission_ids()))");
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(7);
  });

  it("the save and delete RPCs let the assigned coach through", () => {
    expect(sql.match(/NOT EXISTS \(SELECT 1 FROM public\.coached_client_user_ids\(\) u WHERE u = p_user_id\)/g)).toHaveLength(2);
  });
});
