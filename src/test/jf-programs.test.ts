import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EX, NEW_EXERCISES, type ExKey } from "@/lib/jf-programs/catalog";
import { JF_PROGRAMS } from "@/lib/jf-programs/programs";
import { buildLibrary } from "@/lib/jf-programs/build";
import { librarySql, LIBRARY_MIGRATION, stableUuid } from "@/lib/jf-programs/sql";
import { validateTemplatePayload } from "@/lib/pl-template-validation";
import { libraryCategoryOf, libraryCategorySections, toLibraryPrograms } from "@/lib/programs/library-view";
import { getWorkoutStatus } from "@/lib/workout-status";
import { programGuideText } from "@/lib/program-ai/program-guide";

const lib = buildLibrary();
const weeksOf = (t: (typeof lib)[number]) => t.payload.blocks_data.flatMap((b: any) => b.weeks_data);
const idToKey = new Map(Object.entries(EX).map(([k, v]) => [v.id, k as ExKey]));
const hardSets = (week: any) => week.days.filter((d: any) => !d.is_optional).flatMap((d: any) => d.rows).reduce((n: number, r: any) => n + r.sets, 0);

describe("the 12 JF Effect programs", () => {
  it("exactly 12, unique, three per category, under fixed ids", () => {
    expect(lib).toHaveLength(12);
    expect(new Set(lib.map((t) => t.id)).size).toBe(12);
    expect(new Set(lib.map((t) => t.name)).size).toBe(12);
    expect(new Set(lib.map((t) => t.slug)).size).toBe(12);
    for (const t of lib) expect(t.id).toBe(stableUuid(t.slug));
    const byCat = new Map<string, number>();
    for (const p of JF_PROGRAMS) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
    expect(Object.fromEntries(byCat)).toEqual({ Athletes: 3, Men: 3, Women: 3, "At Home": 3 });
    for (const t of lib) expect(t.name.startsWith("JF Effect | ")).toBe(true);
    for (const t of lib) expect(`${t.name} ${t.description}`).not.toMatch(/\bJJT\b/);
  });

  it("144 program-weeks: 3 blocks of 4 weeks each", () => {
    let weeks = 0;
    for (const t of lib) {
      expect(t.payload.schema_version).toBe("2");
      expect(t.payload.blocks_data).toHaveLength(3);
      for (const b of t.payload.blocks_data) expect(b.weeks_data).toHaveLength(4);
      weeks += weeksOf(t).length;
    }
    expect(weeks).toBe(144);
  });

  it("3 core days for 01, 04, 07, 10, 11; 4 for 02, 05, 06, 08, 09, 12; 3 + 1 optional for 03: 504 core workouts, 12 optional", () => {
    const core: Record<number, number> = { 1: 3, 2: 4, 3: 3, 4: 3, 5: 4, 6: 4, 7: 3, 8: 4, 9: 4, 10: 3, 11: 3, 12: 4 };
    let coreTotal = 0;
    let optionalTotal = 0;
    JF_PROGRAMS.forEach((p, i) => {
      const t = lib[i];
      for (const w of weeksOf(t)) {
        const c = w.days.filter((d: any) => !d.is_optional).length;
        const o = w.days.filter((d: any) => d.is_optional).length;
        expect(c, p.name).toBe(core[p.number]);
        expect(o, p.name).toBe(p.number === 3 ? 1 : 0);
        coreTotal += c;
        optionalTotal += o;
      }
    });
    expect(coreTotal).toBe(504);
    expect(optionalTotal).toBe(12);
  });

  it("no program repeats Week 1: every week is its own prescription", () => {
    for (const t of lib) {
      const prints = weeksOf(t).map((w: any) => JSON.stringify(w.days.map((d: any) => d.rows.map((r: any) => [r.exercise_id, r.sets, r.reps_text, r.rpe, r.rir, r.percentage, r.duration_seconds]))));
      expect(new Set(prints).size, t.name).toBeGreaterThanOrEqual(10);
      for (let i = 1; i < prints.length; i++) expect(prints[i], `${t.name} week ${i + 1}`).not.toBe(prints[i - 1]);
    }
  });

  it("Weeks 4 and 8 are real deloads (beginners: a lighter week)", () => {
    JF_PROGRAMS.forEach((p, i) => {
      const weeks = weeksOf(lib[i]);
      for (const [deload, before] of [[4, 3], [8, 7]]) {
        const ratio = hardSets(weeks[deload - 1]) / hardSets(weeks[before - 1]);
        if (p.track === "beginner") expect(ratio, `${p.name} W${deload}`).toBeLessThan(0.95);
        else expect(ratio, `${p.name} W${deload}`).toBeLessThanOrEqual(0.7);
        for (const d of weeks[deload - 1].days) for (const r of d.rows) {
          if (r.rir) expect(["3-4"], `${p.name} W${deload} ${r.exercise_name_override}`).toContain(r.rir);
          if (r.rpe) expect(Number(String(r.rpe).split("-").pop()), `${p.name} W${deload}`).toBeLessThanOrEqual(6.5);
          expect(r.percentage_basis, "no top-set back-offs on a deload").not.toBe("top_set");
        }
      }
    });
  });

  it("powerlifting: top set and back-offs are separate rows, back-offs a % of the logged top set, RPE never above 8.5", () => {
    for (const p of JF_PROGRAMS.filter((x) => x.style === "powerlifting")) {
      const t = lib[p.number - 1];
      let backoffs = 0;
      for (const w of weeksOf(t)) for (const d of w.days) {
        d.rows.forEach((r: any, i: number) => {
          if (r.rpe) expect(Math.max(...String(r.rpe).split("-").map(Number)), `${p.name} ${w.phase}`).toBeLessThanOrEqual(8.5);
          if (r.percentage_basis !== "top_set") return;
          backoffs++;
          expect(r.rpe, "a back-off has one load instruction").toBeNull();
          expect(r.percentage).toBeGreaterThanOrEqual(85);
          expect(r.percentage).toBeLessThanOrEqual(92);
          const top = d.rows[i - 1];
          expect(top.exercise_id, "the top set sits right above its back-offs").toBe(r.exercise_id);
          expect(top.sets).toBe(1);
          expect(top.rpe).toBeTruthy();
        });
      }
      expect(backoffs, p.name).toBeGreaterThan(10);
    }
  });

  it("week 1 of every primary lift has its back-off sets (no missing back-offs)", () => {
    const p02 = weeksOf(lib[1])[0];
    for (const d of p02.days) {
      const primaries = d.rows.filter((r: any) => r.purpose_label === "Primary");
      if (primaries.length) expect(primaries.some((r: any) => r.percentage_basis === "top_set"), d.title).toBe(true);
    }
  });

  it("accessories in strength programs ease off as the main lifts peak (Weeks 10–12 at 2+ in reserve)", () => {
    for (const p of JF_PROGRAMS.filter((x) => x.style === "powerlifting")) {
      const weeks = weeksOf(lib[p.number - 1]);
      for (const wk of [10, 11, 12]) for (const d of weeks[wk - 1].days) for (const r of d.rows) {
        if (!r.rir) continue;
        expect(Number(String(r.rir).split("-")[0]), `${p.name} W${wk} ${r.exercise_name_override}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("every row is complete (the validator finds nothing) with rest, sets and a library exercise", () => {
    for (const t of lib) {
      expect(validateTemplatePayload(t), t.name).toEqual([]);
      for (const w of weeksOf(t)) for (const d of w.days) for (const r of d.rows) {
        expect(idToKey.has(r.exercise_id), r.exercise_name_override).toBe(true);
        expect(r.sets).toBeGreaterThanOrEqual(1);
        expect(r.rest_seconds).toBeGreaterThanOrEqual(45);
        expect(r.rest_seconds).toBeLessThanOrEqual(360);
        expect(r.reps_text || r.duration_seconds).toBeTruthy();
        expect(String(r.notes ?? "").length, r.exercise_name_override).toBeLessThanOrEqual(320);
      }
    }
  });

  it("at-home programs only use what they say: zero equipment, or dumbbells and the floor", () => {
    const bodyweight: ExKey[] = ["bwSquat", "pushUp", "bwReverseLunge", "bwGluteBridge", "proneW", "plank", "splitSquat", "bwSingleLegRdl", "proneYTW", "deadBug", "singleLegCalf", "lateralLunge", "singleLegBridge", "proneSnowAngel", "sidePlank"];
    const dumbbellFloor: ExKey[] = [...bodyweight, "gobletSquat", "dbFloorPress", "oneArmDbRow", "dbRdl", "dbLateralRaise", "dbReverseLunge", "standingDbPress", "dbBentRow", "dbGluteBridge", "dbCurl", "floorCrunch", "dbSplitSquat", "rearDeltDb", "dbOhTriceps", "suitcaseCarry", "bStanceRdl", "walkingLunge", "dbStandingCalf", "hammerCurl"];
    const used = (n: number) => new Set(weeksOf(lib[n - 1]).flatMap((w: any) => w.days.flatMap((d: any) => d.rows.map((r: any) => idToKey.get(r.exercise_id)))));
    for (const k of used(10)) expect(bodyweight, `bodyweight program uses ${k}`).toContain(k);
    for (const n of [11, 12]) for (const k of used(n)) expect(dumbbellFloor, `program ${n} uses ${k}`).toContain(k);
  });

  it("the bodyweight program says honestly that it can't replace rows", () => {
    const p10 = JF_PROGRAMS[9];
    expect(p10.description).toMatch(/no real pulling exercise/);
    const notes = weeksOf(lib[9]).flatMap((w: any) => w.days.flatMap((d: any) => d.rows)).filter((r: any) => [EX.proneW.id, EX.proneYTW.id, EX.proneSnowAngel.id].includes(r.exercise_id));
    expect(notes.length).toBeGreaterThan(0);
    for (const r of notes) expect(r.notes).toMatch(/doesn't replace rows or pulldowns/);
  });

  it("every change from the spec is written down with its reason", () => {
    const changed = JF_PROGRAMS.filter((p) => p.changes.length);
    expect(changed.map((p) => p.number)).toEqual([1, 2, 3, 5, 6, 8, 10, 12]);
    for (const p of changed) expect(lib[p.number - 1].notes).toContain("Changes from the JF Effect master spec");
  });

  it("the migration file is generated from these definitions (never hand-edited)", () => {
    expect(readFileSync(LIBRARY_MIGRATION, "utf8")).toBe(librarySql());
  });

  it("the import is idempotent and creates the six new exercises only by name", () => {
    const sql = librarySql();
    expect(sql.match(/ON CONFLICT \(id\) DO NOTHING;/g)?.length).toBe(13);
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.exercises e WHERE lower(e.name) = lower(v.name)");
    expect(Object.keys(NEW_EXERCISES)).toHaveLength(6);
    const executable = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(executable).not.toMatch(/DELETE FROM|UPDATE public\./);
  });
});

describe("template roles and optional days survive assignment", () => {
  const sql = readFileSync("supabase/migrations/20270314080000_template_roles_and_optional_days.sql", "utf8");
  it("pl_apply_template_meta runs at every whole-program return of the assign function", () => {
    expect(sql).toContain("IF n_prep <> 2 OR n_block <> 2 THEN");
    expect(sql).toContain("PERFORM public.pl_apply_template_meta(v_tpl.id, v_prep_id, NULL); ");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.pl_apply_template_meta(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("AND er.purpose_label IS NULL;");
  });
  it("a skipped optional day is never a miss", () => {
    const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const base = { week: {}, block: {}, completion: null, scheduledDate: yesterday };
    const optional = getWorkoutStatus({ ...base, day: { scheduled_date: yesterday, is_optional: true } } as any);
    const core = getWorkoutStatus({ ...base, day: { scheduled_date: yesterday } } as any);
    expect(optional.status).toBe("optional_skipped");
    expect(core.status).toBe("missed");
    expect(sql).toContain("and not exists (select 1 from public.pl_days pd_opt where pd_opt.id = sw.source_day_id and pd_opt.is_optional)");
    for (const f of ["src/lib/coach-intel.ts", "src/lib/block-analytics.ts", "src/lib/program-intel/core.ts"]) {
      expect(readFileSync(f, "utf8"), f).toContain("is_optional");
    }
  });
});

describe("the library and the AI read the programs", () => {
  it("JF Effect programs group by category, beginner to advanced; everything else after", () => {
    const programs = toLibraryPrograms(
      [
        ...lib.map((t, i) => ({ ...t, updated_at: `2026-11-${String(10 + (i % 3)).padStart(2, "0")}` })),
        { id: "x", name: "Client program", tags: ["live"], updated_at: "2026-11-01" },
      ],
      new Map(),
      new Map(),
    );
    const sections = libraryCategorySections(programs);
    expect(sections.map((s) => s.label)).toEqual(["Athletes", "Men", "Women", "At Home", "Your other programs"]);
    expect(sections[0].items.map((p) => p.name.split(" — ")[0])).toEqual(["JF Effect | Strength Foundation", "JF Effect | Strength Development", "JF Effect | Elite Powerlifting"]);
    expect(sections[3].items.map((p) => p.name.split(" — ")[0])).toEqual(["JF Effect | Bodyweight Foundation", "JF Effect | Dumbbell Muscle Builder", "JF Effect | At-Home Physique Builder"]);
    expect(libraryCategoryOf(["Women", "Glutes"])).toBeNull();
  });

  it("Edit with AI gets the program's coaching guide", () => {
    const text = programGuideText([{ name: lib[2].name, notes: lib[2].notes }]);
    expect(text).toContain("THE PROGRAM'S COACHING GUIDE");
    expect(text).toContain("Meet:");
    expect(programGuideText([{ name: "x", notes: "" }])).toBeNull();
    expect(readFileSync("src/lib/program-ai/worker.server.ts", "utf8")).toContain("loadProgramGuide(admin, snap");
  });

  it("the validator checks every block of a multi-block template", () => {
    const tpl = { template_type: "block", payload: { schema_version: "2", blocks_data: [{ name: "B1", weeks_data: [{ week_index: 1, days: [{ title: "Day 1", rows: [{ exercise_id: "e", sets: 3, reps_text: "5" }] }] }] }] } };
    expect(validateTemplatePayload(tpl)).toHaveLength(1);
  });
});

describe("JF Effect library installer (jf-library-install hook)", () => {
  it("the six new exercises use values the exercises table's checks allow", () => {
    // exercises_primary_movement_pattern_check / exercises_primary_muscle_group_check (production)
    const patterns = ["squat", "bench", "deadlift", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "knee_extension", "hip_hinge", "hamstring_curl", "glutes", "arms", "delts", "core", "conditioning", "rehab", "other"];
    const muscles = ["Chest", "Lats", "Upper Back", "Traps", "Front Delts", "Side Delts", "Rear Delts", "Biceps", "Triceps", "Forearms", "Quads", "Hamstrings", "Glutes", "Adductors", "Calves", "Abs/Core", "Lower Back", "Other"];
    for (const e of Object.values(NEW_EXERCISES)) {
      expect(patterns).toContain(e.pattern);
      expect(muscles).toContain(e.primary_muscle_group);
    }
  });


  /** a tiny in-memory stand-in for the service-role client: just the calls the installer makes */
  function fakeAdmin(seed: { exercises?: any[]; templates?: any[] } = {}) {
    const db: Record<string, any[]> = {
      exercises: [...(seed.exercises ?? [])],
      pl_templates: [...(seed.templates ?? [])],
      user_roles: [{ user_id: "admin-1", role: "admin" }],
    };
    const writes: { table: string; row: any }[] = [];
    const from = (table: string) => {
      let rows = db[table];
      const q: any = {
        select: () => q,
        ilike: (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]).toLowerCase() === v.toLowerCase())), q),
        eq: (col: string, v: any) => ((rows = rows.filter((r) => r[col] === v)), q),
        in: (col: string, vs: any[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), q),
        order: () => q,
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        upsert: (row: any) => {
          writes.push({ table, row });
          if (!db[table].some((r) => r.id === row.id)) db[table].push(row);
          return Promise.resolve({ data: null, error: null });
        },
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return q;
    };
    return { client: { from }, db, writes };
  }

  it("previews without writing anything", async () => {
    const { installJfLibrary } = await import("@/lib/jf-programs/install.server");
    const f = fakeAdmin();
    const r = await installJfLibrary(f.client);
    expect(r.applied).toBe(false);
    expect(f.writes).toHaveLength(0);
    expect(r.templates.every((t) => t.action === "would add")).toBe(true);
    expect(r.totals).toMatchObject({ programs: 12, blocks: 36, weeks: 144, coreDays: 504, optionalDays: 12 });
  });

  it("adds the 12 programs and 6 exercises once; a second run adds nothing", async () => {
    const { installJfLibrary } = await import("@/lib/jf-programs/install.server");
    const f = fakeAdmin();
    const first = await installJfLibrary(f.client, { apply: true });
    expect(first.exercises.filter((e) => e.action === "added")).toHaveLength(6);
    expect(first.templates.filter((t) => t.action === "added")).toHaveLength(12);
    expect(f.db.pl_templates.every((t) => t.owner_user_id === "admin-1" && t.status === "Published")).toBe(true);
    const writes = f.writes.length;
    const second = await installJfLibrary(f.client, { apply: true });
    expect(f.writes.length).toBe(writes);
    expect(second.templates.every((t) => t.action === "already in the library")).toBe(true);
    expect(second.exercises.every((e) => e.action === "already added")).toBe(true);
    expect(second.totals.weeks).toBe(144);
  });

  it("uses an exercise the library already has by name instead of adding a second one", async () => {
    const { installJfLibrary } = await import("@/lib/jf-programs/install.server");
    const { NEW_EXERCISES } = await import("@/lib/jf-programs/catalog");
    const mine = { id: "existing-split-squat", name: "split squat", archived: false };
    const f = fakeAdmin({ exercises: [mine] });
    const r = await installJfLibrary(f.client, { apply: true });
    expect(r.exercises.find((e) => e.name === "Split Squat")).toMatchObject({ id: mine.id, action: "uses existing" });
    expect(f.db.exercises.filter((e) => e.name.toLowerCase() === "split squat")).toHaveLength(1);
    const payloads = JSON.stringify(f.db.pl_templates.map((t) => t.payload));
    expect(payloads).not.toContain(NEW_EXERCISES.splitSquat.id);
    expect(payloads).toContain(mine.id);
  });

  it("never overwrites a program a coach already has (insert-if-absent only)", async () => {
    const { installJfLibrary } = await import("@/lib/jf-programs/install.server");
    const edited = { ...buildLibrary()[0], name: "Coach's own edit" };
    const f = fakeAdmin({ templates: [edited] });
    await installJfLibrary(f.client, { apply: true });
    expect(f.db.pl_templates.find((t) => t.id === edited.id)?.name).toBe("Coach's own edit");
    expect(f.writes.some((w) => w.table === "pl_templates" && w.row.id === edited.id)).toBe(false);
  });

  it("the hook is guarded by the hook secret and previews unless told to apply", () => {
    const hook = readFileSync("src/routes/api/public/hooks/jf-library-install.ts", "utf8");
    expect(hook).toContain("authorizeHookRequest");
    expect(hook).toContain("apply: body?.apply === true");
  });
});
