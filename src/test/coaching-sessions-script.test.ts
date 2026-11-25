import { describe, expect, it } from "vitest";
import { buildPresenterScript, slideText } from "@/lib/coaching-sessions/script";
import { athleteView } from "@/lib/coaching-sessions/presentation";
import { applyAgendaOp, normalizeAgenda, planAgenda, type SessionPrep } from "@/lib/coaching-sessions/prepare";

// a plan prepared before the coach-led flow (Nov 25 2026): it must still read
const legacy = {
  minutes: 20,
  athleteShare: 0.3,
  sections: [
    { key: "going_well", title: "What's going well", minutes: 3, items: [] },
    {
      key: "improve",
      title: "Where we can improve",
      minutes: 4,
      items: [
        { text: "10 of 16 planned workouts have no log in the last 4 weeks", source: "record" },
        { text: "Meet in 1 week: not enough weigh-ins", source: "read" },
      ],
    },
    { key: "athletes_corner", title: "Your corner", minutes: 6, items: [] },
    { key: "game_plan", title: "Our game plan", minutes: 5, items: [{ text: "Total Fortification: 10 days out (Dec 5), final preparation", source: "record" }] },
    { key: "alignment", title: "Alignment and next steps", minutes: 2, items: [] },
  ],
};

const prep = (over: Partial<SessionPrep> = {}): SessionPrep => ({
  objective: "Lock in the peak for Total Fortification",
  outcome: "They leave knowing the last two weeks and the openers",
  connect: [],
  goingWell: [{ text: "Squat up 7.5 kg in 6 weeks", source: "record", slot: "win-squat" }],
  observations: [{ text: "3 of 12 planned workouts have no log in the last 4 weeks", source: "record", slot: "unlogged" }],
  improve: [],
  recommendations: [{ text: "Hold the plan steady through the taper", source: "read", slot: "rec-stay" }],
  athleteNeeds: [],
  coachNeeds: [],
  clientActions: [{ text: "Log every session, even short ones", source: "read", slot: "action-log" }],
  coachActions: [],
  clarify: [{ text: "Were those 3 sessions done and not logged?", source: "read", slot: "clarify-unlogged", clarify: true }],
  missing: [],
  decisions: [],
  milestones: [],
  nextObjective: "Openers settled by Dec 1",
  carriedOver: [],
  ...over,
});

describe("presenter script", () => {
  it("still reads a plan prepared before the coach-led flow", () => {
    const slides = buildPresenterScript({ agenda: legacy, firstName: "Shaina", eventTitle: "Total Fortification", daysOut: 10, phase: "Final preparation" });
    expect(slides[0].key).toBe("title");
    const evaluate = slides.find((s) => s.key === "evaluate")!;
    expect(evaluate.say.join(" ")).toContain("10 of 16 planned workouts have no log");
    // a read that isn't shared is marked for the coach
    expect(evaluate.say.join(" ")).toContain("(For you)");
    for (const s of slides.slice(1)) expect(s.pause).toBeTruthy();
  });

  it("follows the coach-led flow, one slide per stage with something in it, in order", () => {
    const agenda = planAgenda(prep(), { minutes: 20, format: "call", firstName: "Shaina" });
    const slides = buildPresenterScript({ agenda, firstName: "Shaina" });
    const keys = slides.map((s) => s.key);
    expect(keys[0]).toBe("title");
    const order = ["connect", "recognize", "evaluate", "coach", "execute", "align"];
    const stages = keys.slice(1) as string[];
    expect(stages).toEqual(order.filter((k) => stages.includes(k)));
    expect(stages).toContain("recognize");
    expect(stages).toContain("coach");
    // the opening names the objective
    expect(slides[0].say.join(" ")).toContain("lock in the peak");
    // the timing adds up to the meeting
    expect(agenda.sections.reduce((a, s) => a + s.minutes, 0)).toBe(agenda.minutes);
  });

  it("the coach's edits win, skipped points drop out, and questions are only real ones", () => {
    let agenda = planAgenda(prep(), { minutes: 20, format: "call", firstName: "Shaina" });
    const win = agenda.sections.find((s) => s.key === "recognize")!.items[0]!;
    agenda = applyAgendaOp(agenda, { op: "edit", id: win.id, say: "Your squat is moving: 7.5 kg in six weeks." }, "2026-11-25T12:00:00Z");
    const rec = agenda.sections.find((s) => s.key === "coach")!.items[0]!;
    agenda = applyAgendaOp(agenda, { op: "status", id: rec.id, status: "skipped" }, "2026-11-25T12:00:00Z");
    const slides = buildPresenterScript({ agenda, firstName: "Shaina" });
    const all = slides.map(slideText).join("\n");
    expect(all).toContain("Your squat is moving: 7.5 kg in six weeks.");
    expect(all).not.toContain("Hold the plan steady");
    // the only questions are what's unclear (asked where it's evaluated) and the closing say-back
    const evaluate = slides.find((s) => s.key === "evaluate")!;
    expect(evaluate.ask).toContain("Were those 3 sessions done and not logged?");
    for (const s of slides.filter((x) => x.key !== "align")) for (const q of s.ask) expect(q.trim().endsWith("?")).toBe(true);
    // a greeting isn't marked as private, a read on the evaluate slide is
    expect(slides.find((s) => s.key === "connect")?.say.join(" ") ?? "").not.toContain("(For you)");
  });

  it("a settled clarification isn't asked", () => {
    let agenda = planAgenda(prep(), { minutes: 20, format: "call", firstName: "Shaina" });
    const c = agenda.clarify[0]!;
    agenda = applyAgendaOp(agenda, { op: "status", id: c.id, status: "addressed" }, "2026-11-25T12:00:00Z");
    const all = buildPresenterScript({ agenda, firstName: "Shaina" }).flatMap((s) => s.ask).join(" ");
    expect(all).not.toContain("Were those 3 sessions");
  });

  it("the shared screen and the script have the same slides, so they stay in sync", () => {
    const agenda = planAgenda(prep(), { minutes: 20, format: "call", firstName: "Shaina" });
    const shared = athleteView(agenda);
    const slides = buildPresenterScript({ agenda, firstName: "Shaina" });
    expect(slides.slice(1).map((s) => s.key)).toEqual(shared.map((s) => s.key));
    // nothing private reaches the shared screen
    expect(JSON.stringify(shared)).not.toContain("(For you)");
    expect(normalizeAgenda(agenda)?.version).toBe(2);
  });
});
