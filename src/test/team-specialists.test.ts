/**
 * Specialists (game day coach, performance specialist): the words, the
 * footage / training / performance reads, routing, invite tokens and proof,
 * and the guarantees that live in the code (every read checks access first,
 * no private notes are ever selected, notes stay out of Cleo).
 * The database half is supabase/tests/team-specialists.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanAccess,
  isPreset,
  permissionSummary,
  PRESETS,
  SPECIALIST_HOME,
} from "@/lib/team-access/presets";
import {
  availableFilters,
  compareCandidates,
  defaultFilter,
  footageItem,
  footageLine,
  matchesFilter,
  sortFootage,
  type FootageSource,
} from "@/lib/team-access/footage";
import {
  buildTrainingView,
  currentBlockId,
  rowKind,
  type TrainingRowSrc,
} from "@/lib/team-access/training";
import { buildPerformanceView, loadVelocityFit } from "@/lib/team-access/performance";
import { crewHome } from "@/lib/launch-home";
import { roleRequiresMfa } from "@/lib/mfa-rules";
import { CLEO_HIDDEN_TABLES } from "@/lib/cleo-data-access";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("presets", () => {
  it("cleans an access list: one row per athlete, booleans, never a bad id", () => {
    const out = cleanAccess([
      { client_id: A, footage: false },
      { client_id: A, training: false },
      { client_id: "not-an-id" },
      { client_id: B, performance: "yes" },
    ]);
    expect(out).toEqual([
      { client_id: A, footage: false, training: true, performance: true },
      { client_id: B, footage: true, training: true, performance: true },
    ]);
    expect(cleanAccess("nope")).toEqual([]);
    expect(
      cleanAccess(
        Array.from({ length: 40 }, (_, i) => ({
          client_id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        })),
      ).length,
    ).toBe(25);
  });

  it("says what they'll see per athlete and what they never can", () => {
    const s = permissionSummary([
      { name: "Jared", flags: { footage: true, training: false, performance: true } },
      { name: "Marc", flags: { footage: false, training: false, performance: false } },
    ]);
    expect(s.sees).toEqual(["Jared: footage and performance"]);
    expect(s.never.join(" ")).toMatch(/Messages, Crew, nutrition, check-ins or recovery/);
    expect(s.never.join(" ")).toMatch(/Cleo/);
  });

  it("knows its presets", () => {
    expect(isPreset("game_day_coach")).toBe(true);
    expect(isPreset("coach")).toBe(false);
    expect(PRESETS.game_day_coach.label).toBe("Game Day Coach");
  });
});

const src = (over: Partial<FootageSource> = {}): FootageSource => ({
  id: "v1",
  created_at: "2026-11-20T18:00:00Z",
  set_index: 1,
  warmup: false,
  exercise_name: "Competition Squat",
  workout_title: "Monday",
  duration_s: 21.4,
  day_date: "2026-11-20",
  result: {
    completed_at: "2026-11-20T18:01:00Z",
    entered_value: 230,
    entered_unit: "kg",
    normalized_kg: 230,
    actual_reps: 1,
    actual_rpe: "8",
    actual_rir: null,
    mean_concentric_velocity_mps: 0.31,
    velocity_excluded: false,
    velocity_quality: "measured",
    load_type: "external",
    is_bodyweight: false,
  },
  row: {
    rpe: "7-8",
    rir: null,
    reps_text: "1",
    sets: 1,
    purpose_label: "Top set",
    exercise_name_override: null,
  },
  exercise: {
    name: "Competition Squat",
    is_competition_lift: true,
    competition_lift_type: "squat",
    movement_family: "squat",
    equipment: "barbell",
  },
  ...over,
});

describe("footage", () => {
  it("says what was on the bar in both units, effort logged against planned, and measured speed", () => {
    const i = footageItem(src());
    expect(i.lift).toBe("squat");
    expect(i.weight).toEqual({ value: 230, unit: "kg", kg: 230, lb: 507.1 });
    expect(i.loggedEffort).toBe("RPE 8");
    expect(i.prescribedEffort).toBe("RPE 7-8");
    expect(i.velocity).toEqual({ mps: 0.31, quality: "measured" });
    expect(footageLine(i, "kg")).toBe("230 kg × 1 @ RPE 8");
    expect(footageLine(i, "lb")).toBe("507.1 lb × 1 @ RPE 8");
  });

  it("never shows a speed the athlete excluded, a load on an assisted set, or a plan on a warm-up", () => {
    const base = src();
    const i = footageItem({
      ...base,
      warmup: true,
      set_index: 0,
      result: { ...base.result!, velocity_excluded: true, load_type: "assisted" },
    });
    expect(i.velocity).toBeNull();
    expect(i.weight).toBeNull();
    expect(i.setName).toBe("Warm-up");
    expect(i.prescribedEffort).toBeNull();
  });

  it("reads a lb set from its typed number and a barbell variation as a variation", () => {
    const base = src();
    const i = footageItem({
      ...base,
      exercise_name: "Pause Squat",
      result: { ...base.result!, entered_value: 405, entered_unit: "lb", normalized_kg: 183.7 },
      exercise: {
        name: "Pause Squat",
        is_competition_lift: false,
        competition_lift_type: null,
        movement_family: "squat",
        equipment: "barbell",
      },
    });
    expect(i.lift).toBeNull();
    expect(i.variation).toBe(true);
    expect(i.weight?.unit).toBe("lb");
    expect(i.weight?.value).toBe(405);
  });

  it("leads with the competition lifts, filters to what exists, and compares like with like", () => {
    const squat = footageItem(src({ id: "a", created_at: "2026-11-20T18:00:00Z" }));
    const curl = footageItem(
      src({
        id: "b",
        created_at: "2026-11-20T17:00:00Z",
        exercise_name: "Curl",
        exercise: {
          name: "Curl",
          is_competition_lift: false,
          competition_lift_type: null,
          movement_family: "arms",
          equipment: "dumbbell",
        },
      }),
    );
    const older = footageItem(
      src({ id: "c", day_date: "2026-11-13", created_at: "2026-11-13T18:00:00Z" }),
    );
    const sorted = sortFootage([curl, older, squat]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(defaultFilter(sorted)).toBe("competition");
    const watched = new Set(["a"]);
    expect(availableFilters(sorted, watched)).toEqual(["competition", "squat", "unwatched", "all"]);
    expect(matchesFilter(curl, "competition", watched)).toBe(false);
    expect(compareCandidates(sorted, squat).map((x) => x.id)).toEqual(["c"]);
  });
});

const row = (over: Partial<TrainingRowSrc>): TrainingRowSrc => ({
  id: "r",
  day_id: "d1",
  sort_order: 0,
  exercise_name_override: null,
  sets: 3,
  reps_text: "3",
  rpe: "8",
  rir: null,
  percentage: null,
  percentage_basis: null,
  load_kg: null,
  load_lb: null,
  load_unit: null,
  measurement_type: "reps",
  duration_seconds: null,
  purpose_label: null,
  movement_family: null,
  exercises: {
    name: "Competition Bench",
    is_competition_lift: true,
    competition_lift_type: "bench",
    movement_family: "bench",
    equipment: "barbell",
  },
  ...over,
});

describe("training", () => {
  it("sorts each exercise by what it is", () => {
    expect(rowKind(row({})).kind).toBe("competition");
    expect(rowKind(row({ purpose_label: "Backoff" })).kind).toBe("backoff");
    expect(
      rowKind(
        row({
          exercises: {
            name: "Larsen Press",
            is_competition_lift: false,
            competition_lift_type: null,
            movement_family: "bench",
            equipment: "barbell",
          },
        }),
      ).kind,
    ).toBe("variation");
    expect(
      rowKind(
        row({
          purpose_label: "Secondary",
          exercises: {
            name: "Pull Up",
            is_competition_lift: false,
            competition_lift_type: null,
            movement_family: "pull",
            equipment: null,
          },
        }),
      ).kind,
    ).toBe("secondary");
    expect(
      rowKind(
        row({
          purpose_label: "Assistance",
          exercises: {
            name: "Cable Fly",
            is_competition_lift: false,
            competition_lift_type: null,
            movement_family: "chest",
            equipment: "cable",
          },
        }),
      ).kind,
    ).toBe("accessory");
  });

  it("opens on the block running today, folds accessories, and says each day's status", () => {
    const blocks = [
      {
        id: "old",
        name: "Volume",
        start_date: "2026-09-01",
        end_date: "2026-10-31",
        sort_order: 0,
      },
      {
        id: "now",
        name: "Strength",
        start_date: "2026-11-01",
        end_date: "2026-12-05",
        sort_order: 1,
      },
    ];
    expect(currentBlockId(blocks, "2026-11-26")).toBe("now");
    const v = buildTrainingView({
      blocks,
      weeks: [
        {
          id: "w1",
          block_id: "now",
          week_index: 3,
          start_date: "2026-11-23",
          end_date: "2026-11-29",
          phase: "Build",
        },
      ],
      days: [
        {
          id: "d1",
          week_id: "w1",
          day_index: 0,
          title: "Day 1",
          subtitle: "Squat & Bench",
          scheduled_date: "2026-11-23",
          is_optional: false,
        },
        {
          id: "d2",
          week_id: "w1",
          day_index: 1,
          title: "Day 2",
          subtitle: null,
          scheduled_date: "2026-11-25",
          is_optional: false,
        },
        {
          id: "d3",
          week_id: "w1",
          day_index: 2,
          title: "Day 3",
          subtitle: null,
          scheduled_date: "2026-11-24",
          is_optional: true,
        },
        {
          id: "d4",
          week_id: "w1",
          day_index: 3,
          title: "Day 4",
          subtitle: null,
          scheduled_date: "2026-11-27",
          is_optional: false,
        },
      ],
      rows: [
        row({ id: "r1", day_id: "d1" }),
        row({
          id: "r2",
          day_id: "d1",
          sort_order: 1,
          purpose_label: "Assistance",
          exercises: {
            name: "Cable Fly",
            is_competition_lift: false,
            competition_lift_type: null,
            movement_family: "chest",
            equipment: "cable",
          },
        }),
      ],
      results: [
        {
          row_id: "r1",
          set_index: 1,
          actual_reps: 3,
          entered_value: 150,
          entered_unit: "kg",
          actual_rpe: "8",
          completed_at: "2026-11-23T18:00:00Z",
        },
      ],
      doneDayIds: new Set(["d1"]),
      movedDates: new Map([["d4", "2026-11-28"]]),
      today: "2026-11-26",
    });
    expect(v.block?.id).toBe("now");
    const days = v.weeks[0].days;
    expect(days.map((d) => d.status)).toEqual(["done", "missed", "skipped", "upcoming"]);
    expect(days[0].title).toBe("Squat & Bench");
    expect(days[0].main.map((r) => r.name)).toEqual(["Competition Bench"]);
    expect(days[0].accessories.map((r) => r.name)).toEqual(["Cable Fly"]);
    expect(days[0].main[0].prescription).toBe("3 × 3 · RPE 8");
    expect(days[0].main[0].logged).toEqual(["Set 1: 150 kg × 3 · RPE 8"]);
    expect(days[3].date).toBe("2026-11-28");
    expect(v.upcoming.map((u) => u.dayId)).toEqual(["d4"]);
    expect(v.recent.map((u) => u.dayId)).toEqual(["d1"]);
    // nothing private has anywhere to go
    expect(JSON.stringify(v)).not.toMatch(/notes/i);
  });
});

describe("performance", () => {
  const set = (
    date: string,
    lift: "squat" | "bench" | "deadlift",
    lb: number,
    reps: number,
    rpe: string | null,
    v: number | null = null,
  ) => ({
    date: `${date}T18:00:00Z`,
    load: lb,
    reps,
    rpe,
    rir: null,
    velocity_mps: v,
    counts_load: true,
    is_competition_lift: true,
    competition_lift_type: lift,
    est_1rm: lb * (1 + reps / 30),
  });

  it("gives an estimated total only when all three lifts are current, and never makes one up", () => {
    const today = "2026-11-26";
    const results = [
      set("2026-11-20", "squat", 500, 1, "8"),
      set("2026-11-21", "bench", 320, 1, "8"),
      set("2026-11-22", "deadlift", 580, 1, "8"),
    ];
    const p = buildPerformanceView({ results, meetRows: [], upcoming: null, today });
    expect(p.lifts.squat.now).not.toBeNull();
    expect(p.estimatedTotal).not.toBeNull();
    const two = buildPerformanceView({
      results: results.slice(0, 2),
      meetRows: [],
      upcoming: null,
      today,
    });
    expect(two.lifts.deadlift.now).toBeNull();
    expect(two.estimatedTotal).toBeNull();
  });

  it("lists heavy singles, RPE points and measured speed; a meet's misses are misses", () => {
    const today = "2026-11-26";
    const p = buildPerformanceView({
      results: [
        set("2026-11-20", "squat", 500, 1, "9", 0.25),
        set("2026-11-20", "squat", 450, 3, "8", 0.4),
        set("2026-11-20", "squat", 300, 8, "6"),
      ],
      meetRows: [
        {
          meet_date: "2026-09-18",
          meet_name: "Commonwealth",
          federation: "CPF",
          place: "1",
          weight_class_kg: "66",
          squat_kg: "235",
          bench_kg: "150",
          deadlift_kg: "270",
          total_kg: "655",
          attempts: { s: [227.5, 232.5, 235], b: [145, 147.5, 150], d: [247.5, 270, -280] },
        },
      ],
      upcoming: {
        name: "Nationals",
        date: "2027-02-08",
        federation: "CPU",
        weightClass: "66",
        location: null,
      },
      today,
    });
    expect(p.heavySingles).toEqual([
      { day: "2026-11-20", lift: "squat", lb: 500, rpe: "9", mps: 0.25 },
    ]);
    expect(p.rpePoints.squat.map((x) => x.reps)).toEqual([1, 3]); // the 8-rep set isn't a heavy read
    expect(p.velocity.squat).toHaveLength(2);
    expect(p.loadVelocity.squat).toBeNull(); // two sets are no line
    expect(p.meets[0].attempts?.deadlift).toEqual([
      { kg: 247.5, made: true },
      { kg: 270, made: true },
      { kg: 280, made: false },
    ]);
    expect(p.upcoming?.daysOut).toBe(74);
  });

  it("fits load against speed only when it's worth drawing", () => {
    const pts = [200, 225, 250, 275, 300].map((lb, i) => ({ lb, mps: 0.8 - i * 0.1 }));
    const fit = loadVelocityFit(pts);
    expect(fit?.n).toBe(5);
    expect(fit!.slope).toBeLessThan(0);
    expect(loadVelocityFit(pts.map((p) => ({ ...p, lb: 250 })))).toBeNull(); // one weight
    expect(loadVelocityFit(pts.map((p, i) => ({ ...p, mps: 0.4 + i * 0.1 })))).toBeNull(); // faster when heavier: noise
  });
});

describe("routing and sign-in", () => {
  it("lands a specialist on their own area, never Crew or admin, with two-step required", () => {
    expect(crewHome("specialist")).toBe(SPECIALIST_HOME);
    expect(roleRequiresMfa("specialist")).toBe(true);
  });

  it("keeps a specialist's notes out of Cleo", () => {
    expect(CLEO_HIDDEN_TABLES.has("specialist_notes")).toBe(true);
  });
});

describe("invite tokens", () => {
  it("stores only a hash, and an email proof can't be forged or moved to another invite", async () => {
    process.env.SETUP_INVITE_SECRET = "test-secret-for-invites";
    const m = await import("@/lib/staff-invites.server");
    const token = m.genSetupToken();
    expect(m.hashSetupToken(token)).not.toContain(token);
    expect(m.hashSetupToken(token)).toBe(m.hashSetupToken(token));
    const proof = m.inviteEmailProof(A, "Jesse@Example.com");
    expect(m.inviteProofOk(A, "jesse@example.com", proof)).toBe(true);
    expect(m.inviteProofOk(B, "jesse@example.com", proof)).toBe(false);
    expect(m.inviteProofOk(A, "someone@example.com", proof)).toBe(false);
    expect(
      m.inviteProofOk(
        A,
        "jesse@example.com",
        proof.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
      ),
    ).toBe(false);
    expect(m.inviteProofOk(A, "jesse@example.com", undefined)).toBe(false);
    expect(m.maskInviteEmail("jesse@example.com")).toBe("j****@example.com");
  });
});

describe("guarantees in the code", () => {
  const code = readFileSync("src/lib/team-access/specialist.functions.ts", "utf8");

  it("every athlete read checks access with the caller's own login first", () => {
    for (const fn of [
      "getSpecialistFootage",
      "getSpecialistTraining",
      "getSpecialistPerformance",
      "markFootageWatched",
      "getSpecialistVideo",
      "saveMyNote",
    ]) {
      const start = code.indexOf(`export const ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      const next = code.indexOf("export const ", start + 10);
      const body = code.slice(start, next === -1 ? undefined : next);
      expect(body, fn).toMatch(/assertSpecialistCan\(/);
    }
  });

  it("never selects a coach's or a program's notes", () => {
    const selects = [...code.matchAll(/\.select\(\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const s of selects) {
      if (s.includes("target_kind")) continue; // the specialist's own notes table
      expect(s, s).not.toMatch(/\bnotes\b|coach_notes|client_notes|block_meta|\bgoal\b/);
    }
  });

  it("no policy lets an admin, coach or staff role read a specialist's notes", () => {
    const sql = readFileSync("supabase/migrations/20270603090100_team_specialists.sql", "utf8");
    const policies = [
      ...sql.matchAll(/CREATE POLICY "[^"]+" ON public\.specialist_notes[\s\S]*?;/g),
    ].map((m) => m[0]);
    expect(policies.length).toBe(1);
    expect(policies[0]).toMatch(/author_user_id = \(SELECT auth\.uid\(\)\)/);
    expect(policies.join(" ")).not.toMatch(/has_role|admin|coach/);
  });
});
