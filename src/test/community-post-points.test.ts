import { describe, expect, it } from "vitest";
import { POST_POINTS_RECENT_DAYS, postPointsHint, type PostPointsStatus } from "@/lib/community";
import { LEAGUE_COMMUNITY_POINTS, LEAGUE_COMMUNITY_WEEKLY_CAP } from "@/lib/league-points";

const status = (over: Partial<PostPointsStatus> = {}): PostPointsStatus => ({
  points: LEAGUE_COMMUNITY_POINTS, week_cap: LEAGUE_COMMUNITY_WEEKLY_CAP, today_earned: false, week_count: 0, ...over,
});
const now = new Date("2026-10-08T18:00:00Z");
const yesterday = "2026-10-07T18:00:00Z";

describe("postPointsHint", () => {
  it("says nothing for non-athletes or posts already in the feed", () => {
    expect(postPointsHint(null, "community", false, yesterday, now)).toBeNull();
    expect(postPointsHint(status(), "community", true, yesterday, now)).toBeNull();
  });

  it("promises the points when the post will earn", () => {
    expect(postPointsHint(status(), "community", false, yesterday, now)).toEqual({ tone: "earn", text: "+15 league points for posting 🔥" });
  });

  it("nudges coach-only and private posts toward the Community", () => {
    expect(postPointsHint(status(), "coach", false, yesterday, now)?.text).toBe("Post to Community to earn +15 league points.");
    expect(postPointsHint(status(), "private", false, yesterday, now)?.tone).toBe("muted");
  });

  it("never over-promises: daily, weekly and recency limits", () => {
    expect(postPointsHint(status({ today_earned: true }), "community", false, yesterday, now)?.tone).toBe("muted");
    expect(postPointsHint(status({ week_count: 2 }), "community", false, yesterday, now)?.text).toBe(
      "Post points maxed this week (2/2). They reset Monday.",
    );
    const old = new Date(now.getTime() - (POST_POINTS_RECENT_DAYS + 1) * 86_400_000).toISOString();
    expect(postPointsHint(status(), "community", false, old, now)?.tone).toBe("muted");
  });
});
