import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalendarItem } from "@/lib/calendar-sources";
import { chipParts, chipTime, itemDetailLines, personName, rowLines, shortName } from "@/lib/calendar-labels";
import {
  CALENDAR_PREFS_CACHE_KEY,
  LEGACY_GOOGLE_KEY,
  pickNewer,
  readCachedPrefs,
  sanitizePrefs,
} from "@/lib/calendar-prefs";
import {
  addMonthsISO,
  dayTag,
  homeRange,
  isCurrentPeriod,
  monthGridDays,
  periodLabel,
  shiftAnchor,
} from "@/lib/home-calendar";

/** A wall-clock time today on this machine, as an instant (labels read the device clock). */
const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m).toISOString();

const session: CalendarItem = {
  id: "pt:1",
  kind: "pt_session",
  date: "2026-11-18",
  startsAt: at(12),
  endsAt: at(13),
  title: "1:1 Training",
  location: "800 Vaughan Ave, Selkirk, MB",
  status: "Scheduled",
  clientName: "Colten Murray",
};
const google: CalendarItem = {
  id: "gcal:1",
  kind: "google_event",
  date: "2026-11-18",
  startsAt: at(9),
  endsAt: at(17),
  title: "Work - Fionna",
  clientName: "Google Calendar",
};

describe("who and when on every coach calendar", () => {
  it("a session or appointment is with someone; Google's source label never counts as a person", () => {
    expect(personName(session)).toBe("Colten Murray");
    expect(personName({ ...session, kind: "appointment", clientName: "Devin Lee" })).toBe("Devin Lee");
    expect(personName(google)).toBeNull();
    expect(personName({ ...session, kind: "event" })).toBeNull();
    expect(personName({ ...session, clientName: "  " })).toBeNull();
  });

  it("names and times fit a month cell", () => {
    expect(shortName("Nicolas Galli")).toBe("Nicolas G.");
    expect(shortName("Marc de la Cruz")).toBe("Marc C.");
    expect(shortName("Cher")).toBe("Cher");
    expect(chipTime(at(10))).toBe("10a");
    expect(chipTime(at(17, 30))).toBe("5:30p");
    expect(chipTime(at(12))).toBe("12p");
    expect(chipTime(at(0, 15))).toBe("12:15a");
    expect(chipTime(null)).toBe("");
  });

  it("a month chip says when and who (coach), or when and what (client, Google)", () => {
    expect(chipParts(session, true)).toEqual({ time: "12p", label: "Colten M." });
    expect(chipParts(session, false)).toEqual({ time: "12p", label: "1:1 Training" });
    expect(chipParts(google, true)).toEqual({ time: "9a", label: "Work - Fionna" });
    expect(chipParts({ ...session, startsAt: null }, true).time).toBe("");
  });

  it("the hover card has the full name, the time and length, what, where and anything unusual", () => {
    const lines = itemDetailLines({ ...session, status: "Missed" }, true);
    expect(lines[0]).toBe("Colten Murray");
    expect(lines[1]).toMatch(/12.1 PM \(1 hr\)/);
    expect(lines[2]).toBe("1:1 Training · PT Session");
    expect(lines).toContain("800 Vaughan Ave");
    expect(lines).toContain("Missed");
    expect(itemDetailLines({ ...session, startsAt: null }, true)[1]).toBe("All day");
  });

  it("a list row leads with the person, then when, what and where", () => {
    const { title, meta } = rowLines(session, true);
    expect(title).toBe("Colten Murray");
    expect(meta).toMatch(/^12.1 PM · 1:1 Training · 800 Vaughan Ave$/);
    expect(rowLines(session, false).title).toBe("1:1 Training");
    expect(rowLines(google, true)).toEqual({ title: "Work - Fionna", meta: expect.not.stringContaining("Google Calendar") });
  });
});

describe("calendar choices are remembered on the account", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  beforeEach(() => {
    store.clear();
    (globalThis as any).window = { localStorage: fake };
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("keeps only values the app understands", () => {
    expect(sanitizePrefs({ boardView: "week", homeView: "month", includeGoogle: true, junk: 1 })).toEqual({
      boardView: "week",
      homeView: "month",
      includeGoogle: true,
    });
    expect(sanitizePrefs({ boardView: "year", homeView: "agenda", includeGoogle: "yes" })).toEqual({});
    expect(sanitizePrefs(null)).toEqual({});
  });

  it("the newer of device and account wins (account on a tie or when the device never chose)", () => {
    const older = { boardView: "week" as const, updatedAt: "2026-11-15T10:00:00Z" };
    const newer = { boardView: "day" as const, updatedAt: "2026-11-15T11:00:00Z" };
    expect(pickNewer(older, newer)).toBe(newer);
    expect(pickNewer(newer, older)).toBe(newer);
    expect(pickNewer({}, older)).toBe(older);
    expect(pickNewer(newer, null)).toBe(newer);
  });

  it("the device copy is per account, and the old Google switch carries over", () => {
    store.set(CALENDAR_PREFS_CACHE_KEY, JSON.stringify({ owner: "u1", prefs: { boardView: "week", includeGoogle: true } }));
    expect(readCachedPrefs("u1")).toEqual({ boardView: "week", includeGoogle: true });
    // Someone else signs in on the same device: none of u1's choices.
    expect(readCachedPrefs("u2")).toEqual({});
    store.clear();
    store.set(LEGACY_GOOGLE_KEY, "1");
    expect(readCachedPrefs("u1")).toEqual({ includeGoogle: true });
  });

  it("the table is own-row only", () => {
    const sql = readFileSync("supabase/migrations/20270326090000_calendar_view_prefs.sql", "utf8");
    expect(sql).toContain("enable row level security");
    expect(sql.match(/user_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/user_preferences\s+add/i);
  });
});

describe("the Home card's Day / Week / Month / List", () => {
  it("a month is whole Monday–Sunday weeks", () => {
    // November 2026 starts on a Sunday and ends on a Monday: 6 rows.
    const nov = monthGridDays("2026-11-18");
    expect(nov[0]).toBe("2026-10-26");
    expect(nov[nov.length - 1]).toBe("2026-12-06");
    expect(nov.length).toBe(42);
    // February 2027 starts on a Monday: 4 rows.
    const feb = monthGridDays("2027-02-10");
    expect(feb[0]).toBe("2027-02-01");
    expect(feb.length).toBe(28);
  });

  it("months step without skipping (Jan 31 → Feb)", () => {
    expect(addMonthsISO("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsISO("2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftAnchor("month", "2026-11-18", 1)).toBe("2026-12-01");
    expect(shiftAnchor("week", "2026-11-18", -1)).toBe("2026-11-11");
    expect(shiftAnchor("list", "2026-11-18", 1)).toBe("2026-11-25");
  });

  it("each view loads just its days", () => {
    expect(homeRange("day", "2026-11-18", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-30" });
    expect(homeRange("week", "2026-11-18", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(homeRange("list", "2026-11-18", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(homeRange("month", "2026-11-18", "2026-11-18")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
  });

  it("labels say which week or month, and Today shows only away from it", () => {
    expect(periodLabel("week", "2026-11-18", "2026-11-18")).toMatch(/Nov 16 . 22/);
    expect(periodLabel("week", "2026-12-01", "2026-11-18")).toMatch(/Nov 30 . Dec 6/);
    expect(periodLabel("month", "2026-11-18", "2026-11-18")).toBe("November");
    expect(periodLabel("month", "2027-01-05", "2026-11-18")).toBe("January 2027");
    expect(isCurrentPeriod("week", "2026-11-20", "2026-11-18")).toBe(true);
    expect(isCurrentPeriod("list", "2026-11-25", "2026-11-18")).toBe(false);
    expect(periodLabel("list", "2026-11-18", "2026-11-18")).toBe(periodLabel("week", "2026-11-18", "2026-11-18"));
    expect(isCurrentPeriod("month", "2026-12-01", "2026-11-18")).toBe(false);
    expect(dayTag("2026-11-18", "2026-11-18")).toBe("Today");
    expect(dayTag("2026-11-19", "2026-11-18")).toBe("Tmrw");
    expect(dayTag("2026-11-20", "2026-11-18")).toMatch(/^Fri 20$/);
    expect(dayTag("2026-11-17", "2026-11-18")).toMatch(/^Tue 17$/);
  });

  it("List is the week's bookings one line each, by day, under the week's strip (every account's card)", async () => {
    const shared = readFileSync("src/components/schedule/home-calendar-views.tsx", "utf8");
    expect(shared).toContain('{ id: "list", label: "List" }');
    expect(shared).toContain("dayText={firstOfDay ? dayTag(r.date, today) : \"\"}");
    expect(shared).toContain("data-home-list");
    for (const f of ["src/components/admin-calendar/dashboard-schedule-card.tsx", "src/components/home/upcoming-schedule-card.tsx"]) {
      const card = readFileSync(f, "utf8");
      expect(card, f).toContain("<AgendaWeek today={today} anchor={anchor} onSelect={openDay} dots={(d) => dotsByDay.get(d) ?? []} />");
      expect(card, f).toContain("<HomeWeekList");
      expect(card, f).toContain("<HomeViewBar");
      expect(card, f).toContain("<HomeMonth anchor={anchor} today={today} onPick={openDay}");
    }
    // Remembered like the other tabs; an older value or junk falls back to nothing.
    const { sanitizePrefs } = await import("@/lib/calendar-prefs");
    expect(sanitizePrefs({ homeView: "list" })).toEqual({ homeView: "list" });
    expect(sanitizePrefs({ homeView: "agenda" })).toEqual({});
  });

  it("the period is never cut short: it takes its own line when the switch leaves no room", () => {
    const dash = readFileSync("src/components/schedule/home-calendar-views.tsx", "utf8");
    expect(dash).toContain('<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">');
    expect(dash).toContain('<span className="mr-auto whitespace-nowrap text-[13px] font-semibold tabular-nums" aria-live="polite">{label}</span>');
    expect(dash).not.toMatch(/truncate text-center text-xs font-semibold tabular-nums">\{label\}/);
  });

  it("the card and the Calendar page share one remembered choice, for the coach and every client", () => {
    const dash = readFileSync("src/components/admin-calendar/dashboard-schedule-card.tsx", "utf8");
    const panel = readFileSync("src/components/admin-calendar/board-panel.tsx", "utf8");
    const client = readFileSync("src/components/home/upcoming-schedule-card.tsx", "utf8");
    const page = readFileSync("src/routes/_authenticated/portal/calendar.tsx", "utf8");
    for (const src of [dash, panel]) expect(src).toContain("useCalendarPrefs()");
    // A coach previewing a client picks views for that visit only, never saved to anyone's account.
    expect(client).toContain("const { prefs, setPrefs } = useCalendarPrefs({ local: previewing });");
    expect(page).toContain("const { prefs, setPrefs } = useCalendarPrefs({ local: isImpersonating });");
    for (const src of [dash, client]) {
      expect(src).toContain('const savedView: HomeView = prefs.homeView ?? "day";');
      // A day tapped in Week or Month opens for the visit; only the tabs are remembered.
      expect(src).toContain('const view: HomeView = dayFocus ? "day" : savedView;');
    }
    expect(readFileSync("src/components/schedule/home-calendar-views.tsx", "utf8")).toContain('aria-label="Calendar view"');
    for (const src of [dash, panel, client, page]) expect(src).not.toContain("localStorage");
  });

  it("the month grid's chips show time and who, with the details on hover", () => {
    const board = readFileSync("src/components/calendar/calendar-board.tsx", "utf8");
    expect(board).toContain("const { time, label } = chipParts(it, showClientName);");
    expect(board).toContain("<TooltipProvider");
    expect(board).toContain("<TooltipContent");
  });
});
