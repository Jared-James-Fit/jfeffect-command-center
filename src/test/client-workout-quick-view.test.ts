import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPeekDay,
  defaultEntry,
  feedbackLine,
  jumpList,
  painLine,
  peekEntries,
  pickForClient,
  placeLine,
  relativeDay,
  sessionMinutes,
  stepEntry,
  trainingDaysLine,
  weekDays,
  weekLabel,
  weekStartIso,
  type PeekSchedule,
} from "@/lib/workout-peek";
import { arrangeStarred, pageOf, readWholeDirectory, starredModeFromSearch } from "@/lib/clients-directory-starred";
import { isMissingTable, sortStarred } from "@/lib/client-stars";
import { loggedLines, prescriptionLine } from "@/lib/workouts/training-words";
import * as pdf from "@/lib/workouts/workout-pdf";

const read = (f: string) => readFileSync(f, "utf8");
const TODAY = "2026-11-23"; // a Monday

/** Two blocks (the second hidden from the client), workouts dated around today, one instance-dated. */
function schedule(): PeekSchedule {
  return {
    blocks: [
      { id: "b1", name: "Block 2 — General Strength", client_visible: true },
      { id: "b2", name: "Draft peak", client_visible: false },
    ],
    weeks: [
      { id: "w1", week_index: 3, block_id: "b1" },
      { id: "w2", week_index: 4, block_id: "b1" },
      { id: "w9", week_index: 1, block_id: "b2" },
    ],
    days: [
      { id: "d-thu", week_id: "w1", day_index: 3, title: "Day 3 — Upper", scheduled_date: "2026-11-19" },
      { id: "d-fri", week_id: "w1", day_index: 4, subtitle: "Lower B", scheduled_date: "2026-11-20" },
      { id: "d-mon", week_id: "w2", day_index: 1, title: "Day 1 — Squat focus", scheduled_date: null },
      { id: "d-wed", week_id: "w2", day_index: 2, title: "Bench focus", scheduled_date: "2026-11-25" },
      { id: "d-nodate", week_id: "w2", day_index: 3, title: "Pull", scheduled_date: null },
      { id: "d-draft", week_id: "w9", day_index: 1, title: "Peak day", scheduled_date: "2026-11-23" },
    ],
    completions: [
      { day_id: "d-thu", completed_at: "2026-11-19T23:00:00Z", started_at: "2026-11-19T22:00:00Z" },
    ],
    scheduledInstances: [{ id: "i-mon", source_day_id: "d-mon", scheduled_date: "2026-11-23", order_index: 0 }],
  };
}

describe("which workouts the quick view steps through", () => {
  const entries = peekEntries(schedule(), TODAY);

  it("lists every dated workout the athlete can see, oldest first, as the Schedule reads it", () => {
    expect(entries.map((e) => e.dayId)).toEqual(["d-thu", "d-fri", "d-mon", "d-wed"]);
    expect(entries.map((e) => e.status)).toEqual(["done", "missed", "today", "upcoming"]);
    // a hidden draft and an undated workout are left out
    expect(entries.some((e) => e.dayId === "d-draft" || e.dayId === "d-nodate")).toBe(false);
  });

  it("names a workout as the athlete reads it and places it in its block", () => {
    const mon = entries.find((e) => e.dayId === "d-mon")!;
    expect(mon.name).toBe("Squat focus");
    expect(mon.instanceId).toBe("i-mon");
    expect(placeLine(mon)).toBe("Block 2 — General Strength · Week 4 of 4");
    expect(entries.find((e) => e.dayId === "d-fri")!.name).toBe("Lower B");
  });

  it("steps one workout at a time, and stops at either end", () => {
    expect(stepEntry(entries, entries[1].key, 1)?.dayId).toBe("d-mon");
    expect(stepEntry(entries, entries[0].key, -1)).toBeNull();
    expect(stepEntry(entries, entries[3].key, 1)).toBeNull();
  });

  it("lays a week out Monday to Sunday", () => {
    expect(weekStartIso("2026-11-25")).toBe("2026-11-23");
    expect(weekStartIso("2026-11-29")).toBe("2026-11-23");
    expect(weekStartIso("2026-11-23")).toBe("2026-11-23");
    const week = weekDays(entries, "2026-11-23");
    expect(week).toHaveLength(7);
    expect(week[0].entries.map((e) => e.dayId)).toEqual(["d-mon"]);
    expect(week[2].entries.map((e) => e.dayId)).toEqual(["d-wed"]);
    expect(weekLabel("2026-11-23")).toBe("Nov 23 – 29");
    expect(weekLabel("2026-11-30")).toBe("Nov 30 – Dec 6");
  });

  it("splits the jump list into what's coming and what's been", () => {
    const { recent, ahead } = jumpList(entries, TODAY);
    expect(ahead.map((e) => e.dayId)).toEqual(["d-mon", "d-wed"]);
    expect(recent.map((e) => e.dayId)).toEqual(["d-fri", "d-thu"]);
  });

  it("says a day the way a coach does", () => {
    expect(relativeDay(TODAY, TODAY)).toBe("Today");
    expect(relativeDay("2026-11-24", TODAY)).toBe("Tomorrow");
    expect(relativeDay("2026-11-22", TODAY)).toBe("Yesterday");
    expect(relativeDay("2026-11-25", TODAY)).toBe("Wed, Nov 25");
    expect(relativeDay("2027-01-04", TODAY)).toBe("Mon, Jan 4, 2027");
  });
});

describe("which workout it opens on", () => {
  const entries = peekEntries(schedule(), TODAY);

  it("today's, when there is one", () => {
    expect(defaultEntry(entries, TODAY)).toEqual({ key: "inst:i-mon", reason: "today" });
  });

  it("a workout still in progress from the last few days, before the next one", () => {
    const s = schedule();
    s.completions = [...(s.completions ?? []), { day_id: "d-fri", started_at: "2026-11-20T22:00:00Z" }];
    s.scheduledInstances = [];
    const list = peekEntries(s, TODAY);
    expect(defaultEntry(list, TODAY)).toEqual({ key: "day:d-fri", reason: "in_progress" });
  });

  it("else the next one this week, else the last one done or missed, saying why", () => {
    const s = schedule();
    s.scheduledInstances = [];
    expect(defaultEntry(peekEntries(s, TODAY), TODAY)).toEqual({ key: "day:d-wed", reason: "next" });
    s.days = s.days!.filter((d) => d.id !== "d-wed");
    expect(defaultEntry(peekEntries(s, TODAY), TODAY)).toEqual({ key: "day:d-fri", reason: "last" });
    expect(defaultEntry([], TODAY)).toBeNull();
  });

  it("of two today, the one not finished", () => {
    const s = schedule();
    s.days = [...s.days!, { id: "d-am", week_id: "w2", day_index: 0, title: "AM", scheduled_date: TODAY }];
    s.completions = [...(s.completions ?? []), { day_id: "d-am", completed_at: "2026-11-23T14:00:00Z" }];
    const list = peekEntries(s, TODAY);
    expect(defaultEntry(list, TODAY)?.key).toBe("inst:i-mon");
  });

  it("switching athletes: the workout last looked at for them, else the same day, else their default", () => {
    expect(pickForClient(entries, { remembered: "day:d-thu", todayIso: TODAY })).toEqual({ key: "day:d-thu", reason: null });
    expect(pickForClient(entries, { carryDate: "2026-11-25", todayIso: TODAY })).toEqual({ key: "day:d-wed", reason: null });
    // a day they don't train falls back to their own default
    expect(pickForClient(entries, { carryDate: "2026-11-24", todayIso: TODAY })).toEqual({ key: "inst:i-mon", reason: "today" });
    // a remembered workout that's gone (moved, deleted) falls back too
    expect(pickForClient(entries, { remembered: "day:gone", todayIso: TODAY })?.key).toBe("inst:i-mon");
  });
});

describe("one workout: the plan beside what was logged", () => {
  const src = {
    day: { id: "d-mon", title: "Day 1 — Squat focus", focus: "Squat", notes: "Belt on top sets", notes_client_visible: false, day_index: 1 },
    rows: [
      { id: "r2", day_id: "d-mon", sort_order: 2, exercises: { name: "Leg Press", equipment: "Machine", primary_muscle_group: "Quads", vimeo_url: "https://vimeo.com/1" }, sets: 3, reps_text: "10-12", rpe: "8", rest_seconds: 120 },
      { id: "r1", day_id: "d-mon", sort_order: 1, exercises: { name: "Competition Squat" }, purpose_label: "Top set", sets: 1, reps_text: "3", rpe: "8", rest_seconds: 240, rest_seconds_override: 300, notes: "Progress: Double progression." },
      { id: "r3", day_id: "d-mon", sort_order: 3, exercises: { name: "Treadmill Walk" }, cardio_target_id: "ct1", measurement_type: "time", duration_seconds: 600, sets: 1 },
    ],
    results: [
      { row_id: "r1", set_index: 1, entered_value: 405, entered_unit: "lb", actual_reps: 3, actual_rpe_num: 8, completed_at: "x", scheduled_workout_id: "i-mon" },
      { row_id: "r2", set_index: 1, entered_value: 300, entered_unit: "lb", actual_reps: 12, actual_rpe_num: 8, completed_at: "x", scheduled_workout_id: "i-mon" },
      { row_id: "r2", set_index: 2, entered_value: 300, entered_unit: "lb", actual_reps: 12, actual_rpe_num: 8, completed_at: "x", scheduled_workout_id: "i-mon" },
    ],
    completions: [
      { id: "c-old", day_id: "d-mon", scheduled_workout_id: null, completed_at: null },
      { id: "c-mon", day_id: "d-mon", scheduled_workout_id: "i-mon", started_at: "2026-11-23T23:00:00Z", completed_at: "2026-11-24T00:04:00Z", client_notes: "Felt strong" },
    ],
    notes: [{ row_id: "r2", content: "Seat on 5" }],
    feedback: { overall_rating: 4, session_rpe: 8, hit_target: "yes", pain: true, pain_area: "Knee", pain_level: 3 },
  };
  const day = buildPeekDay(src as any, { instanceId: "i-mon", weekIndex: 4 });

  it("keeps the coach's order, with the role, the plan as written and the sets as typed", () => {
    expect(day.exercises.map((e) => e.name)).toEqual(["Competition Squat", "Leg Press", "Treadmill Walk"]);
    const squat = day.exercises[0];
    expect(squat.role).toBe("Top set");
    // the rest the coach overrode is the rest shown
    expect(squat.plan).toBe("1 × 3 · RPE 8 · rest 5 min");
    expect(squat.logged).toEqual(["Set 1: 405 lb × 3 · RPE 8"]);
    expect(day.exercises[1].logged).toEqual(["Sets 1–2: 300 lb × 12 · RPE 8"]);
    expect(day.exercises[1].setsLogged).toBe(2);
  });

  it("drops the app's generated boilerplate from the coach's note, keeps the athlete's notes", () => {
    expect(day.exercises[0].coachNote).toBeNull();
    expect(day.exercises[1].athleteNotes).toEqual(["Seat on 5"]);
    expect(day.exercises[1].details).toEqual({ muscle: "Quads", equipment: "Machine", cues: null, demo: "https://vimeo.com/1" });
  });

  it("counts the lifts' sets, never the day's cardio", () => {
    expect(day.setsPlanned).toBe(4);
    expect(day.setsLogged).toBe(3);
    expect(day.exercises[2].cardio).toBe(true);
  });

  it("reads the session the entry stands for, its notes, the review and how long it took", () => {
    expect(day.completion?.id).toBe("c-mon");
    expect(day.athleteNote).toBe("Felt strong");
    expect(day.dayNote).toEqual({ text: "Belt on top sets", visible: false });
    expect(day.minutes).toBe(64);
    expect(feedbackLine(day.feedback)).toBe("4/5 · session RPE 8 · hit target");
    expect(painLine(day.feedback)).toBe("Knee · 3/10");
    expect(day.vsPlan?.setsDone).toBeGreaterThan(0);
  });

  it("a workout nothing's been logged on has no read against the plan", () => {
    const empty = buildPeekDay({ ...src, results: [], completions: [], feedback: null } as any, { instanceId: null, weekIndex: 4 });
    expect(empty.vsPlan).toBeNull();
    expect(empty.setsLogged).toBe(0);
    expect(empty.exercises[0].logged).toEqual([]);
  });

  it("a session time is only a session (never days, never negative)", () => {
    expect(sessionMinutes({ started_at: "2026-11-23T10:00:00Z", completed_at: "2026-11-23T11:05:00Z" })).toBe(65);
    expect(sessionMinutes({ started_at: "2026-11-20T10:00:00Z", completed_at: "2026-11-23T11:05:00Z" })).toBeNull();
    expect(sessionMinutes({ started_at: null, completed_at: "2026-11-23T11:05:00Z" })).toBeNull();
  });

  it("training days read in week order, whatever way they were saved", () => {
    expect(trainingDaysLine(["friday", "Mon", "wed"])).toBe("Mon · Wed · Fri");
    expect(trainingDaysLine([])).toBeNull();
    expect(trainingDaysLine(null)).toBeNull();
  });

  it("uses the training PDF's own words, which the PDF still exports", () => {
    expect(pdf.prescriptionLine).toBe(prescriptionLine);
    expect(pdf.loggedLines).toBe(loggedLines);
    // the drawer's code never loads the PDF kit
    const peek = read("src/lib/workout-peek.ts");
    expect(peek).not.toMatch(/workout-pdf|pdf\/kit|jspdf/);
    expect(read("src/lib/workouts/training-words.ts")).not.toMatch(/pdf\/kit|jspdf/);
  });
});

describe("the Starred filter", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const stars = new Set(["c", "a"]);

  it("reads only and first from the address, nothing else", () => {
    expect(starredModeFromSearch("only")).toBe("only");
    expect(starredModeFromSearch("first")).toBe("first");
    expect(starredModeFromSearch("all")).toBeNull();
    expect(starredModeFromSearch(undefined)).toBeNull();
  });

  it("only: the starred in the chosen sort; first: them on top, everyone else after, each in that sort", () => {
    expect(arrangeStarred(rows, stars, "only").map((r) => r.id)).toEqual(["a", "c"]);
    expect(arrangeStarred(rows, stars, "first").map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("pages the arranged list", () => {
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(pageOf([1, 2, 3], 9, 2)).toEqual([]);
  });

  it("reads the whole list page by page at the function's maximum", async () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ id: String(i) }));
    const asked: Array<[number, number]> = [];
    const res = await readWholeDirectory(async (page, size) => {
      asked.push([page, size]);
      return { rows: all.slice((page - 1) * size, page * size), total: all.length, counts: { all: 230 } };
    });
    expect(asked).toEqual([[1, 100], [2, 100], [3, 100]]);
    expect(res.rows).toHaveLength(230);
    expect(res.counts).toEqual({ all: 230 });
  });

  it("stars sort by name, and a missing table just means no stars yet", () => {
    const list = sortStarred([
      { id: "1", full_name: "zed", profile_picture_url: null, starred_at: "" },
      { id: "2", full_name: null, profile_picture_url: null, starred_at: "" },
      { id: "3", full_name: "Amy", profile_picture_url: null, starred_at: "" },
    ]);
    expect(list.map((s) => s.id)).toEqual(["3", "1", "2"]);
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.staff_client_stars' in the schema cache" })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("the Clients page wiring", () => {
  const page = read("src/routes/_authenticated/admin/clients.index.tsx");
  const row = read("src/components/clients/client-row.tsx");
  const drawer = read("src/components/clients/workout-quick-view/quick-view.tsx");
  const data = read("src/components/clients/workout-quick-view/data.ts");

  it("the dumbbell is a compact icon with a tooltip and a label, opening the drawer instead of leaving the page", () => {
    expect(row).toContain('size="icon"');
    expect(row).toContain("<Dumbbell");
    expect(row).not.toContain('<span className="hidden xl:inline">Workout</span>');
    expect(row).toContain("aria-label={onQuickView ? `Quick view: ${who}'s workout`");
    expect(row).toContain('<IconTip label={onQuickView ? "Workout quick view"');
    expect(page).toContain("onQuickView={openPeek}");
  });

  it("the drawer is the page's, addressed by ?peek= (Back and Esc close it), loaded on first use, and never part of the directory's key", () => {
    expect(page).toContain('lazyWithRetry(() => import("@/components/clients/workout-quick-view/quick-view")');
    expect(page).toContain("rawSearch?.peek");
    expect(page).toContain("router.history.back()");
    // stars and the drawer never refetch the list
    expect(page).toContain("const { kind: _kind, starred: _starred, ...clientSearch } = search;");
    expect(page).not.toMatch(/peek:\s+fallback\(/);
  });

  it("starred: a chip in the rail, a choice in the Filters sheet, the list read whole only while it's on", () => {
    expect(read("src/components/clients/client-toolbar.tsx")).toContain("data-starred-chip");
    expect(read("src/components/clients/client-filter-sheet.tsx")).toContain("data-filter-starred");
    expect(page).toContain("enabled: !!starredMode,");
    expect(page).toContain("enabled: !starredMode,");
  });

  it("the drawer shares the Training tab's schedule cache and the Health card's read, and only reads", () => {
    expect(data).toContain('["client-schedule", clientId]');
    expect(drawer).toContain("healthProfileKey(clientId)");
    expect(data).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // logging and editing are a deliberate tap away, as the coach's own permissions allow
    expect(drawer).toContain("clientWorkoutHref(entry.date)");
    expect(drawer).toContain('to="/admin/blocks/$blockId"');
    expect(drawer).toContain("!viewOnly && entry.blockId");
  });

  it("keys: ← → workouts, [ ] athletes, never while typing", () => {
    expect(drawer).toContain('e.key === "ArrowLeft"');
    expect(drawer).toContain('e.key === "["');
    expect(drawer).toContain("input, textarea, select");
  });

  it("stars are a coach's own, on their account", () => {
    const sql = read("supabase/migrations/20270519090000_staff_client_stars.sql");
    expect(sql).toContain("user_id = (SELECT auth.uid())");
    expect(sql).toContain("client_id IN (SELECT public.coached_client_ids())");
    expect(sql).not.toMatch(/FOR UPDATE/);
  });
});
