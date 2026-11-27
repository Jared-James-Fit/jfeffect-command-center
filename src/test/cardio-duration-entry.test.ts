import { describe, expect, it } from "vitest";
import { parseCardioDuration, parseMMSS, fmtMMSS } from "@/lib/set-timer-store";

describe("cardio duration entry", () => {
  it.each([["5",300],["25",1500],["430",270],["2530",1530],["10000",3600],["045",45],["25:30",1530],["1:00:00",3600],["260",null],["1:60",null],["",null],["0",null],["-5",null],["16000",null]])("parses %s as %s seconds", (raw, expected) => {
    expect(parseCardioDuration(raw as string)).toBe(expected);
  });
  it("formats logged results and preserves non-cardio seconds semantics", () => {
    expect(fmtMMSS(parseCardioDuration("2530")!)).toBe("25:30");
    expect(fmtMMSS(parseCardioDuration("10000")!)).toBe("1:00:00");
    expect(parseMMSS("45")).toBe(45);
  });
});
