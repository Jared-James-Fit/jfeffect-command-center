import { describe, expect, it } from "vitest";
import {
  computeSlots,
  isOpenSlot,
  normalizeHours,
  rangeLabel,
  slotStepMinutes,
  slugify,
  summarizeHours,
  type BookingRules,
} from "@/lib/booking-slots";
import { googleBusyForBooking } from "@/lib/session-conflicts";
import { wallTimeToUtc } from "@/lib/schedule-time";
import { creditDefaultFor, locationLabel } from "@/lib/booking-types";

const TZ = "America/Winnipeg";
const rules = (over: Partial<BookingRules> = {}): BookingRules => ({
  durationMin: 60,
  timezone: TZ,
  minNoticeHours: 0,
  maxAdvanceDays: 60,
  bufferMin: 0,
  maxPerDay: null,
  ...over,
});
// Mon Oct 12 2026, 6 AM to 9 AM and 4 PM to 8 PM in Selkirk.
const MON = "2026-10-12";
const hours = [
  { day_of_week: 1, start_time: "06:00", end_time: "09:00" },
  { day_of_week: 1, start_time: "16:00", end_time: "20:00" },
];
// Friday Oct 9, 10:44 AM in Winnipeg (15:44Z).
const NOW = new Date("2026-10-09T15:44:00Z");
const at = (date: string, hm: string) => wallTimeToUtc(date, hm, TZ).getTime();
const labels = (slots: { start: string }[]) =>
  slots.map((s) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
      new Date(s.start),
    ),
  );

describe("open times", () => {
  it("offers every half hour inside each window, in the coach's zone", () => {
    const slots = computeSlots({ hours, rules: rules(), busy: [], from: MON, to: MON, now: NOW });
    expect(labels(slots)).toEqual([
      "06:00",
      "06:30",
      "07:00",
      "07:30",
      "08:00",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
      "18:00",
      "18:30",
      "19:00",
    ]);
    expect(slots[0].start).toBe("2026-10-12T11:00:00.000Z");
    expect(slots.every((s) => s.date === MON)).toBe(true);
  });

  it("skips anything that overlaps a session, an appointment or a Google event", () => {
    const busy = [{ start: at(MON, "07:00"), end: at(MON, "08:00") }];
    const slots = computeSlots({ hours, rules: rules(), busy, from: MON, to: MON, now: NOW });
    expect(labels(slots).slice(0, 3)).toEqual(["06:00", "08:00", "16:00"]);
  });

  it("keeps a gap around other bookings when a buffer is set", () => {
    const busy = [{ start: at(MON, "07:00"), end: at(MON, "08:00") }];
    const slots = computeSlots({
      hours,
      rules: rules({ bufferMin: 15 }),
      busy,
      from: MON,
      to: MON,
      now: NOW,
    });
    // 6:00 would end at 7:00 with no gap; 8:00 would start right after.
    expect(labels(slots).filter((l) => l < "12:00")).toEqual([]);
  });

  it("respects minimum notice and how far ahead people can book", () => {
    const fri = "2026-10-09";
    const friHours = [{ day_of_week: 5, start_time: "09:00", end_time: "17:00" }];
    const slots = computeSlots({
      hours: friHours,
      rules: rules({ minNoticeHours: 2 }),
      busy: [],
      from: fri,
      to: fri,
      now: NOW,
    });
    expect(labels(slots)[0]).toBe("13:00"); // 10:44 + 2h, next half hour
    const far = computeSlots({
      hours,
      rules: rules({ maxAdvanceDays: 2 }),
      busy: [],
      from: MON,
      to: MON,
      now: NOW,
    });
    expect(far).toEqual([]);
  });

  it("stops offering a day once it hits the daily cap", () => {
    const slots = computeSlots({
      hours,
      rules: rules({ maxPerDay: 2 }),
      busy: [],
      bookedPerDay: { [MON]: 2 },
      from: MON,
      to: MON,
      now: NOW,
    });
    expect(slots).toEqual([]);
  });

  it("never offers past times or days before today", () => {
    const slots = computeSlots({
      hours,
      rules: rules(),
      busy: [],
      from: "2026-10-05",
      to: MON,
      now: NOW,
    });
    expect(slots.every((s) => Date.parse(s.start) > NOW.getTime())).toBe(true);
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set([MON]));
  });

  it("uses 15-minute steps for short calls", () => {
    expect(slotStepMinutes(15)).toBe(15);
    expect(slotStepMinutes(20)).toBe(15);
    expect(slotStepMinutes(30)).toBe(30);
    const slots = computeSlots({
      hours: [{ day_of_week: 1, start_time: "12:00", end_time: "13:00" }],
      rules: rules({ durationMin: 20 }),
      busy: [],
      from: MON,
      to: MON,
      now: NOW,
    });
    expect(labels(slots)).toEqual(["12:00", "12:15", "12:30"]);
  });

  it("holds the wall clock across the November time change", () => {
    const after = computeSlots({
      hours: [{ day_of_week: 1, start_time: "06:00", end_time: "07:00" }],
      rules: rules(),
      busy: [],
      from: "2026-11-02",
      to: "2026-11-02",
      now: NOW,
    });
    expect(after[0].start).toBe("2026-11-02T12:00:00.000Z"); // 6 AM CST
  });

  it("only accepts a booking for an exact open time", () => {
    const slots = computeSlots({ hours, rules: rules(), busy: [], from: MON, to: MON, now: NOW });
    expect(isOpenSlot(slots, "2026-10-12T11:00:00.000Z")?.date).toBe(MON);
    expect(isOpenSlot(slots, "2026-10-12T11:10:00.000Z")).toBeNull(); // not on the grid
    expect(isOpenSlot(slots, "2026-10-12T08:00:00.000Z")).toBeNull(); // 3 AM
    expect(isOpenSlot(slots, "not a date")).toBeNull();
  });
});

describe("weekly hours", () => {
  it("merges overlapping windows and drops backwards ones", () => {
    expect(
      normalizeHours([
        { day_of_week: 1, start_time: "06:00", end_time: "09:00" },
        { day_of_week: 1, start_time: "08:00", end_time: "10:00" },
        { day_of_week: 2, start_time: "10:00", end_time: "09:00" },
      ]),
    ).toEqual([{ day_of_week: 1, start_time: "06:00", end_time: "10:00" }]);
  });

  it("reads like a person wrote it", () => {
    const week = [1, 2, 3, 4, 5].flatMap((d) => [
      { day_of_week: d, start_time: "06:00", end_time: "09:00" },
      { day_of_week: d, start_time: "16:00", end_time: "20:00" },
    ]);
    expect(
      summarizeHours([...week, { day_of_week: 6, start_time: "08:00", end_time: "12:00" }]),
    ).toBe("Mon–Fri 6–9 AM, 4–8 PM · Sat 8 AM–12 PM");
    expect(
      summarizeHours(
        [1, 3, 5].map((d) => ({ day_of_week: d, start_time: "09:30", end_time: "17:00" })),
      ),
    ).toBe("Mon, Wed, Fri 9:30 AM–5 PM");
    expect(summarizeHours([])).toBe("No hours set");
    expect(rangeLabel("11:00", "12:00")).toBe("11 AM–12 PM");
  });
});

describe("Google events and online booking", () => {
  const midnight = (d: string) => wallTimeToUtc(d, "00:00", TZ).getTime();
  it("blocks a timed event and a busy all-day event, not a free one", () => {
    expect(
      googleBusyForBooking(
        {
          id: "a",
          start: { dateTime: "2026-10-12T07:00:00-05:00" },
          end: { dateTime: "2026-10-12T08:00:00-05:00" },
        },
        midnight,
      ),
    ).toEqual({
      start: Date.parse("2026-10-12T12:00:00Z"),
      end: Date.parse("2026-10-12T13:00:00Z"),
    });
    expect(
      googleBusyForBooking(
        { id: "v", start: { date: "2026-10-12" }, end: { date: "2026-10-14" } },
        midnight,
      ),
    ).toEqual({
      start: midnight("2026-10-12"),
      end: midnight("2026-10-14"),
    });
    expect(
      googleBusyForBooking(
        {
          id: "b",
          transparency: "transparent",
          start: { date: "2026-10-12" },
          end: { date: "2026-10-13" },
        },
        midnight,
      ),
    ).toBeNull();
  });
  it("ignores cancelled, declined and the app's own session copies", () => {
    const base = {
      start: { dateTime: "2026-10-12T07:00:00-05:00" },
      end: { dateTime: "2026-10-12T08:00:00-05:00" },
    };
    expect(googleBusyForBooking({ id: "c", status: "cancelled", ...base }, midnight)).toBeNull();
    expect(
      googleBusyForBooking(
        { id: "d", attendees: [{ self: true, responseStatus: "declined" }], ...base },
        midnight,
      ),
    ).toBeNull();
    expect(
      googleBusyForBooking(
        { id: "e", extendedProperties: { private: { jfPtSessionId: "x" } }, ...base },
        midnight,
      ),
    ).toBeNull();
  });
});

describe("booking type defaults", () => {
  it("training uses a session, calls don't", () => {
    expect(creditDefaultFor("Personal Training Session")).toBe(true);
    expect(creditDefaultFor("Consultation")).toBe(false);
    expect(creditDefaultFor("Check-In Session")).toBe(false);
  });
  it("labels where it happens", () => {
    expect(locationLabel({ location_mode: "video", location: "x" })).toBe("Google Meet video call");
    expect(locationLabel({ location_mode: "in_person", location: "Iron Image Gym" })).toBe(
      "Iron Image Gym",
    );
  });
  it("makes clean links", () => {
    expect(slugify("1:1 Training")).toBe("1-1-training");
    expect(slugify("  Free Intro Call! ")).toBe("free-intro-call");
    expect(slugify("Café Séance")).toBe("cafe-seance");
    expect(slugify("!!!")).toBe("book");
  });
});

describe("personal booking links", async () => {
  process.env.BOOKING_INVITE_SECRET = "test-secret-for-booking-links-only";
  const { signBookingInvite, verifyBookingInvite } = await import("@/lib/booking-invite.server");
  const id = "3d263734-5d46-4903-8520-e772aa8ca19d";
  const now = Date.parse("2026-10-09T15:44:00Z");

  it("names the client it was made for", () => {
    expect(verifyBookingInvite(signBookingInvite(id, 45, now), now)).toBe(id);
  });
  it("can't be edited to name someone else or live longer", () => {
    const [, exp, sig] = signBookingInvite(id, 45, now).split(".");
    expect(
      verifyBookingInvite(`8072b23e-93e6-480b-afe6-6f0af204d6a3.${exp}.${sig}`, now),
    ).toBeNull();
    expect(verifyBookingInvite(`${id}.${Number(exp) + 86400}.${sig}`, now)).toBeNull();
  });
  it("expires", () => {
    const t = signBookingInvite(id, 1, now);
    expect(verifyBookingInvite(t, now + 2 * 86_400_000)).toBeNull();
  });
  it("rejects junk", () => {
    for (const junk of ["", "abc", `${id}..`, `${id}.123.zz`, "x".repeat(200)])
      expect(verifyBookingInvite(junk, now)).toBeNull();
  });
});
