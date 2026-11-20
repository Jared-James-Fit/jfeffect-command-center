import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Workouts reads the day first (Nov 20 2026): the day picked is the page's card,
// a cardio-only day leads with its cardio, the program is one glance with the
// detail folded, and readiness and the month are one quiet card under it.
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/workouts/WorkoutsExperience.tsx");
const cardioCard = read("src/components/cardio/CardioCompletionCard.tsx");
const cardioSection = read("src/components/cardio/ClientCardioSection.tsx");

describe("the day is the page's card", () => {
  it("a day off with cardio leads with the cardio, its Done the red button; a plain rest day is one compact card", () => {
    expect(page).toContain("const cardio = useDayCardio(clientId, date);");
    expect(page).toContain("const dayCardio = cardio.target && !cardio.inWorkout ? cardio.target : null;");
    // a day off: the cardio card is primary and carries the next workout under it
    expect(page).toMatch(/dayOff && \(dayCardio \? \([\s\S]{0,400}emphasis="primary"[\s\S]{0,120}footer=\{nextRow\}/);
    // loading never flashes "Rest day" before the cardio arrives
    expect(page).toContain(": cardio.isLoading ? (\n        <WorkoutCardSkeleton />");
    expect(page).toContain("<RestDayCard dayText={dayText} next={next} nextRow={nextRow} />");
    // a training day whose workout doesn't hold the plan's cardio: under it, secondary
    expect(page).toMatch(/!dayOff && dayCardio && \([\s\S]{0,300}emphasis="secondary"/);
    // never a cardio section at the bottom of the page again
    expect(page).not.toContain("<ClientCardioSection");
    // no big sun icon circle on a rest day
    expect(page).not.toContain("<Sun ");
  });

  it("the workout card says its status once, in words in the day line: no badge, no ring", () => {
    expect(page).not.toContain("WorkoutProgressRing");
    expect(page).not.toContain('<Badge variant="outline" className={cn("text-[11px]", visibleStatus.tone)}');
    expect(page).toContain("data-day-status={visibleStatus.status}");
    expect(page).toContain("function dayStatusTone(status: WorkoutStatus)");
    // in progress: the sets in words and one thin neutral bar
    expect(page).toContain("`${badgeLabel} · ${progress.completedSets} of ${progress.prescribedSets} sets`");
    expect(page).toContain("data-day-progress");
    expect(page).toContain('className="h-full rounded-full bg-foreground/70"');
    // done is green, missed red, the review amber; never an amber "In Progress"
    expect(page).toContain('tone === "done" && "text-success"');
    expect(page).toContain('tone === "missed" && "text-destructive"');
    // how long, only while it's still to do
    expect(page).toContain('return est != null && tone === "quiet" ? (');
    // the cardio row is a pulse line, never a heart (a heart reads as a favourite)
    expect(page).not.toMatch(/<Heart\b/);
  });

  it("the calendar picks the day without a card of its own", () => {
    expect(page).toMatch(/<WeekStrip[\s\S]{0,400}\n\s+flat\n/);
    expect(page).toContain("<div data-month-grid>");
    expect(read("src/components/workouts/week-strip.tsx")).toContain('const Wrap = flat ? "div" : Card;');
  });

  it("readiness and the month are one quiet card, gone until there's something in it", () => {
    expect(page).toContain('<Card className="divide-y divide-border overflow-hidden p-0 empty:hidden" data-workouts-progress>');
    expect(page).toMatch(/<RecoveryPreviewCard[\s\S]{0,160}bare/);
    expect(read("src/components/analytics/recovery-preview-card.tsx")).toContain('const Wrap = bare ? "div" : Card;');
  });
});

describe("the cardio card", () => {
  it("says the session in plain lines: no caps labels, no nested box, no tinted card", () => {
    expect(cardioCard).not.toMatch(/uppercase/);
    expect(cardioCard).not.toContain("bg-emerald-500/5");
    expect(cardioCard).not.toContain("bg-amber-500/5");
    expect(cardioCard).not.toContain("rounded-md border border-border bg-secondary/30");
    expect(cardioCard).toContain("data-cardio-prescription");
    expect(cardioCard).toContain("`${inclineLabel} incline`");
  });

  it("keeps every way to log it: Done as planned, Log details (every number), Skip, Edit and Undo", () => {
    for (const fn of ["const toggleComplete = () => run(", "const markSkipped = () => run(", "const saveDetails = () => run("]) {
      expect(cardioCard).toContain(fn);
    }
    expect(cardioCard).toContain("data-cardio-done-planned");
    expect(cardioCard).toContain("data-cardio-log-details");
    expect(cardioCard).toContain("data-cardio-skip");
    for (const field of ["actualDuration", "calories", "avgHr", "distance", "steps", "rpe", "avgSpeed", "incline", "notes"]) {
      expect(cardioCard).toContain(`set${field[0].toUpperCase()}${field.slice(1)}(`);
    }
    // the day's main thing gets the red button; beside a workout it's secondary
    expect(cardioCard).toContain('variant={isPrimary ? "default" : "secondary"}');
    // a pulse line, never a heart
    expect(cardioCard).toContain("<Activity ");
    expect(cardioCard).not.toContain("Heart");
  });

  it("one read answers the whole week, so tapping between days never waits on it", () => {
    expect(cardioSection).toContain("export function useDayCardio(");
    expect(cardioSection).toContain('if (qc.getQueryData(key) === undefined) qc.setQueryData(key, valueFor(iso));');
    expect(cardioSection).toContain('queryKey: ["client-cardio-resolved", clientId, dateStr],');
    expect(cardioSection).not.toContain("Heart");
  });
});

describe("the program card is one glance", () => {
  const card = read("src/components/workouts/program-roadmap.tsx");
  it("shows the block and this week's focus; what the week is for and the roadmap fold under Plan details", () => {
    expect(card).toContain("data-roadmap-week");
    expect(card).toContain("{showAll && line && (");
    expect(card).toContain("data-roadmap-week-detail");
    expect(card).toContain("<span>Plan details</span>");
  });
});
