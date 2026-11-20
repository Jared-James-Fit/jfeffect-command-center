import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UPCOMING_MEET_DAYS, athleteMeets, coachingAthletes, meetLine } from "@/lib/meet-board";

// Nov 19 2026: the live records when Jared's Nationals were missing from the card.
const today = "2026-11-19";
const preps = [
  { client_id: "alyssa", title: "Alyssa Amanda — Total Fortification Meet Prep", event_name: "Total Fortification", event_date: "2026-12-05", status: "Active", archived: false },
  { client_id: "shaina", title: "Shaina Sagar — Total Fortification Meet Prep", event_name: "Total Fortification", event_date: "2026-12-05", status: "Active", archived: false },
  { client_id: "jared", title: "Jared McIntyre — 2027 Canadian Nationals Prep", event_name: "2027 Canada Powerlifting National Championships", event_date: "2027-02-08", status: "Active", archived: false },
];
const plans = [
  {
    client_id: "alyssa",
    status: "approved",
    created_at: "2026-11-18T00:17:56Z",
    plan: { primary: { name: "TheOne", level: "Local Meet", date: "2027-03-06", registered: false }, meets: [{ name: "TheOne", date: "2027-03-06", registered: false }] },
  },
];

describe("Upcoming meets: who and which meets", () => {
  it("looks 16 weeks ahead, so a national championship 11 weeks out shows (it was cut at 8)", () => {
    expect(UPCOMING_MEET_DAYS).toBe(112);
    const m = athleteMeets({ preps, plans, today });
    expect(m.get("jared")?.map((x) => [x.name, x.days])).toEqual([["2027 Canada Powerlifting National Championships", 81]]);
    expect(athleteMeets({ preps, plans, today, horizonDays: 56 }).get("jared")).toBeUndefined();
  });

  it("adds the approved competition plan's meets, one per date, soonest first", () => {
    const alyssa = athleteMeets({ preps, plans, today }).get("alyssa")!;
    expect(alyssa.map((x) => x.date)).toEqual(["2026-12-05", "2027-03-06"]);
    expect(alyssa[1]).toMatchObject({ name: "TheOne", registered: false });
    expect(meetLine(alyssa[1])).toBe("TheOne · Mar 6 · not registered");
    expect(meetLine(alyssa[0])).toBe("Total Fortification · Dec 5");
  });

  it("a plan meet on a meet prep's date is that meet: the prep's name, the plan's registration", () => {
    const m = athleteMeets({
      preps: [{ client_id: "a", event_name: "Provincials", event_date: "2027-01-10", status: "Planned" }],
      plans: [{ client_id: "a", status: "approved", plan: { primary: { name: "MB Provs", date: "2027-01-10", registered: true } } }],
      today,
    }).get("a")!;
    expect(m).toEqual([{ name: "Provincials", date: "2027-01-10", days: 52, registered: true }]);
  });

  it("leaves out past, undated, archived, finished and unapproved meets, and older plans", () => {
    const m = athleteMeets({
      preps: [
        { client_id: "a", event_name: "Past", event_date: "2026-11-01", status: "Active" },
        { client_id: "a", event_name: "No date", event_date: null, status: "Active" },
        { client_id: "a", event_name: "Archived", event_date: "2026-12-20", status: "Active", archived: true },
        { client_id: "a", event_name: "Done", event_date: "2026-12-21", status: "Completed" },
      ],
      plans: [
        { client_id: "a", status: "pending", plan: { primary: { name: "Not signed off", date: "2026-12-22" } } },
        { client_id: "a", status: "approved", created_at: "2026-10-01", plan: { primary: { name: "Old plan", date: "2026-12-23" } } },
        { client_id: "a", status: "approved", created_at: "2026-11-01", plan: { primary: { name: "New plan", date: "2026-12-24" } } },
      ],
      today,
    }).get("a")!;
    expect(m.map((x) => x.name)).toEqual(["New plan"]);
  });

  it("every coaching client counts, the coach's own athlete account included; archived and self-serve don't", () => {
    const who = coachingAthletes([
      { id: "jared", full_name: "Jared McIntyre", service_tier: "coaching", archived: false },
      { id: "gone", full_name: "Archived", service_tier: "coaching", archived: true },
      { id: "member", full_name: "Member", service_tier: "self_serve", archived: false },
    ]);
    expect([...who.keys()]).toEqual(["jared"]);
  });

  it("the card reads both sources and names later meets", () => {
    const card = readFileSync("src/components/forms/meet-readiness-card.tsx", "utf8");
    expect(card).toContain('.from("athlete_competition_plans")');
    expect(card).toContain('.in("status", ["Active", "Planned"])');
    expect(card).toContain("data-meet-later");
    expect(card).not.toContain("is_staff");
  });
});
