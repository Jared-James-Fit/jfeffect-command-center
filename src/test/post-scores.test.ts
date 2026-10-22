import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: 1, error: null })) } }));

import { kindAverages, kindLabel, rankLine, scoreBand, scoreDrivers, scoreLines, scoreTitle, type PostScore } from "@/lib/post-scores";
import { attentionExit, attentionHide, attentionShow, onScreenEnough, pendingAttention, resetAttention } from "@/lib/post-attention";
import { supabase } from "@/integrations/supabase/client";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261226090000_post_scores.sql");

const score = (x: Partial<PostScore> = {}): PostScore => ({
  post_id: "p", created_at: "2026-10-19T20:00:00Z", kind_key: "coach", by_coach: true, title: "", media_type: null, early: false, score: 50,
  audience: 11, viewers: 8, reactors: 2, commenters: 1, savers: 0, sharers: 0, voters: 0, engaged: 3, reach: 0.727, rate: 0.3,
  attention: null, pct: { reach: 0.7, engagement: 0.6, attention: null }, kind_avg: 54, kind_n: 7, ...x,
});

describe("post scores: what the number means", () => {
  it("bands: top 80+, strong 60+, average 40+, below that; a post up under a day is still counting", () => {
    expect(scoreBand(score({ score: 87 }))).toEqual({ label: "Top post", tone: "top" });
    expect(scoreBand(score({ score: 64 })).label).toBe("Strong");
    expect(scoreBand(score({ score: 42 })).label).toBe("Average");
    expect(scoreBand(score({ score: 19 })).label).toBe("Below average");
    expect(scoreBand(score({ score: 90, early: true }))).toEqual({ label: "Early", tone: "early" });
  });

  it("names each kind of post the way the coach knows them", () => {
    expect(kindLabel("lesson:truth")).toBe("Lesson · Uncomfortable truth");
    expect(kindLabel("lesson:strength")).toBe("Lesson · Strength science");
    expect(kindLabel("wednesday_wins")).toBe("Wednesday Wins");
    expect(kindLabel("coach")).toBe("Your posts");
    expect(kindLabel("member_workout")).toBe("Members' workouts");
    expect(kindLabel("holiday")).toBe("Holidays");
  });

  it("a post without words is named by what it is and whose", () => {
    expect(scoreTitle(score({ title: "What RPE actually means" }))).toBe("What RPE actually means");
    expect(scoreTitle(score({ kind_key: "member_workout", by_coach: false, author_name: "Nicole" }))).toBe("Nicole's workout");
    expect(scoreTitle(score({ media_type: "image" }))).toBe("Your photo");
    expect(scoreTitle(score({ kind_key: "member_post", by_coach: false, media_type: "video", author_name: null }))).toBe("A clip");
  });

  it("ranks are said plainly, never 'higher than 100%'", () => {
    expect(rankLine(1)).toBe("Highest of your posts");
    expect(rankLine(0)).toBe("Lowest of your posts");
    expect(rankLine(0.724)).toBe("Higher than 72% of posts");
    expect(rankLine(null)).toBe("Not measured");
  });

  it("each part in plain words: who saw it of who was around, what they did, how long they stayed", () => {
    const l = scoreLines(score({ attention: { reached: 8, stopped: 6, kept: 7, median_ms: 4200 } }));
    expect(l.reach).toBe("Seen by 8 of the 11 people in Crew the week it went up");
    expect(l.engagement).toBe("2 likes · 1 comment from 8 people who saw it");
    expect(l.attention).toBe("6 of 8 stopped on it · 7 of 8 kept scrolling after · 4.2s typical time on it");
    expect(scoreLines(score({ reactors: 0, commenters: 0, engaged: 0 })).engagement).toBe("No likes, comments, saves or shares yet");
    expect(scoreLines(score()).attention).toBeNull();
  });

  it("what carried it / held it back only when the parts really differ", () => {
    expect(scoreDrivers(score({ pct: { reach: 0.21, engagement: 1, attention: null } }))).toEqual({ carried: "engagement", heldBack: "reach" });
    expect(scoreDrivers(score({ pct: { reach: 0.6, engagement: 0.5, attention: null } }))).toEqual({ carried: null, heldBack: null });
    expect(scoreDrivers(score({ pct: { reach: null, engagement: 0.9, attention: null } }))).toEqual({ carried: null, heldBack: null });
  });

  it("kinds are averaged on settled posts only, best first", () => {
    const k = kindAverages([score({ kind_key: "a", score: 80 }), score({ kind_key: "a", score: 60 }), score({ kind_key: "b", score: 90, early: true }), score({ kind_key: "c", score: 40 })]);
    expect(k.map((x) => [x.kind_key, x.avg, x.n])).toEqual([["a", 70, 2], ["c", 40, 1]]);
  });
});

describe("attention: time on a post, coming on screen, leaving Crew on it", () => {
  let t = 0;
  beforeEach(() => {
    t = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn() });
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), addEventListener: vi.fn(), innerHeight: 800 });
    resetAttention();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("counts the time it's on screen and each time it comes on", () => {
    attentionShow("a");
    t += 3_500;
    attentionHide("a");
    attentionShow("a");
    t += 1_000;
    attentionHide("a");
    expect(pendingAttention().a).toEqual({ ms: 4_500, shows: 2, exits: 0 });
  });

  it("a stretch counts for at most a minute (a phone left on the table isn't attention)", () => {
    attentionShow("a");
    t += 10 * 60_000;
    attentionHide("a");
    expect(pendingAttention().a.ms).toBe(60_000);
  });

  it("leaving Crew is an exit for what's on screen, sent at once and counted once (not again on the way out of the app)", async () => {
    const rpc = vi.mocked((supabase as any).rpc);
    rpc.mockClear();
    attentionShow("a");
    attentionShow("b");
    t += 1_000;
    attentionHide("b");
    t += 2_000;
    attentionExit();
    attentionExit();
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
    const rows = (rpc.mock.calls[0] as any[])[1]._rows;
    expect(rows).toEqual([
      { post_id: "a", ms: 3_000, shows: 1, exits: 1 },
      { post_id: "b", ms: 1_000, shows: 1, exits: 0 },
    ]);
    expect(pendingAttention()).toEqual({});
  });

  it("on screen enough: half of it, or half the screen for a post taller than the screen", () => {
    const e = (h: number, visible: number) => ({ isIntersecting: visible > 0, intersectionRect: { height: visible } as DOMRectReadOnly, boundingClientRect: { height: h } as DOMRectReadOnly, rootBounds: { height: 800 } as DOMRectReadOnly });
    expect(onScreenEnough(e(400, 210), 800)).toBe(true);
    expect(onScreenEnough(e(400, 150), 800)).toBe(false);
    // a 1,400px post never shows half of itself on an 800px screen; half the screen is enough
    expect(onScreenEnough(e(1400, 420), 800)).toBe(true);
    expect(onScreenEnough(e(1400, 300), 800)).toBe(false);
  });
});

describe("post scores: the database", () => {
  it("scores feed posts only, against the coach's own posts, and never counts coaches", () => {
    expect(sql).toContain("WHERE p.archived_at IS NULL AND NOT coalesce(p.story_only, false) AND NOT coalesce(p.auto_shared, false)");
    expect(sql).toContain("WHERE v.viewer_user_id NOT IN (SELECT user_id FROM staff)");
    expect(sql).toContain("r.user_id NOT IN (SELECT user_id FROM staff)");
    // the coach side: staff logins, their linked athlete accounts, and the account coach posts go out as
    expect(sql).toContain("UNION SELECT cp.same_person_as FROM public.community_profiles cp WHERE cp.same_person_as IS NOT NULL AND cp.user_id IN (SELECT user_id FROM logins)");
    expect(sql).toContain("UNION SELECT s.author_user_id FROM public.community_series_settings s WHERE s.author_user_id IS NOT NULL");
  });

  it("weights: likes 1, votes 1.5, comments 3, saves and shares 4; reach 30 · engagement 35 · attention 35 (45 · 55 before attention)", () => {
    expect(sql).toContain("(m.reactors * 1 + m.voters * 1.5 + m.commenters * 3 + m.savers * 4 + m.sharers * 4)::numeric AS points");
    expect(sql).toContain("THEN 0.30 * pr_reach + 0.35 * pr_rate + 0.35 * pr_hold");
    expect(sql).toContain("WHEN pr_reach IS NOT NULL THEN 0.45 * pr_reach + 0.55 * pr_rate");
    // smoothed toward the crew's average so one like from one viewer isn't a hit
    expect(sql).toContain("(w.points + prior.rate * 5) / (w.seen_by + 5) AS rate");
    // attention counts once 3 people's is recorded
    expect(sql).toContain("CASE WHEN w.reached >= 3 THEN");
  });

  it("coaches only; the attention table and the coach list are closed to clients; a coach's own attention is never kept", () => {
    expect(sql).toContain("IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.community_post_attention FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_staff_people() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("IF uid IN (SELECT public.community_staff_people()) OR v_me IN (SELECT public.community_staff_people()) THEN RETURN 0; END IF;");
    // your own posts and posts you can't see are never kept
    expect(sql).toContain("AND p.author_user_id IS DISTINCT FROM v_me");
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
  });
});

describe("post scores: where they show", () => {
  it("a coach's line under every feed post (and in its detail), never in View as client or on a story", () => {
    expect(read("src/components/community/post-card.tsx")).toContain("{viewerIsStaff && <PostScoreRow post={post} />}");
    expect(read("src/components/community/post-detail.tsx")).toContain("{viewerIsStaff && <PostScoreRow post={post} />}");
    const row = read("src/components/community/post-score.tsx");
    expect(row).toContain("const scorable = !post.story && !post.auto && !post.archived_at && !isImpersonating;");
  });

  it("attention is never kept for your own post, a coach, or a coach's View as client; leaving Crew is an exit", () => {
    const views = read("src/components/community/post-views.tsx");
    expect(views).toContain('const skipAttention = skip || role === "admin" || role === "coach";');
    expect(read("src/components/community/community-screen.tsx")).toContain("useLayoutEffect(() => () => attentionExit(), []);");
  });

  it("the board sits on Crew → Daily", () => {
    expect(read("src/components/community/admin-community-hub.tsx")).toContain("<PostScoreBoard />");
  });
});
