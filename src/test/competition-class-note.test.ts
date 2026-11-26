/**
 * Nov 25 2026: the coach asked for changes on a 74 kg rehearsal saying "I'm competing as a 66kg athlete" and
 * then "The game plan is 66kg. 74kg isn't an option". The engine plans at the meet's own class, so the new
 * version was still 74 kg with nothing saying why; the note's class now comes back as a serious concern.
 */
import { describe, expect, it } from "vitest";
import { classInWords, classNoteConcern } from "@/lib/competition/watch";

describe("the class a coach's note names", () => {
  it("reads explicit class wording", () => {
    expect(classInWords("I'm competing as a 66kg athlete and I need you to make my numbers/predictions aggressive.")).toBe("66");
    expect(classInWords("The game plan is 66kg. 74kg isn't an option")).toBe("66");
    expect(classInWords("Move him up to the 83 kg class")).toBe("83");
    expect(classInWords("stay in 84+ for this one")).toBe("84+");
    expect(classInWords("she's a 57 kg lifter")).toBe("57");
  });
  it("never reads an attempt, a bodyweight or a total as a class", () => {
    expect(classInWords("Open squat at 105 kg and bench at 62.5")).toBeNull();
    expect(classInWords("58.1 this morning, no water cut")).toBeNull();
    expect(classInWords("Aim for a 660 total")).toBeNull();
    expect(classInWords("Make the deadlift third 125 kg")).toBeNull();
    expect(classInWords(null)).toBeNull();
  });
  it("is a serious concern only when it differs from the meet's class", () => {
    const c = classNoteConcern("The game plan is 66kg. 74kg isn't an option", "74");
    expect(c?.severity).toBe("serious");
    expect(c?.text).toContain("this meet is entered at 74 kg");
    expect(c?.text).toContain("use 66 kg");
    expect(classNoteConcern("I'm competing as a 66kg athlete", "66")).toBeNull();
    expect(classNoteConcern("Open squat at 105 kg", "74")).toBeNull();
  });
});
