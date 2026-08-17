import { describe, it, expect } from "vitest";
import {
  emptyStopwatch,
  emptyTimer,
  formatClock,
  pauseStopwatch,
  pauseTimer,
  startStopwatch,
  startTimer,
  stopwatchElapsedMs,
  addTimerSeconds,
  tallyDecrement,
  tallyIncrement,
  timerDone,
  timerRemainingMs,
  timerRunning,
} from "@/lib/workout-tools/timing";

const T0 = 1_700_000_000_000;

describe("workout tools stopwatch", () => {
  it("accumulates elapsed time from timestamps across pause/resume", () => {
    let s = startStopwatch(emptyStopwatch(), T0);
    expect(stopwatchElapsedMs(s, T0 + 5000)).toBe(5000);
    s = pauseStopwatch(s, T0 + 5000);
    // Paused: time keeps passing but elapsed is frozen.
    expect(stopwatchElapsedMs(s, T0 + 60_000)).toBe(5000);
    s = startStopwatch(s, T0 + 60_000);
    expect(stopwatchElapsedMs(s, T0 + 62_000)).toBe(7000);
  });

  it("survives backgrounding (no decrement drift)", () => {
    const s = startStopwatch(emptyStopwatch(), T0);
    expect(stopwatchElapsedMs(s, T0 + 3_600_000)).toBe(3_600_000);
  });
});

describe("workout tools timer", () => {
  it("counts down from absolute end timestamp", () => {
    const t = startTimer(emptyTimer(60), T0);
    expect(timerRemainingMs(t, T0 + 10_000)).toBe(50_000);
    expect(timerRunning(t, T0 + 10_000)).toBe(true);
    expect(timerDone(t, T0 + 10_000)).toBe(false);
  });

  it("reaches Done exactly at zero and never goes negative", () => {
    const t = startTimer(emptyTimer(30), T0);
    expect(timerRemainingMs(t, T0 + 45_000)).toBe(0);
    expect(timerDone(t, T0 + 45_000)).toBe(true);
    expect(timerRunning(t, T0 + 45_000)).toBe(false);
  });

  it("pause/resume preserves remaining time", () => {
    let t = startTimer(emptyTimer(120), T0);
    t = pauseTimer(t, T0 + 20_000);
    expect(timerRemainingMs(t, T0 + 90_000)).toBe(100_000);
    t = startTimer(t, T0 + 90_000);
    expect(timerRemainingMs(t, T0 + 100_000)).toBe(90_000);
  });

  it("+30 works while running and while paused", () => {
    const running = addTimerSeconds(startTimer(emptyTimer(60), T0), 30, T0 + 10_000);
    expect(timerRemainingMs(running, T0 + 10_000)).toBe(80_000);
    const paused = addTimerSeconds(emptyTimer(60), 30, T0);
    expect(timerRemainingMs(paused, T0)).toBe(90_000);
  });
});

describe("tally + formatting", () => {
  it("never drops below zero", () => {
    expect(tallyDecrement(0)).toBe(0);
    expect(tallyDecrement(tallyIncrement(0))).toBe(0);
  });

  it("formats mm:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(222_000)).toBe("03:42");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });
});
