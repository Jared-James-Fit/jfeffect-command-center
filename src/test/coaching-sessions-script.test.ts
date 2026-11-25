import { describe, expect, it } from "vitest";
import { buildPresenterScript, slideText } from "@/lib/coaching-sessions/script";
import type { Agenda } from "@/lib/coaching-sessions/prepare";

const agenda: Agenda = {
  minutes: 20,
  athleteShare: 0.3,
  sections: [
    { key: "going_well", title: "What's going well", minutes: 3, items: [] },
    { key: "improve", title: "Where we can improve", minutes: 4, items: [
      { text: "10 of 16 planned workouts missed in the last 4 weeks", source: "record" },
      { text: "Meet in 1 week: not enough weigh-ins", source: "read" },
    ] },
    { key: "athletes_corner", title: "Your corner", minutes: 6, items: [] },
    { key: "game_plan", title: "Our game plan", minutes: 5, items: [{ text: "Total Fortification: 10 days out (Dec 5), final preparation", source: "record" }] },
    { key: "alignment", title: "Alignment and next steps", minutes: 2, items: [] },
  ],
};

describe("presenter script", () => {
  const slides = buildPresenterScript({ agenda, firstName: "Shaina", eventTitle: "Total Fortification", daysOut: 10, phase: "Final preparation" });
  it("has one slide per shared-screen slide, in the same order", () => {
    expect(slides.map((s) => s.key)).toEqual(["title", "going_well", "improve", "athletes_corner", "game_plan", "alignment"]);
  });
  it("never claims wins that aren't on file", () => {
    const wins = slides[1].say.join(" ");
    expect(wins).not.toMatch(/nice work/);
  });
  it("uses only the prep's own lines and tells the coach when to stop talking", () => {
    expect(slides[2].say.join(" ")).toContain("10 of 16 planned workouts missed");
    for (const s of slides) expect(s.pause).toBeTruthy();
    expect(slideText(slides[3])).toContain("Ask:");
  });
  it("keeps the agenda's timing", () => {
    expect(slides.slice(1).map((s) => s.minutes)).toEqual([3, 4, 6, 5, 2]);
  });
});
