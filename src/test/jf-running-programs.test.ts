import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUN_EXERCISES, RUN_PROGRAMS, RUN_TEMPLATE_IDS, rowMinutes, type RunDay, type RunProgramDef, type RunRole } from "@/lib/jf-programs/running";
import { buildRunPayload, buildRunningLibrary, runProgramWeeks } from "@/lib/jf-programs/running-build";
import { RUNNING_MIGRATION, runningLibrarySql, stableUuid } from "@/lib/jf-programs/sql";
import { payloadSummary } from "@/lib/jf-programs/build";
import { libraryCategoryOf } from "@/lib/programs/library-view";
import { validateTemplatePayload } from "@/lib/pl-template-validation";

const QUALITY: RunRole[] = ["Steady", "Fartlek", "Threshold", "Tempo", "Race effort", "Marathon pace"];
const weeksOf = (p: RunProgramDef) => p.phases.flatMap((ph) => ph.weeks);
const runMinutes = (d: RunDay) => d.rows.filter((r) => r.ex === "run").reduce((s, r) => s + rowMinutes(r), 0);
const coreMinutes = (w: { days: RunDay[] }) => w.days.filter((d) => !d.optional).reduce((s, d) => s + runMinutes(d), 0);
const longRunMinutes = (w: { days: RunDay[] }) =>
  Math.max(0, ...w.days.filter((d) => d.rows.some((r) => r.role === "Long run")).map(runMinutes));
const qualityDays = (w: { days: RunDay[] }) =>
  w.days.filter((d) => d.rows.some((r) => QUALITY.includes(r.role) && !(r.role === "Marathon pace" && d.rows.some((x) => x.role === "Long run"))));
const byName = (name: string) => RUN_PROGRAMS.find((p) => p.name.startsWith(`JF Effect | ${name} — `))!;

describe("the running library", () => {
  it("is three programs with fixed ids hashed from their slugs", () => {
    // named like the rest of the JF Effect library: "JF Effect | Name — Level — days"
    expect(RUN_PROGRAMS.map((p) => p.name)).toEqual([
      "JF Effect | Run Foundation — Beginner — 3 days/week",
      "JF Effect | Distance Builder — Intermediate — 3 days/week + 2 optional runs",
      "JF Effect | Marathon Performance — Advanced — 4 days/week + 2 optional runs",
    ]);
    for (const p of RUN_PROGRAMS) expect(RUN_TEMPLATE_IDS[p.slug]).toBe(stableUuid(p.slug));
  });

  it("the migration is generated from the definitions (never hand-edited)", () => {
    expect(readFileSync(RUNNING_MIGRATION, "utf8")).toBe(runningLibrarySql());
  });

  it("each sits in the Running category, as a conditioning program, by level", () => {
    const lib = buildRunningLibrary();
    for (const t of lib) {
      expect(libraryCategoryOf(t.tags)).toBe("Running");
      expect(t.training_style).toBe("conditioning");
      expect(t.status).toBe("Published");
    }
    expect(lib.map((t) => [t.weeks, t.days_per_week])).toEqual([[12, 3], [12, 5], [18, 6]]);
  });

  it("passes the builder's own program check (nothing to fix)", () => {
    for (const t of buildRunningLibrary()) expect(validateTemplatePayload(t)).toEqual([]);
  });

  it("uses only the library's own Running and Walking exercises, every row timed", () => {
    const ids = new Set(Object.values(RUN_EXERCISES).map((e) => e.id));
    for (const t of buildRunningLibrary()) {
      for (const b of t.payload.blocks_data) for (const w of b.weeks_data) for (const d of w.days) for (const r of d.rows) {
        expect(ids.has(r.exercise_id)).toBe(true);
        expect(r.measurement_type).toBe("time");
        // a row with no time target says what it is instead ("5 km", "Race")
        if (r.duration_seconds == null) expect(r.reps_text).toBeTruthy();
        else expect(r.duration_seconds).toBeGreaterThan(0);
      }
    }
  });

  it("writes every week out, with its purpose, and no week repeats the one before", () => {
    for (const p of RUN_PROGRAMS) {
      const weeks = weeksOf(p);
      expect(weeks.length).toBe(runProgramWeeks(p));
      weeks.forEach((w, i) => {
        expect(w.purpose.length).toBeGreaterThan(30);
        if (i > 0) expect(JSON.stringify(w.days)).not.toBe(JSON.stringify(weeks[i - 1].days));
      });
      const summary = payloadSummary(buildRunPayload(p));
      expect(summary.weeks).toBe(weeks.length);
      expect(summary.blocks).toBe(p.phases.length);
    }
  });

  it("core days come first and optional days after (workouts land on training days in order)", () => {
    for (const p of RUN_PROGRAMS) {
      for (const w of weeksOf(p)) {
        const firstOptional = w.days.findIndex((d) => d.optional);
        const core = w.days.filter((d) => !d.optional).length;
        expect(core).toBe(p.coreDays);
        if (firstOptional >= 0) expect(w.days.slice(firstOptional).every((d) => d.optional)).toBe(true);
      }
    }
  });

  it("optional days are only easy or recovery running", () => {
    for (const p of RUN_PROGRAMS) {
      for (const w of weeksOf(p)) {
        for (const d of w.days.filter((x) => x.optional)) {
          for (const r of d.rows) {
            expect(["Easy", "Recovery"]).toContain(r.role);
            expect(Math.max(...(r.rpe ?? "0").split("-").map(Number))).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });
});

describe("the coaching rules hold in every week", () => {
  it("Run Foundation has no speed work at all: every run is easy", () => {
    for (const w of weeksOf(byName("Run Foundation"))) {
      expect(qualityDays(w)).toEqual([]);
      for (const d of w.days) for (const r of d.rows) if (r.ex === "run" && r.role !== "5K") expect(r.rpe).toBe("3-4");
    }
  });

  it("never more than one quality session a week", () => {
    for (const p of RUN_PROGRAMS) for (const w of weeksOf(p)) expect(qualityDays(w).length).toBeLessThanOrEqual(1);
  });

  it("a lower-stress week at least every 4th week", () => {
    for (const p of RUN_PROGRAMS) {
      let since = 0;
      for (const w of weeksOf(p)) {
        since = w.lowerStress ? 0 : since + 1;
        expect(since).toBeLessThanOrEqual(4);
      }
    }
  });

  it("weekly running never jumps more than 20% over the most the athlete has already done", () => {
    for (const p of RUN_PROGRAMS) {
      let best = 0;
      weeksOf(p).forEach((w, i) => {
        const now = coreMinutes(w);
        if (i > 0) expect(now).toBeLessThanOrEqual(best * 1.2 + 0.5);
        best = Math.max(best, now);
      });
    }
  });

  it("the long run grows at most 15 minutes past the longest so far, and lower-stress weeks shorten it", () => {
    for (const name of ["Distance Builder", "Marathon Performance"]) {
      let prev = 0;
      let longest = 0;
      for (const w of weeksOf(byName(name))) {
        const now = longRunMinutes(w);
        if (!now) continue; // race week
        if (longest) expect(now - longest).toBeLessThanOrEqual(15);
        if (w.lowerStress && prev) expect(now).toBeLessThan(prev);
        prev = now;
        longest = Math.max(longest, now);
      }
    }
  });

  it("marathon long runs are set by time and top out at 2 h 50, with marathon pace in only some of them", () => {
    const weeks = weeksOf(byName("Marathon Performance"));
    expect(Math.max(...weeks.map(longRunMinutes))).toBe(170);
    const withMp = weeks.filter((w) => w.days.some((d) => d.rows.some((r) => r.role === "Long run") && d.rows.some((r) => r.role === "Marathon pace")));
    expect(withMp.length).toBeGreaterThan(0);
    expect(withMp.length).toBeLessThanOrEqual(5);
  });

  it("the marathon taper cuts volume week by week and keeps a quality session", () => {
    const weeks = weeksOf(byName("Marathon Performance"));
    const peak = Math.max(...weeks.map(coreMinutes));
    const [t1, t2, race] = weeks.slice(-3);
    expect(coreMinutes(t1) / peak).toBeLessThan(0.85);
    expect(coreMinutes(t2) / peak).toBeLessThan(0.65);
    expect(coreMinutes(race)).toBeLessThan(coreMinutes(t2));
    for (const w of [t1, t2, race]) expect(qualityDays(w).length).toBe(1);
  });

  it("each program ends where it says: a 5 km run, a race, a marathon", () => {
    const last = (p: RunProgramDef) => weeksOf(p).at(-1)!.days.flatMap((d) => d.rows).find((r) => r.seconds == null);
    expect(last(byName("Run Foundation"))?.label).toBe("5 km");
    expect(last(byName("Distance Builder"))?.label).toBe("Race");
    expect(last(byName("Marathon Performance"))?.label).toBe("Marathon");
  });

  it("the coach guide covers what Edit with AI needs to adapt a copy", () => {
    for (const p of RUN_PROGRAMS) {
      for (const s of ["Repeat the week", "Missed sessions are never made up", "Pain", "Effort scale", "Strength training alongside", "race date"]) {
        expect(p.coachGuide.toLowerCase()).toContain(s.toLowerCase());
      }
    }
  });
});
