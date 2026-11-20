import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardioSessionTitle, cardioSpecParts, resolveCardioActivity } from "@/lib/cardio-activity";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/workouts/WorkoutsExperience.tsx");
const card = read("src/components/cardio/CardioCompletionCard.tsx");
const section = read("src/components/cardio/ClientCardioSection.tsx");

// Nov 20 2026: the coach found Workouts read like a dashboard: a rest day said
// "Rest day" over a 25-minute treadmill walk that sat three cards lower under a
// heart and "Today's plan: Non-Training Day", the program card opened on a
// four-line paragraph, and readiness and analytics were two more cards.
describe("the day's cardio is part of the day", () => {
  it("names the session in plain words", () => {
    expect(cardioSessionTitle(resolveCardioActivity({ cardio_type: "Incline Treadmill Walk" }))).toBe("Treadmill walk");
    expect(cardioSessionTitle(resolveCardioActivity({ cardio_type: "Outdoor Walking" }))).toBe("Outdoor walk");
    expect(cardioSessionTitle(resolveCardioActivity({ cardio_type: "Bike" }))).toBe("Bike");
  });

  it("says what to do in one line, the zone once", () => {
    const view = resolveCardioActivity({ cardio_type: "Incline Treadmill Walk" });
    const t = { duration_minutes: 25, incline: 5, speed_min_mph: 2, speed_max_mph: 3, intensity: "Zone 2", heart_rate_zone: "Zone 2" };
    expect(cardioSpecParts(t, view)).toEqual(["25 min", "5% incline", "2–3 mph (3.2–4.8 km/h)", "Zone 2"]);
    // the longer of two that say the same thing
    expect(cardioSpecParts({ ...t, intensity: "Zone 2 (easy)" }, view).at(-1)).toBe("Zone 2 (easy)");
    // two different things are both said
    expect(cardioSpecParts({ ...t, intensity: "Easy" }, view).slice(-2)).toEqual(["Easy", "Zone 2"]);
    // a bike has no incline or speed
    expect(cardioSpecParts({ duration_minutes: 20, incline: 5, intensity: null, heart_rate_zone: null }, resolveCardioActivity({ cardio_type: "Bike" }))).toEqual(["20 min"]);
  });

  it("the day card holds it: a day off leads with it, a workout without the plan's row carries it inside", () => {
    expect(page).toContain('const dayCardio = useDayCardio(mode === "self" ? clientId : "", date);');
    expect(page).toContain('layout="day" dayLabel={dayText}');
    expect(page).toContain('{!item.cardio && cardio && (');
    expect(page).toContain('layout="row"');
    // a day off waits for its cardio, so "Rest day" never flips to a cardio day
    expect(page).toContain("dayCardio.isLoading ? (");
    // never a section of its own under the program
    expect(page).not.toContain("<ClientCardioSection");
    expect(page).not.toContain("Today's plan");
    // the workout's own cardio line is a pulse, never a heart
    expect(page).not.toContain("<Heart ");
  });

  it("one read a week, so stepping through the strip never asks again", () => {
    expect(section).toContain('queryKey: ["client-cardio-resolved", clientId, weekStart, workoutDayId ?? null]');
    expect(section).not.toContain("Today's plan");
    expect(section).not.toContain("Heart");
  });

  it("the card is quiet: no caps, no struck-through name, the zone once, red only on a cardio day", () => {
    expect(card).not.toMatch(/uppercase|tracking-widest|line-through/);
    expect(card).not.toContain("emerald");
    expect(card).toContain('variant={layout === "day" ? "default" : "secondary"}');
    // Skip is in a ⋯, Done as planned and Add numbers wrap to full rows on a narrow phone
    expect(card).toContain("Skip today");
    expect(card).toContain('<div className="mt-3 flex flex-wrap items-center gap-2">');
    // the finish rule only when it says more than the time
    expect(card).toContain("finishParts.length > 1");
  });
});

describe("the program card is a glance; how it's going is one quiet card", () => {
  it("the week's explanation and the roadmap fold under one row", () => {
    const roadmap = read("src/components/workouts/program-roadmap.tsx");
    expect(roadmap).toContain("data-roadmap-week");
    expect(roadmap).toContain("data-roadmap-focus");
    expect(roadmap.indexOf("data-roadmap-focus")).toBeGreaterThan(roadmap.indexOf("data-roadmap-toggle"));
  });

  it("readiness and the month share one card, each with no card of its own", () => {
    expect(page).toContain("data-progress-card");
    expect(page).toMatch(/<RecoveryPreviewCard[\s\S]{0,200}bare/);
    expect(page).toContain("<TrainingAnalyticsPreviewCard clientId={clientId} hideWhenEmpty bare />");
    // an empty card never shows when neither has anything
    expect(page).toContain("[&:not(:has(section))]:hidden");
  });

  it("the trend bars are neutral ink, never the chart's blue", () => {
    const month = read("src/components/training-analytics-preview-card.tsx");
    expect(month).not.toContain("--chart-4");
  });
});
