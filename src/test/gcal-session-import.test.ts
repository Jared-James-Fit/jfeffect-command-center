import { describe, expect, it } from "vitest";
import { eventNamesClient, looksLikeTraining, planImport, type ImportClient, type ImportEvent } from "@/lib/gcal-session-import";

const marc: ImportClient = { id: "m", full_name: "Marc Asugui", first_name: "Marc", last_name: "Asugui", preferred_name: "Marc", email: "masgafr2@gmail.com" };
const colten: ImportClient = { id: "c", full_name: "Colten Murray", first_name: "Colten", last_name: "Murray", email: "coltenamurray@gmail.com" };
const nico: ImportClient = { id: "n", full_name: "Nicolas Galli", first_name: "Nicolas", last_name: "Galli", email: "nicogalli@yahoo.com" };
const ev = (id: string, summary: string, start: string, end: string, extra: Partial<ImportEvent> = {}): ImportEvent => ({ id, calendarId: "cal", summary, start, end, ...extra });

describe("which appointments are a client's sessions", () => {
  it("matches a first name, a nickname, a full name or a guest's email", () => {
    expect(eventNamesClient(ev("1", "Marc PT", "", ""), marc)).toBe(true);
    expect(eventNamesClient(ev("2", "Training w/ Colten", "", ""), colten)).toBe(true);
    expect(eventNamesClient(ev("3", "Nico - legs", "", ""), nico)).toBe(true);
    expect(eventNamesClient(ev("4", "1:1", "", "", { attendees: [{ email: "NicoGalli@yahoo.com" }] }), nico)).toBe(true);
    expect(eventNamesClient(ev("5", "Session", "", "", { description: "with Colten Murray" }), colten)).toBe(true);
    expect(eventNamesClient(ev("6", "Marc's session", "", ""), marc)).toBe(true);
  });

  it("doesn't match a name inside another word or another person", () => {
    expect(eventNamesClient(ev("1", "Marcus PT", "", ""), marc)).toBe(false);
    expect(eventNamesClient(ev("2", "Mar 5 meeting", "", ""), marc)).toBe(false);
    expect(eventNamesClient(ev("3", "Nic", "", ""), nico)).toBe(false);
    expect(eventNamesClient(ev("4", "Dentist", "", ""), colten)).toBe(false);
  });
});

describe("titles that read like a session", () => {
  it("ticks PT sessions and leaves social plans unticked", () => {
    expect(looksLikeTraining("PT Session - Nicolas (early session)")).toBe(true);
    expect(looksLikeTraining("Marc 1:1")).toBe(true);
    expect(looksLikeTraining("Colten training")).toBe(true);
    expect(looksLikeTraining("Mall date with Nicolas")).toBe(false);
    expect(looksLikeTraining("Dinner w/ Marc")).toBe(false);
    expect(looksLikeTraining("Private Coaching Call — Colten Murray")).toBe(false);
    expect(looksLikeTraining("Marc Payment")).toBe(false);
    expect(looksLikeTraining("Nico workout")).toBe(true);
  });
});

describe("what each appointment becomes", () => {
  const now = new Date("2026-10-22T18:00:00Z");
  const events = [
    ev("a", "Colten PT", "2026-10-20T17:30:00-05:00", "2026-10-20T18:30:00-05:00", { timeZone: "America/Winnipeg", location: "Iron Image" }),
    ev("b", "Colten PT", "2026-10-24T09:00:00-05:00", "2026-10-24T10:00:00-05:00"),
    ev("c", "Marc PT", "2026-10-21T17:30:00-05:00", "2026-10-21T18:30:00-05:00", { appSessionId: "s1" }),
    ev("d", "Nico cancelled", "2026-10-19T12:00:00-05:00", "2026-10-19T13:00:00-05:00"),
    ev("e", "Marc + Colten", "2026-10-18T12:00:00-05:00", "2026-10-18T13:00:00-05:00"),
    ev("f", "Nico", "2026-10-17", "2026-10-18", { allDay: true }),
    ev("g", "Lunch", "2026-10-16T12:00:00-05:00", "2026-10-16T13:00:00-05:00"),
    ev("h", "Nico", "2026-10-15T07:00:00-05:00", "2026-10-15T08:00:00-05:00"),
  ];

  it("imports past ones as done and upcoming ones as booked, in the coach's time zone", () => {
    const { candidates } = planImport(events, [marc, colten, nico], { now, linkedEventIds: new Set(["h"]) });
    expect(candidates).toEqual([
      { eventId: "a", calendarId: "cal", clientId: "c", summary: "Colten PT", date: "2026-10-20", start: "17:30", end: "18:30", timezone: "America/Winnipeg", location: "Iron Image", past: true, training: true },
      { eventId: "b", calendarId: "cal", clientId: "c", summary: "Colten PT", date: "2026-10-24", start: "09:00", end: "10:00", timezone: "America/Winnipeg", location: null, past: false, training: true },
    ]);
  });

  it("leaves out what's already in the app, cancelled, all-day or names two clients", () => {
    const { skipped } = planImport(events, [marc, colten, nico], { now, linkedEventIds: new Set(["h"]) });
    expect(skipped.map((s) => [s.eventId, s.reason]).sort()).toEqual([
      ["c", "already_in_app"], ["d", "cancelled"], ["e", "two_clients"], ["f", "all_day"], ["h", "already_in_app"],
    ]);
  });

  it("leaves out a session the title says was missed", () => {
    const missed = [ev("m", "PT Session - Nicolas (❌missed - Jared was asleep)", "2026-07-03T07:00:00-05:00", "2026-07-03T08:00:00-05:00")];
    expect(planImport(missed, [nico], { now }).skipped.map((s) => s.reason)).toEqual(["cancelled"]);
  });
});
