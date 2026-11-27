import { describe, expect, it } from "vitest";
import { parseCardioDuration, parseMMSS, fmtMMSS, cardioMinutesDraft, cardioDurationDraft } from "@/lib/set-timer-store";

describe("cardio duration entry", () => {
  const cases: [string, number | null][] = [["25",1500],["25:00",1500],["25:",1500],[":45",45],["25:3",1503],["2530",1530],["045",45],["120:00",7200],["90:00",5400],["1:30:00",5400],["13000",5400],["1:60",null],["1:60:00",null],["",null],["0:00",null],["-5",null],["::",null]];
  it.each(cases)("parses %s as %s seconds", (raw, expected) => {
    expect(parseCardioDuration(raw)).toBe(expected);
  });
  const edits: [string, string, string][] = [["25:00","2:00","25:00"],["2500","25:00","25:00"],["2530","0:00","25:30"],["","25:00","0:00"],["120:00","12:00","120:00"],["25:","25:00","25:"]];
  it.each(edits)("edits %s without losing the colon", (raw, previous, expected) => {
    expect(cardioDurationDraft(raw, previous)).toBe(expected);
  });
  it("formats logged hours and preserves non-cardio seconds semantics", () => {
    expect(fmtMMSS(parseCardioDuration("2530")!)).toBe("25:30");
    expect(fmtMMSS(parseCardioDuration("120:00")!)).toBe("2:00:00");
    expect(cardioMinutesDraft(5400)).toBe("90:00");
    expect(parseMMSS("45")).toBe(45);
  });
});
