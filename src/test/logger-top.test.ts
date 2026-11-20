import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DayCoachNotes, loggerMeta, loggerTitle, scheduledDayWords } from "@/components/workout-day/logger-top";
import { clockRange } from "@/components/workout-day/SessionTimeRow";
import { warmupHasContent } from "@/components/warmup-sheet";

const read = (p: string) => readFileSync(p, "utf8");

describe("the logger's header says which workout and where it sits, once each", () => {
  it("is titled by the workout's name, the one they tapped on Workouts; 'Day 1' only when it has none", () => {
    expect(loggerTitle({ day_index: 1, title: "Full Body B" })).toBe("Full Body B");
    expect(loggerTitle({ day_index: 2, title: "Lower A (Squat Focus)", subtitle: "Lower A" })).toBe("Lower A");
    expect(loggerTitle({ day_index: 3, title: "Day 3" })).toBe("Day 3");
    expect(loggerTitle({ day_index: 4, title: null })).toBe("Day 4");
  });
  it("puts the day, the block by its own name and the week on one line, never the day twice", () => {
    expect(loggerMeta({ day_index: 1, title: "Full Body B" }, { name: "Block 2 — General Strength" }, { week_index: 3 })).toBe("Day 1 · General Strength · Week 3");
    expect(loggerMeta({ day_index: 3, title: "Day 3" }, { name: "Off-season Hypertrophy" }, { week_index: 1 })).toBe("Off-season Hypertrophy · Week 1");
    expect(loggerMeta({ day_index: 1, title: "Push" }, null, null)).toBe("Day 1");
  });
  it("says a planned day in words: tomorrow, yesterday, else the date (with its year when it isn't this one)", () => {
    const today = new Date(2026, 10, 18);
    expect(scheduledDayWords(new Date(2026, 10, 19), today)).toBe("tomorrow");
    expect(scheduledDayWords(new Date(2026, 10, 17), today)).toBe("yesterday");
    expect(scheduledDayWords(new Date(2026, 10, 23), today)).toBe("Mon, Nov 23");
    expect(scheduledDayWords(new Date(2027, 0, 4), today)).toBe("Mon, Jan 4, 2027");
  });
});

describe("coach notes are a compact block that opens in place", () => {
  it("shows nothing for notes the coach kept private", () => {
    expect(renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: "Private", notes_client_visible: false } }))).toBe("");
  });
  it("keeps the first paragraph on screen (three lines), the rest a tap away, with no caps label or red link", () => {
    const html = renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: "Station order first.\n\nHow to progress: add 5 lb.", notes_client_visible: true } }));
    expect(html).toContain("Coach notes");
    expect(html).toContain("Station order first.");
    expect(html).toContain("line-clamp-3");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("More");
    expect(html).not.toContain("How to progress"); // until it's opened
    expect(html).not.toContain("uppercase");
    expect(html).not.toContain("text-primary");
  });
});

describe("the finished workout's card", () => {
  it("says when it ran on the status line: one AM / PM for a range inside one half of the day", () => {
    expect(clockRange("6:40 PM", "7:55 PM")).toBe("6:40–7:55 PM");
    expect(clockRange("11:40 AM", "12:55 PM")).toBe("11:40 AM – 12:55 PM");
  });
  it("puts the session time beside Completed and the review and score side by side", () => {
    const card = read("src/components/workout/shared/completed-workout-actions.tsx");
    expect(card).toContain("{status ? status(label) : <div className=\"flex min-h-10 items-center\">{label}</div>}");
    expect(card).toContain('hasReview && onOpenScore ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"');
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain("inCard lead={label} />");
  });
});

describe("one row of logging controls", () => {
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  const controls = day.slice(day.indexOf("data-logger-controls"), day.indexOf("<DayCoachNotes day={day}"));
  it("Warm-up only when there's one to open, Log faster as a help button, then List / Focus", () => {
    expect(controls).toContain("hideWhenEmpty");
    expect(controls).toContain('data-testid="quick-log-tips-open"');
    expect(controls).toContain("<HelpCircle ");
    expect(controls).toContain("<WorkoutViewToggle ");
    expect(controls).not.toContain("flex-wrap");
  });
  it("a warm-up with no movements counts as none, so the button never opens an empty screen", () => {
    expect(warmupHasContent(null)).toBe(false);
    expect(warmupHasContent({ sections: [] })).toBe(false);
    expect(warmupHasContent({ sections: [{ items: [] }] })).toBe(false);
    expect(warmupHasContent({ sections: [{ items: [{ name: "Easy bike" }] }] })).toBe(true);
    const sheet = read("src/components/warmup-sheet.tsx");
    expect(sheet).toContain("if (hideWhenEmpty && !warmupHasContent(probe.data?.protocol)) return null;");
    expect(sheet).toContain("No warm-up for this workout");
  });
  it("the scheduled-day notice is one quiet line in the header, never an amber card", () => {
    expect(day).toContain("<ScheduledDayLine scheduled={scheduledDate} today={today} />");
    expect(day).not.toContain("This workout is scheduled for");
  });
});
