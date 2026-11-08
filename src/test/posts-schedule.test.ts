import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRecent, buildSchedule, clockText, dayLabel, localParts, nextUp, type ScheduleSource } from "@/lib/posts-schedule";
import { manageFromHash } from "@/components/community/posts-schedule";

const read = (f: string) => readFileSync(f, "utf8");

// Sunday Nov 8 2026; Manitoba is UTC-5 from Nov 1, 2026 (7 am = 12:00Z)
const base: ScheduleSource = {
  today: "2026-11-08",
  lessonMode: "auto",
  insightsOn: true,
  lessons: [
    { id: "l-mon", day: "2026-11-09", post_at: "2026-11-09T22:00:00Z", status: "planned", post_id: null, item: { title: "Why your squat stalls" } },
    { id: "l-thu", day: "2026-11-12", post_at: "2026-11-12T22:00:00Z", status: "approved", post_id: null, item: { title: "Bracing cues" } },
    { id: "l-skip", day: "2026-11-16", post_at: "2026-11-16T22:00:00Z", status: "skipped", post_id: null, item: { title: "Skipped one" } },
    { id: "l-old", day: "2026-11-05", post_at: "2026-11-05T22:00:00Z", status: "posted", post_id: "p-lesson", item: { title: "Rest days" } },
  ],
  insights: [
    { id: "i-7", day: "2026-11-07", status: "posted", line: "long sessions are fine", picture: "a/b.png", post_id: "p-ins", archived: false },
    { id: "i-8", day: "2026-11-08", status: "ready", line: "i think rest days get a bad rap\nmore", picture: "a/c.png", post_id: null },
    { id: "i-13", day: "2026-11-13", status: "planned", line: null, picture: null, regen: "full", working: true, post_id: null },
    { id: "i-9", day: "2026-11-09", status: "skipped", line: null, picture: null, post_id: null },
  ],
  seriesOn: ["tuesday_tips"],
  nextItems: { tuesday_tips: { body: "warm up sets count as practice\nsecond line" } },
  history: [
    { id: "p-wins", series: "wednesday_wins", created_at: "2026-11-04T17:00:00Z", caption: "50 PRs last week" },
    { id: "p-lesson", series: "lesson", created_at: "2026-11-05T22:00:00Z", caption: "rest days caption" },
  ],
  holidays: [{ key: "remembrance", name: "Remembrance Day", date: "2026-11-11", body: "happy…", posted: false }],
  birthdays: [{ id: "b-1", post_at: "2026-11-14T13:00:00Z", status: "ready", post_id: null, person: { name: "Marc" } }],
  birthdaysNext: [
    { client_id: "c-1", birthday: "2026-11-14", person: { name: "Marc" } },
    { client_id: "c-2", birthday: "2026-11-19", person: { name: "Nicole" } },
  ],
};

describe("Crew → Posts: one schedule of every coach post (Nov 8 2026)", () => {
  it("lists every kind, day by day in the order they go out, for two weeks", () => {
    const days = buildSchedule(base);
    expect(days.map((d) => d.day)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(days[0]).toMatchObject({ label: "Today", items: [{ kind: "insight", time: "7 am", status: "ready", title: "i think rest days get a bad rap", picture: "a/c.png" }] });
    expect(days[1].label).toBe("Tomorrow");
    // Monday: the lesson at 5 pm (the skipped Insight isn't listed)
    expect(days[1].items.map((i) => [i.kind, i.time, i.title])).toEqual([["lesson", "5 pm", "Why your squat stalls"]]);
    // Tuesday's tip (on) at noon with the next library item's first line; Wins always on Wednesday
    expect(days[2].items[0]).toMatchObject({ kind: "tip", time: "12 pm", title: "warm up sets count as practice", status: "ready", ref: { series: "tuesday_tips" } });
    expect(days[3].items.map((i) => [i.kind, i.time])).toEqual([["holiday", "9 am"], ["wins", "12 pm"]]);
    expect(days[3].items[1]).toMatchObject({ status: "from_logs", title: "Last week's wins, from the logs" });
    // an Insight being made says so
    expect(days[5].items[0]).toMatchObject({ kind: "insight", status: "making", title: "Being written and drawn" });
    // a birthday already written shows once (not again as "written the evening before"); one not written yet is planned
    expect(days[6].items.map((i) => [i.kind, i.time, i.title, i.status])).toEqual([["birthday", "8 am", "Marc's birthday", "ready"]]);
    expect(days[9].items[0]).toMatchObject({ title: "Nicole's birthday · written the evening before", status: "planned", ref: { birthdayClient: "c-2" } });
    // the second week's tip has no library preview of its own (only the next one is known)
    expect(days[7].items[0]).toMatchObject({ kind: "tip", title: "The next one from its library" });
    // a skipped lesson is left out
    expect(days.flatMap((d) => d.items).some((i) => i.ref.lesson === "l-skip")).toBe(false);
  });

  it("switched-off series and Insights aren't listed; Wins always is", () => {
    const days = buildSchedule({ ...base, seriesOn: [], insightsOn: false });
    const kinds = days.flatMap((d) => d.items.map((i) => i.kind));
    expect(kinds).not.toContain("tip");
    expect(kinds).not.toContain("insight");
    expect(kinds.filter((k) => k === "wins")).toHaveLength(2);
  });

  it("marks what needs him and what's paused, and finds what's next", () => {
    const review = buildSchedule({ ...base, lessonMode: "review" }).flatMap((d) => d.items);
    expect(review.find((i) => i.ref.lesson === "l-mon")?.status).toBe("needs_ok");
    expect(review.find((i) => i.ref.lesson === "l-thu")?.status).toBe("ready");
    const paused = buildSchedule({ ...base, paused: true }).flatMap((d) => d.items);
    expect(paused.every((i) => i.status === "paused" || i.status === "posted")).toBe(true);
    const days = buildSchedule(base);
    // before 7 am today, today's Insight is next; after it, tomorrow's lesson
    expect(nextUp(days, { day: "2026-11-08", minute: 6 * 60 })?.key).toBe("insight:i-8");
    expect(nextUp(days, { day: "2026-11-08", minute: 8 * 60 })?.key).toBe("lesson:l-mon");
  });

  it("a series day that already went out shows as posted, with its post", () => {
    const days = buildSchedule({ ...base, today: "2026-11-04", history: [{ id: "p-wins", series: "wednesday_wins", created_at: "2026-11-04T17:00:00Z", caption: "50 PRs last week" }] });
    expect(days[0].items.find((i) => i.kind === "wins")).toMatchObject({ status: "posted", postId: "p-wins", title: "50 PRs last week" });
  });

  it("Recently out: the last week, newest first, one row per post", () => {
    const recent = buildRecent(base);
    expect(recent.map((r) => [r.kind, r.day, r.postId])).toEqual([
      ["insight", "2026-11-07", "p-ins"],
      ["lesson", "2026-11-05", "p-lesson"],
      ["wins", "2026-11-04", "p-wins"],
    ]);
    expect(recent[1].title).toBe("Rest days");
  });

  it("reads the coach's clock", () => {
    expect(localParts("2026-11-09T12:00:00Z")).toEqual({ day: "2026-11-09", minute: 7 * 60 });
    expect(clockText(7 * 60)).toBe("7 am");
    expect(clockText(12 * 60)).toBe("12 pm");
    expect(clockText(19 * 60 + 30)).toBe("7:30 pm");
    expect(dayLabel("2026-11-10", "2026-11-08")).toBe("Tue, Nov 10");
  });

  it("Manage pages live in the hash, so Back returns to the schedule; old birthday links open Birthdays", () => {
    expect(manageFromHash("#tab=posts")).toEqual({ manage: null, open: null });
    expect(manageFromHash("#tab=posts&manage=lessons")).toEqual({ manage: "lessons", open: null });
    expect(manageFromHash("#tab=posts&manage=series&open=tuesday_tips")).toEqual({ manage: "series", open: "tuesday_tips" });
    expect(manageFromHash("#tab=posts&manage=nope").manage).toBe(null);
    expect(manageFromHash("#birthday=6f9619ff-8b86-d011-b42d-00cf4fc964ff").manage).toBe("birthdays");
    expect(manageFromHash("#tab=birthdays").manage).toBe("birthdays");
  });

  it("the tab is the schedule, then Recently out, then Manage; posting on / paused is said once, at the top", () => {
    const tab = read("src/components/community/posts-schedule.tsx");
    expect(read("src/components/community/admin-community-hub.tsx")).toContain("<CoachPostsTab />");
    expect(tab).toContain('aria-label="Coach posts on"');
    expect(read("src/components/community/coach-lessons.tsx")).not.toContain('aria-label="Coach posts on"');
    expect(tab).toContain('{which === "lessons" && <CoachLessons />}');
    expect(tab).toContain('{which === "insights" && <DailyPicturesCard />}');
    expect(tab).toContain('{which === "series" && <CoachWeeklyPosts focus={open} />}');
    expect(tab).toContain("<UpcomingBirthdaysWidget windowDays={30} hideWhenEmpty />");
    // Athlete Insights have their own page, not a card inside the daily series
    expect(read("src/components/community/coach-weekly-posts.tsx")).not.toContain("<DailyPicturesCard />");
  });
});
