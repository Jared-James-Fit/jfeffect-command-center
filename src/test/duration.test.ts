import { describe, expect, it } from "vitest";
import {
  formatDuration, formatDurationShort, parseDurationInput,
  preferredUnit, secondsFromUnit, splitForUnit,
} from "@/lib/duration";

describe("duration helpers", () => {
  it("secondsFromUnit converts sec/min to integer seconds", () => {
    expect(secondsFromUnit("30", "sec")).toBe(30);
    expect(secondsFromUnit("1", "min")).toBe(60);
    expect(secondsFromUnit("1.5", "min")).toBe(90);
    expect(secondsFromUnit("2", "min")).toBe(120);
    expect(secondsFromUnit(45, "sec")).toBe(45);
  });
  it("secondsFromUnit rejects zero / negative / non-numeric", () => {
    expect(secondsFromUnit("0", "sec")).toBeNull();
    expect(secondsFromUnit("-3", "sec")).toBeNull();
    expect(secondsFromUnit("abc", "min")).toBeNull();
    expect(secondsFromUnit("", "min")).toBeNull();
    expect(secondsFromUnit(null, "min")).toBeNull();
  });
  it("splitForUnit preserves seconds across unit changes", () => {
    expect(splitForUnit(90, "sec")).toBe("90");
    expect(splitForUnit(90, "min")).toBe("1.5");
    expect(splitForUnit(60, "min")).toBe("1");
    expect(splitForUnit(120, "min")).toBe("2");
    expect(splitForUnit(null, "sec")).toBe("");
  });
  it("round-trips through unit changes", () => {
    for (const s of [30, 45, 60, 90, 120, 135]) {
      expect(secondsFromUnit(splitForUnit(s, "sec"), "sec")).toBe(s);
      // min loses sub-second precision but should round-trip whole seconds.
      const viaMin = secondsFromUnit(splitForUnit(s, "min"), "min");
      expect(viaMin).toBe(s);
    }
  });
  it("preferredUnit picks sec under 60 seconds, min otherwise", () => {
    expect(preferredUnit(30)).toBe("sec");
    expect(preferredUnit(59)).toBe("sec");
    expect(preferredUnit(60)).toBe("min");
    expect(preferredUnit(90)).toBe("min");
    expect(preferredUnit(null)).toBe("sec");
  });
  it("formatDuration produces the client-facing string", () => {
    expect(formatDuration(20)).toBe("20 sec");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(90)).toBe("1 min 30 sec");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(135)).toBe("2 min 15 sec");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(null)).toBe("");
  });
  it("formatDurationShort is the compact form", () => {
    expect(formatDurationShort(45)).toBe("45s");
    expect(formatDurationShort(60)).toBe("1m");
    expect(formatDurationShort(90)).toBe("1m 30s");
  });
  it("parseDurationInput still handles legacy freeform inputs", () => {
    expect(parseDurationInput("1:30")).toBe(90);
    expect(parseDurationInput("45 sec")).toBe(45);
    expect(parseDurationInput("1m 30s")).toBe(90);
    expect(parseDurationInput("2 min")).toBe(120);
    expect(parseDurationInput("45")).toBe(45);
    expect(parseDurationInput("0")).toBeNull();
  });
});