import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickWorkoutWin } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261029120000_community_pulse.sql");
const base = { prs: [], pr_count: 0, month_sessions: 2, week_sessions: 1, top_lift: null, working_sets: 14, duration_min: 39 } as any;

describe("Pulse: a finished workout posts itself, with its real win", () => {
  it("a PR leads (the best, and how many)", () => {
    const w = pickWorkoutWin({ ...base, pr_count: 2, prs: [{ exercise_name: "Hip Thrust", reps: 8, load_kg: 102, scope: "atpr" }] }, "lb");
    expect(w).toMatchObject({ kind: "pr", label: "All-time PR · 2 PRs", headline: "Hip Thrust", detail: "225 lb × 8" });
  });
  it("then a monthly milestone, then 3+ sessions this week, then the top set, else the work done; never made up", () => {
    expect(pickWorkoutWin({ ...base, month_sessions: 10 }, "lb")).toMatchObject({ kind: "month", headline: "10th session this month" });
    expect(pickWorkoutWin({ ...base, month_sessions: 7, week_sessions: 3 }, "lb")).toMatchObject({ kind: "week", headline: "3rd session this week" });
    expect(pickWorkoutWin({ ...base, top_lift: { exercise_name: "Squat", reps: 5, load_kg: 140 } }, "kg")).toMatchObject({ kind: "top", headline: "Squat", detail: "140 kg × 5" });
    expect(pickWorkoutWin(base, "lb")).toMatchObject({ kind: "done", headline: "14 working sets" });
    expect(pickWorkoutWin({ ...base, month_sessions: 11, week_sessions: 2 }, "lb").kind).toBe("done");
  });
  it("one post per session: it fills the session's finish slot (sharing later fills that same post in)", () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.completion_id = NEW.id) THEN RETURN NULL; END IF;");
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
    expect(sql).toContain("IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN RETURN NULL; END IF;");
    expect(sql).toContain("auto_shared = false,");
  });
  it("respects privacy: the client's switch, members only, recent sessions only, their hide-weights choice", () => {
    expect(sql).toContain("IF NOT coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = c.user_id), true) THEN RETURN NULL; END IF;");
    expect(sql).toContain("AND coalesce(cl.portal_access_disabled, false) = false;");
    expect(sql).toContain("IF NEW.completed_at < now() - interval '2 days' THEN RETURN NULL; END IF;");
    expect(sql).toContain("coalesce(v_hide, false)");
    expect(read("src/components/community/profile-view.tsx")).toContain("Post my finished workouts to the crew automatically");
  });
  it("no share points for a post nobody shared; never blocks finishing a workout", () => {
    expect(sql).toContain("and not cp.auto_shared");
    expect(sql).toContain("RAISE WARNING 'community_pulse_on_completion: %', sqlerrm;");
  });
  it("the crew can give props in one tap (not on your own)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const canProps = !!onReact && !post.is_mine;");
    expect(card).toContain('onReact?.(post, post.my_reaction ? null : "fire");');
    expect(card).toContain("<PulseHero post={post} stats={s} unit={unit} onReact={onReact} />");
  });
});

import { HOME_CREW_PULSES, PULSE_STRIP_ROWS, feedLayout, homeCrewPosts } from "@/lib/community";
describe("Pulse never swamps the feed", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
  const pulse = (id: string, h: number) => ({ id, created_at: at(h), auto: true, stats: {} });
  const own = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: {} });
  it("a day's Pulses fold into one strip where the newest was; people's own posts keep their place", () => {
    const out = feedLayout([pulse("p1", 20), own("a", 19), pulse("p2", 18), pulse("p3", 17), own("b", 16)]);
    expect(out.map((e) => (e.kind === "post" ? e.post.id : e.posts.map((p) => p.id).join("+")))).toEqual(["p1+p2+p3", "a", "b"]);
    expect(PULSE_STRIP_ROWS).toBe(3);
  });
  it("a Pulse someone made their own (caption / photo) is a regular post again", () => {
    expect(feedLayout([own("claimed", 20)])[0].kind).toBe("post");
  });
  it("Home shows a couple of Pulses at most", () => {
    const now = Date.UTC(2026, 9, 10, 21);
    const { shown } = homeCrewPosts([pulse("p1", 20), pulse("p2", 19), pulse("p3", 18), own("a", 17), own("b", 16)], now);
    expect(shown.filter((p) => p.auto).length).toBe(HOME_CREW_PULSES);
    expect(shown.map((p) => p.id)).toEqual(["p1", "p2", "a", "b"]);
  });
});

import { homeCrewDeck } from "@/lib/community";
describe("Home's Crew feed deck", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number, prs = 0) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs } });
  const post = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: null });
  it("a Crew Pulse first (the day's newest PR, else the newest session), then regular posts newest first", () => {
    const d = homeCrewDeck([pulse("p1", 1), pulse("p2", 3, 2), post("a", 2), post("b", 5), pulse("old", 72, 5)], now);
    expect(d.pulse?.id).toBe("p2");
    expect(d.shown.map((p) => p.id)).toEqual(["a", "b"]);
    expect(homeCrewDeck([pulse("p1", 1), post("a", 2)], now).pulse?.id).toBe("p1");
  });
  it("no recent Pulse: just the posts", () => {
    expect(homeCrewDeck([post("a", 2), pulse("old", 72)], now).pulse).toBeNull();
  });
});

describe("Home deck: Pulse, three posts, then the rest", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const post = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: null });
  it("three newest posts, and how many more there are (the More card only when there are)", () => {
    const d = homeCrewDeck([post("a", 1), post("b", 2), post("c", 3), post("d", 4), post("e", 5)], now);
    expect(d.shown.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(d.more).toBe(2);
    expect(homeCrewDeck([post("a", 1)], now).more).toBe(0);
    const entry = readFileSync(new URL("../components/community/community-entry.tsx", import.meta.url), "utf8");
    expect(entry).toContain("{more > 0 && <SeeMoreCard");
    expect(entry).toContain('hash: `post=${postId}`');
  });
});
