import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trainedLabel } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261023150000_community_crew_activity.sql");
const list = read("src/components/community/crew-list.tsx");

describe("when someone last trained", () => {
  const now = new Date(2026, 9, 9, 13, 0);
  it("today, yesterday, then the weekday", () => {
    expect(trainedLabel(new Date(2026, 9, 9, 6, 0).toISOString(), now)).toBe("Trained today");
    expect(trainedLabel(new Date(2026, 9, 8, 22, 0).toISOString(), now)).toBe("Trained yesterday");
    expect(trainedLabel(new Date(2026, 9, 6, 9, 0).toISOString(), now)).toMatch(/^Trained \w+$/);
  });
  it("nothing for a quiet stretch (more than a week) or no sessions", () => {
    expect(trainedLabel(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toBeNull();
    expect(trainedLabel(null, now)).toBeNull();
  });
});

describe("the crew list is about training, not posting", () => {
  it("the server only shares a last session from the last 7 days, and this week's days", () => {
    expect(sql).toContain("max(pc.completed_at) FILTER (WHERE pc.completed_at > now() - interval '7 days') AS trained_at");
    expect(sql).toContain("FILTER (WHERE pc.completed_at >= v_week)");
  });
  it("training now first, then the coach, then whoever trained most recently", () => {
    expect(sql).toContain("ORDER BY s.live DESC, (public.community_author(m.user_id)->>'is_coach')::boolean DESC, t.trained_at DESC NULLS LAST");
  });
  it("still members only, and the same people as before (linked accounts, you excluded)", () => {
    expect(sql).toContain("IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed'");
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)");
  });
  it("never says 'No posts yet'; a quiet member gets their bio or when they started", () => {
    expect(list).not.toContain("No posts yet");
    expect(list).toContain('trainingSinceLabel(m.training_since) || "In the JF crew"');
    expect(list).toContain("{days.length > 0 && <WeekDots days={days} today={today} />}");
  });
});
