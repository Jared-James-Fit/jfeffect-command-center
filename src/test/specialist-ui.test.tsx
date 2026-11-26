/**
 * A specialist's screens, rendered with the server's answers seeded: what
 * Footage, Training and Performance actually show, a category that isn't
 * shared, and the note composer starting private.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => {
    const chain: any = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: () => chain,
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { SpecialistProvider } = await import("@/components/specialist/specialist-context");
const { FootageTab } = await import("@/components/specialist/footage-tab");
const { TrainingTab } = await import("@/components/specialist/training-tab");
const { PerformanceTab } = await import("@/components/specialist/performance-tab");
const { SpecialistNotes } = await import("@/components/specialist/specialist-notes");
const { footageItem } = await import("@/lib/team-access/footage");
const { buildTrainingView } = await import("@/lib/team-access/training");
const { buildPerformanceView } = await import("@/lib/team-access/performance");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const me = {
  userId: "u1",
  preset: "game_day_coach" as const,
  title: "Game Day Coach",
  displayName: "Jesse",
  phone: "+12045550123",
  timeZone: "America/Winnipeg",
  headshotUrl: null,
  status: "active" as const,
  needs: [],
};

function render(
  node: ReactNode,
  opts: {
    seed?: Array<[unknown[], unknown]>;
    flags?: Partial<Record<"footage" | "training" | "performance", boolean>>;
  } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const [key, data] of opts.seed ?? []) qc.setQueryData(key, data);
  const athlete = {
    clientId: CLIENT,
    name: "Jared McIntyre",
    firstName: "Jared",
    footage: true,
    training: true,
    performance: true,
    ...opts.flags,
  };
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(
        SpecialistProvider,
        { data: { me, athletes: [athlete] }, refresh: async () => undefined },
        node,
      ),
    ),
  );
}

const squat = footageItem({
  id: "v1",
  created_at: "2026-11-20T18:00:00Z",
  set_index: 1,
  warmup: false,
  set_name: "Top set",
  exercise_name: "Competition Squat",
  workout_title: "Monday",
  duration_s: 20,
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
    rpe: "7",
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
});

describe("Footage", () => {
  it("shows the clip with what was lifted, the planned effort and measured speed, competition lifts first", () => {
    const html = render(createElement(FootageTab), {
      seed: [[["specialist-footage", CLIENT], { items: [squat], thumbs: {}, watched: [] }]],
    });
    expect(html).toContain("Competition lifts");
    expect(html).toContain("Competition Squat");
    expect(html).toContain("Top set");
    expect(html).toContain("230 kg × 1 @ RPE 8");
    expect(html).toContain("Planned RPE 7");
    expect(html).toContain("0.31 m/s measured");
    expect(html).toContain('aria-label="Not watched"');
  });

  it("says so when footage isn't shared, and asks nothing of the server", () => {
    const html = render(createElement(FootageTab), { flags: { footage: false } });
    expect(html).toContain("Footage isn&#x27;t shared");
  });
});

describe("Training", () => {
  it("shows this week open, main lifts with planned and logged, accessories folded", () => {
    const view = buildTrainingView({
      blocks: [
        {
          id: "b",
          name: "Strength",
          start_date: "2026-11-01",
          end_date: "2026-12-05",
          sort_order: 0,
        },
      ],
      weeks: [
        {
          id: "w",
          block_id: "b",
          week_index: 0,
          start_date: "2026-11-23",
          end_date: "2026-11-29",
          phase: null,
        },
      ],
      days: [
        {
          id: "d",
          week_id: "w",
          day_index: 0,
          title: "Day 1",
          subtitle: "Squat & Bench",
          scheduled_date: "2026-11-23",
          is_optional: false,
        },
      ],
      rows: [
        {
          id: "r1",
          day_id: "d",
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
        },
        {
          id: "r2",
          day_id: "d",
          sort_order: 1,
          exercise_name_override: null,
          sets: 3,
          reps_text: "12",
          rpe: null,
          rir: "2",
          percentage: null,
          percentage_basis: null,
          load_kg: null,
          load_lb: null,
          load_unit: null,
          measurement_type: "reps",
          duration_seconds: null,
          purpose_label: "Assistance",
          movement_family: null,
          exercises: {
            name: "Cable Fly",
            is_competition_lift: false,
            competition_lift_type: null,
            movement_family: "chest",
            equipment: "cable",
          },
        },
      ],
      results: [],
      doneDayIds: new Set(),
      today: "2026-11-24",
    });
    const html = render(createElement(TrainingTab), {
      seed: [[["specialist-training", CLIENT, null], view]],
    });
    expect(html).toContain("Strength");
    expect(html).toContain("This week");
    expect(html).toContain("Squat &amp; Bench");
    expect(html).toContain("Competition Bench");
    expect(html).toContain("Planned: 3 × 3 · RPE 8");
    expect(html).toContain("Show 1 accessory");
    expect(html).not.toContain("Cable Fly"); // folded
  });
});

describe("Performance", () => {
  it("shows the next meet, the estimates as estimates, and a meet's misses struck through", () => {
    const set = (lift: "squat" | "bench" | "deadlift", lb: number) => ({
      date: "2026-11-20T18:00:00Z",
      load: lb,
      reps: 1,
      rpe: "8",
      rir: null,
      velocity_mps: null,
      counts_load: true,
      is_competition_lift: true,
      competition_lift_type: lift,
      est_1rm: lb,
    });
    const today = new Date().toISOString().slice(0, 10);
    const view = buildPerformanceView({
      results: [set("squat", 500), set("bench", 320), set("deadlift", 580)],
      meetRows: [
        {
          meet_date: "2026-09-18",
          meet_name: "Commonwealth Championships",
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
        date: "2099-02-08",
        federation: "CPU",
        weightClass: "66",
        location: null,
      },
      today,
    });
    const html = render(createElement(PerformanceTab), {
      seed: [[["specialist-performance", CLIENT], view]],
    });
    expect(html).toContain("Nationals");
    expect(html).toContain("days out");
    expect(html).toContain("Estimated max");
    expect(html).toContain("Commonwealth Championships");
    expect(html).toMatch(/line-through[^>]*>280</);
    expect(html).toContain("Meet numbers are what was lifted on the platform");
  });
});

describe("Notes", () => {
  it("start private, and say who a shared one goes to before saving", () => {
    const html = render(
      createElement(SpecialistNotes, {
        clientId: CLIENT,
        athleteFirstName: "Jared",
        targetKind: "set_video",
        targetId: "v1",
      }),
      { seed: [[["specialist-notes", CLIENT, "set_video", "v1"], []]] },
    );
    expect(html).toContain("Save private note");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Only you");
    expect(html).toContain("Share with Jared");
  });
});

describe("Team → Game day coaches and specialists", () => {
  it("shows Jesse's draft waiting for an email, with what he'd see", async () => {
    const { SpecialistsSection } = await import("@/components/team/specialists-section");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(["team-specialists"], {
      specialists: [],
      invites: [
        {
          id: "inv1",
          firstName: "Jesse",
          lastName: null,
          email: null,
          title: "Game Day Coach",
          preset: "game_day_coach",
          status: "draft",
          expiresAt: null,
          deliveryMethod: null,
          deliveredAt: null,
          access: [
            {
              clientId: CLIENT,
              athleteName: "Jared McIntyre",
              footage: true,
              training: true,
              performance: true,
            },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(SpecialistsSection)),
    );
    expect(html).toContain("Game day coaches and specialists");
    expect(html).toContain("Jesse");
    expect(html).toContain("Game Day Coach");
    expect(html).toContain("Draft: add their email to send it");
    expect(html).toContain("Jared McIntyre: footage, training, performance");
    // nothing to send until there's an email
    expect(html).not.toContain("Email the invite");
  });
});
