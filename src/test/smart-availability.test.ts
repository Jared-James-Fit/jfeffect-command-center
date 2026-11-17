import { describe, expect, it } from "vitest";
import {
  isHardOpen,
  learnFromOverrides,
  planAvailability,
  recurringBlocks,
  sanitizeAvailability,
  type AvailabilityOverride,
  type BusyItem,
  type CallType,
  type PlanInput,
} from "@/lib/smart-availability";
import { localTimeHM, wallTimeToUtc } from "@/lib/schedule-time";

const TZ = "America/Winnipeg";
const at = (date: string, hm: string, tz = TZ) => wallTimeToUtc(date, hm, tz).getTime();
const hm = (iso: string | number, tz = TZ) => localTimeHM(new Date(iso), tz);

// Monday Nov 16 2026, 7 AM: the week runs Mon 16 – Sun 22.
const NOW = new Date(at("2026-11-16", "07:00"));
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";
const FRI = "2026-11-20";

const CALL: CallType = { durationMin: 30, bufferMin: 0, minNoticeHours: 0, maxAdvanceDays: 60, maxPerDay: null, hours: [] };

function settings(over: Record<string, unknown> = {}) {
  return sanitizeAvailability({
    mode: "auto",
    timezone: TZ,
    days: [1, 2, 3, 4, 5],
    dayStart: "09:00",
    dayEnd: "17:00",
    gapMin: 15,
    maxPerDay: 3,
    maxPerWeek: 10,
    minNoticeHours: 0,
    maxAdvanceDays: 30,
    focusMin: 120,
    callBlockMin: 120,
    weeklyFloor: 0,
    stretch: false,
    ...over,
  });
}

function plan(over: Partial<PlanInput> & { s?: Record<string, unknown> } = {}) {
  return planAvailability({
    settings: settings(over.s),
    overrides: over.overrides ?? [],
    type: over.type ?? CALL,
    busy: over.busy ?? [],
    calls: over.calls ?? [],
    from: over.from ?? MON,
    to: over.to ?? "2026-11-22",
    now: over.now ?? NOW,
  });
}

const busy = (date: string, s: string, e: string, kind: BusyItem["kind"] = "session"): BusyItem => ({ start: at(date, s), end: at(date, e), kind });
const day = (p: ReturnType<typeof plan>, date: string) => p.days.find((d) => d.date === date)!;
const windows = (p: ReturnType<typeof plan>, date: string) => day(p, date).windows.map((w) => `${hm(w.start)}-${hm(w.end)}`);
/** Every offered call, with its gap, misses everything busy. */
function clearOf(p: ReturnType<typeof plan>, items: BusyItem[], gapMin = 15) {
  return p.slots.every((s) => {
    const a = Date.parse(s.start) - gapMin * 60_000;
    const b = Date.parse(s.end) + gapMin * 60_000;
    return items.every((x) => b <= x.start || a >= x.end);
  });
}

describe("smart availability: the 12 scenarios", () => {
  it("1. a completely open week offers one call block a day and keeps the rest clear", () => {
    const p = plan();
    for (const d of [MON, TUE, WED, THU, FRI]) {
      expect(windows(p, d)).toEqual(["15:00-17:00"]);
      expect(day(p, d).reason).toMatch(/Calls grouped 3–5 PM/);
    }
    // No weekend calls.
    expect(day(p, "2026-11-21").slots).toHaveLength(0);
    expect(day(p, "2026-11-21").reason).toBe("No calls on Saturdays");
    // With a preferred time, the block sits there instead.
    const pref = plan({ s: { preferredStart: "13:00", preferredEnd: "15:00" } });
    expect(windows(pref, TUE)).toEqual(["13:00-15:00"]);
  });

  it("2. a heavily booked day offers one window at most", () => {
    const items = [busy(WED, "09:00", "10:00"), busy(WED, "10:30", "11:00"), busy(WED, "12:00", "13:00"), busy(WED, "14:00", "15:00"), busy(WED, "16:00", "17:00")];
    const p = plan({ busy: items });
    expect(day(p, WED).windows.length).toBeLessThanOrEqual(1);
    expect(day(p, WED).reason).toMatch(/Busy day \(5 things on\)/);
    expect(clearOf(p, items)).toBe(true);
  });

  it("3. recurring coaching appointments: the gap before them is offered, then one block after, then focus time", () => {
    const items = [busy(TUE, "10:00", "11:00"), busy(TUE, "11:00", "12:00")];
    const p = plan({ busy: items });
    // 9:00–9:45 is too short to work in (offered whole); after 12 + gap, two hours of calls on the half hours; 2:30–5 stays clear.
    expect(windows(p, TUE)).toEqual(["09:00-09:45", "12:15-14:30"]);
    expect(day(p, TUE).reason).toMatch(/next to what's on/);
    expect(clearOf(p, items)).toBe(true);
  });

  it("4. training blocks in the afternoon are never offered", () => {
    const p = plan({ s: { protected: [{ id: "t", label: "Training", kind: "training", days: [1, 2, 3, 4, 5], start: "13:00", end: "15:00" }] } });
    for (const s of p.slots) {
      const start = hm(s.start);
      const end = hm(s.end);
      expect(end <= "13:00" || start >= "15:00").toBe(true);
    }
    // It's said once where it matters.
    expect(p.days.filter((d) => d.date <= FRI && d.date >= MON).some((d) => d.protectedTimes.length === 1)).toBe(true);
  });

  it("5. a last-minute calendar change closes the times it covers straight away", () => {
    const before = plan();
    expect(before.slots.some((s) => s.date === THU && hm(s.start) === "15:30")).toBe(true);
    const meeting = busy(THU, "15:00", "16:00", "google");
    const after = plan({ busy: [meeting] });
    expect(clearOf(after, [meeting])).toBe(true);
    expect(after.slots.some((s) => s.date === THU && hm(s.start) === "15:30")).toBe(false);
  });

  it("6. a cancelled appointment reopens its time, but protected time stays closed", () => {
    const meeting = busy(MON, "15:00", "16:00", "appointment");
    const cancelled = plan({ busy: [] });
    const booked = plan({ busy: [meeting] });
    const at3 = (p: ReturnType<typeof plan>) => p.slots.some((s) => s.date === MON && hm(s.start) === "15:00");
    expect(at3(booked)).toBe(false);
    expect(at3(cancelled)).toBe(true);
    const prot = plan({ busy: [], s: { protected: [{ id: "p", label: "Kids", kind: "personal", days: [1], start: "15:00", end: "17:00" }] } });
    expect(prot.slots.filter((s) => s.date === MON).every((s) => hm(s.end) <= "15:00")).toBe(true);
  });

  it("7. back-to-back meetings: calls start right after them", () => {
    const items = [busy(WED, "09:00", "10:00"), busy(WED, "10:00", "11:00"), busy(WED, "11:00", "12:00")];
    const p = plan({ busy: items });
    expect(windows(p, WED)).toEqual(["12:15-14:30"]);
  });

  it("8. conflicting events (a Google event over an appointment) are both kept clear of", () => {
    const items = [busy(THU, "14:00", "15:00", "appointment"), busy(THU, "14:30", "15:30", "google")];
    const p = plan({ busy: items });
    expect(clearOf(p, items)).toBe(true);
  });

  it("9. his own changes: block, open extra, a day off, and an Assisted day he accepted", () => {
    const overrides: AvailabilityOverride[] = [
      { date: MON, kind: "block", start: "15:00", end: "16:00" },
      { date: TUE, kind: "open", start: "18:00", end: "19:00" },
      { date: WED, kind: "off" },
    ];
    const p = plan({ overrides });
    expect(day(p, MON).slots.every((s) => hm(s.end) <= "15:00" || hm(s.start) >= "16:00")).toBe(true);
    expect(day(p, MON).slots.length).toBeGreaterThan(0);
    expect(day(p, TUE).slots.some((s) => hm(s.start) === "18:00")).toBe(true);
    expect(day(p, WED).slots).toHaveLength(0);
    expect(day(p, WED).reason).toBe("Day off");

    // Assisted: his hours as they are, the smart picks shown; a day he accepts uses them.
    const assisted = plan({ s: { mode: "assisted" }, overrides: [{ date: THU, kind: "smart" }] });
    expect(day(assisted, MON).how).toBe("manual");
    expect(windows(assisted, MON)).toEqual(["09:00-17:00"]);
    expect(day(assisted, MON).suggested?.length).toBe(1);
    expect(day(assisted, THU).how).toBe("smart");
    expect(windows(assisted, THU)).toEqual(["15:00-17:00"]);
  });

  it("10. protected focus time is never offered, even when it's the only free time", () => {
    const p = plan({
      s: { protected: [{ id: "f", label: "Focus time", kind: "focus", days: [5], start: "09:00", end: "17:00" }] },
    });
    expect(day(p, FRI).slots).toHaveLength(0);
  });

  it("11. not enough time for the week's floor: more opens, still inside every hard rule", () => {
    const items = [MON, TUE, WED, THU, FRI].map((d) => busy(d, "15:00", "16:00"));
    const training = [{ id: "x", label: "Training", kind: "training", days: [1, 2, 3, 4, 5], start: "16:00", end: "17:00" }];
    const thin = plan({ busy: items, s: { dayStart: "08:00", weeklyFloor: 0, maxPerDay: 6, protected: training } });
    const floored = plan({ busy: items, s: { dayStart: "08:00", weeklyFloor: 30, maxPerDay: 6, protected: training } });
    expect(thin.slots.length).toBe(20); // 12:45–2:45 next to the 3 PM, four a day
    expect(floored.slots.length).toBeGreaterThanOrEqual(30);
    expect(floored.days.some((d) => d.reason?.startsWith("Opened more time"))).toBe(true);
    expect(clearOf(floored, items)).toBe(true);
    expect(floored.slots.every((s) => hm(s.end) <= "16:00")).toBe(true);
    // Never more than the hard rules leave.
    for (const d of floored.days) for (const s of d.slots) expect(isHardOpen(floored, s.start, 30)).not.toBeNull();
  });

  it("12. the engine only offers what it's told is busy-free; Google being unreadable is refused upstream", async () => {
    // The server refuses to offer any time when a calendar can't be read (requireAll),
    // so the engine never sees a half-known calendar. Here: an all-day busy event closes the day.
    const allDay: BusyItem = { start: at(MON, "00:00"), end: at(TUE, "00:00"), kind: "google" };
    const p = plan({ busy: [allDay] });
    expect(day(p, MON).slots).toHaveLength(0);
    const { readFileSync } = await import("node:fs");
    const server = readFileSync("src/lib/booking.server.ts", "utf8");
    expect(server).toContain("requireAll: true");
    expect(server).toContain('"calendar_unavailable"');
  });
});

describe("smart availability: hard rules in every mode", () => {
  it("daily and weekly call limits close the day / week", () => {
    const calls = [busy(MON, "09:00", "09:30"), busy(MON, "10:00", "10:30"), busy(MON, "11:00", "11:30")];
    const p = plan({ calls, busy: calls });
    expect(day(p, MON).closed).toBe(true);
    expect(day(p, MON).reason).toMatch(/3 calls already/);
    const week = [MON, TUE, WED, THU].flatMap((d) => [busy(d, "09:00", "09:30"), busy(d, "10:00", "10:30")]);
    const w = plan({ calls: week, busy: week, s: { maxPerWeek: 8 } });
    expect(day(w, FRI).closed).toBe(true);
    expect(day(w, FRI).reason).toMatch(/weekly call limit/);
  });

  it("away dates, notice and the booking window", () => {
    const away = plan({ s: { away: [{ id: "a", from: WED, to: THU, label: "Nationals" }] } });
    expect(day(away, WED).slots).toHaveLength(0);
    expect(day(away, THU).reason).toBe("Away: Nationals");
    // 24 hours' notice from Mon 7 AM: nothing Monday, Tuesday from 7 AM on.
    const notice = plan({ s: { minNoticeHours: 24, mode: "manual" } });
    expect(day(notice, MON).slots).toHaveLength(0);
    expect(day(notice, TUE).slots.length).toBeGreaterThan(0);
    // Last-minute off means a day's notice whatever the setting.
    const strict = plan({ s: { lastMinute: false, mode: "manual" } });
    expect(day(strict, MON).slots).toHaveLength(0);
    // 3 days ahead at most.
    const near = plan({ s: { maxAdvanceDays: 3 } });
    expect(near.days.map((d) => d.date).at(-1)).toBe(THU);
  });

  it("Manual uses a type's own hours, with protected time and limits still applied", () => {
    const type: CallType = { ...CALL, hours: [{ day_of_week: 2, start_time: "06:00", end_time: "09:00" }] };
    const p = plan({ type, s: { mode: "manual", protected: [{ id: "t", label: "Training", kind: "training", days: [2], start: "07:00", end: "08:00" }] } });
    expect(windows(p, TUE)).toEqual(["06:00-07:00", "08:00-09:00"]);
    expect(day(p, MON).slots).toHaveLength(0);
  });

  it("pausing falls back to Manual until the date", () => {
    const p = plan({ s: { pausedUntil: TUE } });
    expect(day(p, MON).how).toBe("manual");
    expect(day(p, WED).how).toBe("smart");
  });

  it("the booking re-check takes any hard-free time on the grid, never off it or over something busy", () => {
    const meeting = busy(TUE, "13:00", "14:00");
    const p = plan({ busy: [meeting] });
    expect(isHardOpen(p, new Date(at(TUE, "10:00")).toISOString(), 30)).not.toBeNull();
    expect(isHardOpen(p, new Date(at(TUE, "10:10")).toISOString(), 30)).toBeNull();
    expect(isHardOpen(p, new Date(at(TUE, "12:45")).toISOString(), 30)).toBeNull();
    expect(isHardOpen(p, new Date(at(TUE, "14:00")).toISOString(), 30)).toBeNull(); // inside the 15-min gap
    expect(isHardOpen(p, new Date(at(TUE, "14:30")).toISOString(), 30)).not.toBeNull();
  });

  it("rounding to the start-time grid never gives focus time to calls (20-min calls before protected training)", () => {
    const p = plan({
      type: { ...CALL, durationMin: 20 },
      s: { protected: [{ id: "t", label: "Training", kind: "training", days: [4], start: "13:00", end: "17:00" }] },
    });
    // 9–1 is free: two hours of calls at its end, 9–11 kept clear (it used to round to 10:50 and lose the morning).
    const w = windows(p, THU);
    expect(w).toHaveLength(1);
    expect(w[0] >= "10:45-13:00").toBe(true);
    expect(day(p, THU).slots.every((s) => hm(s.start) >= "10:45")).toBe(true);
  });

  it("is deterministic", () => {
    const items = [busy(TUE, "10:00", "11:00"), busy(THU, "14:00", "15:00", "google")];
    expect(plan({ busy: items })).toEqual(plan({ busy: items }));
  });

  it("follows the zone's own clock across a change (Toronto, Mar 8 2026)", () => {
    const tz = "America/Toronto";
    const p = planAvailability({
      settings: settings({ timezone: tz, mode: "manual", maxPerDay: null }),
      overrides: [],
      type: CALL,
      busy: [],
      calls: [],
      from: "2026-03-06",
      to: "2026-03-09",
      now: new Date(wallTimeToUtc("2026-03-05", "08:00", tz).getTime()),
    });
    for (const date of ["2026-03-06", "2026-03-09"]) {
      const s = p.days.find((d) => d.date === date)!.slots;
      expect(hm(s[0].start, tz)).toBe("09:00");
      expect(hm(s.at(-1)!.end, tz)).toBe("17:00");
    }
  });
});

describe("learning and habits", () => {
  it("suggests protecting a time he keeps blocking (3 of the last 8 weeks), never on its own", () => {
    const overrides: AvailabilityOverride[] = ["2026-10-26", "2026-11-02", "2026-11-09"].map((d) => ({ date: d, kind: "block", start: "09:00", end: "11:00" }));
    const s = settings();
    const out = learnFromOverrides(overrides, s, MON);
    expect(out[0]).toMatchObject({ kind: "protect", days: [1], start: "09:00", end: "11:00", weeks: 3 });
    // Two weeks isn't a habit; dismissed and reset are respected.
    expect(learnFromOverrides(overrides.slice(1), s, MON)).toEqual([]);
    expect(learnFromOverrides(overrides, { ...s, dismissed: [out[0].key] }, MON)).toEqual([]);
    expect(learnFromOverrides(overrides.map((o) => ({ ...o, created_at: `${o.date}T12:00:00Z` })), { ...s, learningSince: "2026-11-05T00:00:00Z" }, MON)).toEqual([]);
  });

  it("finds recurring calendar habits from times only, and leaves client sessions out", () => {
    const weeks = ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"];
    const gym = weeks.map((d) => busy(d, "13:00", "15:00", "google"));
    const sessions = weeks.map((d) => busy(d, "10:00", "11:00", "session"));
    const out = recurringBlocks([...gym, ...sessions], settings(), 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ days: [2], start: "13:00", end: "15:00", weeks: 4 });
  });

  it("sanitizes junk settings to safe defaults", () => {
    const s = sanitizeAvailability({ mode: "chaos", dayStart: "25:00", dayEnd: "08:00", maxPerDay: -3, protected: [{ start: "10:00", end: "09:00", days: [1] }], days: [9, 1] });
    expect(s.mode).toBe("manual");
    expect(s.dayStart).toBe("09:00");
    expect(s.dayEnd).toBe("10:00");
    expect(s.maxPerDay).toBe(1);
    expect(s.protected).toEqual([]);
    expect(s.days).toEqual([1]);
  });
});
