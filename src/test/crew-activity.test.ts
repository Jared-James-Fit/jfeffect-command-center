import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityAge, activityLine, activitySections, matchesActivityFilter } from "@/lib/crew-activity";
import type { CommunityNotice } from "@/lib/community-notifications";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const A = (name: string) => ({ user_id: name.toLowerCase(), name, avatar_url: null, is_coach: false });
const N = (o: Partial<CommunityNotice>): CommunityNotice => ({
  key: "k", kind: "reaction", anchor: "a", post_id: "p", comment_id: null, count: 1, at: new Date().toISOString(),
  actors: [A("Vicky")], emojis: ["heart"], snippet: null, media_type: null, post_kind: "workout", ...o,
});

describe("Crew Activity lines", () => {
  it("names people like Instagram: one, two, two and N others", () => {
    expect(activityLine(N({})).names).toEqual(["Vicky"]);
    const two = activityLine(N({ count: 2, actors: [A("Vicky"), A("Marc")] }));
    expect([two.names, two.others]).toEqual([["Vicky", "Marc"], 0]);
    const many = activityLine(N({ count: 5, actors: [A("Vicky"), A("Marc"), A("Fionna")] }));
    expect([many.names, many.others, many.action]).toEqual([["Vicky", "Marc"], 3, "liked your workout"]);
  });
  it("says what happened: a PR's name, a comment's words, a follow", () => {
    expect(activityLine(N({ win: "Belt Squat PR", emojis: ["fire"] })).action).toBe("celebrated your Belt Squat PR 🔥");
    expect(activityLine(N({ kind: "comment", snippet: "clean lockout" }))).toMatchObject({ action: "commented:", quote: "clean lockout" });
    expect(activityLine(N({ kind: "reply", snippet: null, media_type: "gif" }))).toMatchObject({ action: "replied:", quote: "GIF" });
    expect(activityLine(N({ kind: "comment_like", snippet: null }))).toMatchObject({ action: "liked your comment", quote: null });
    expect(activityLine(N({ kind: "follow", post_id: null })).action).toBe("started following you");
    expect(activityLine(N({ post_kind: "lockin" })).action).toBe("liked your lock-in");
  });
  it("filters: comments (and replies), likes (and comment likes), follows", () => {
    expect(matchesActivityFilter({ kind: "reply" }, "comments")).toBe(true);
    expect(matchesActivityFilter({ kind: "comment_like" }, "likes")).toBe(true);
    expect(matchesActivityFilter({ kind: "follow" }, "likes")).toBe(false);
    expect(matchesActivityFilter({ kind: "follow" }, "follows")).toBe(true);
  });
  it("New on top (unread when it opened), then Today / Yesterday / This week / Earlier, each line once", () => {
    const now = new Date(2026, 9, 15, 18, 0);
    const at = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString();
    const items = [
      { key: "a", at: at(1) }, { key: "b", at: at(2) }, { key: "c", at: at(20) }, { key: "d", at: at(24 * 4) }, { key: "e", at: at(24 * 20) },
    ];
    const s = activitySections(items, new Set(["b"]), now);
    expect(s.map((x) => [x.key, x.items.map((i) => i.key)])).toEqual([
      ["new", ["b"]], ["today", ["a"]], ["yesterday", ["c"]], ["week", ["d"]], ["earlier", ["e"]],
    ]);
  });
  it("short times", () => {
    const now = Date.now();
    expect(activityAge(new Date(now - 30e3).toISOString(), now)).toBe("now");
    expect(activityAge(new Date(now - 3 * 3600e3).toISOString(), now)).toBe("3h");
    expect(activityAge(new Date(now - 9 * 86400e3).toISOString(), now)).toBe("1w");
  });
});

describe("Crew Activity screen", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const page = read("src/components/community/crew-activity.tsx");
  const q = read("src/lib/crew-activity.queries.ts");
  it("opens from the heart in the Crew header (a dot when something's new), never as the coach while viewing as a client", () => {
    const heart = read("src/components/community/activity-heart.tsx");
    // the bar's right side (heart + your photo) is left out while a coach views as a client
    expect(screen).toMatch(/right=\{\s*!previewOnly && \(\s*<>\s*\{\/\*[^*]*\*\/\}\s*<ActivityHeart onOpen=\{\(\) => go\(\{ kind: "activity" \}\)\}/);
    expect(heart).toContain("const q = useCrewActivity(true);");
    expect(heart).toContain("data-activity-dot");
    // the coach's Crew page has the heart too, opening Activity on its Feed
    expect(read("src/components/community/admin-community-hub.tsx")).toContain("<ActivityHeart");
    expect(screen).toContain("window.addEventListener(OPEN_ACTIVITY_EVENT, open);");
  });
  it("shares the bell's read state, and opening it reads what was new (kept as New while you're there)", () => {
    expect(q).toContain('["notifications", "crew-activity", userId ?? null]');
    expect(q).toContain("queryKey: crewActivityKey(user?.id),");
    expect(q).toContain('.eq("kind", "community")');
    expect(q).toContain('"notif_mark_read"');
    expect(page).toContain("setNewKeys(new Set(unread.map((i) => i.key)));");
    // re-reading moves the read time on, so a thing that came back can be read again
    expect(read("supabase/migrations/20261128091000_notif_mark_read_refresh.sql")).toContain("DO UPDATE SET read_at = EXCLUDED.read_at,");
  });
  it("follow back right on the line, the post on the right, people to follow at the end", () => {
    expect(page).toContain('<FollowButton userId={first.user_id} name={first.name} size="sm" />');
    expect(page).toContain("<PostThumb");
    expect(page).toContain("<SuggestedAthletes onOpen={onOpenPerson} onSeeAll={onFindPeople} />");
    expect(read("supabase/migrations/20261128090000_community_activity_thumbs.sql")).toContain("'post_thumb', coalesce(p.media_thumb_path");
  });
});

describe("camera like Instagram's", () => {
  const cam = read("src/components/community/share-studio.tsx");
  const carousel = read("src/components/community/look-carousel.tsx");
  it("the looks are circles that glide and snap into the shutter's ring; the middle one takes the photo", () => {
    expect(cam).toContain("<LookCarousel");
    expect(carousel).toContain("snap-x snap-mandatory");
    expect(carousel).toContain("snap-center snap-always");
    expect(carousel).toContain("if (!on) return bring(i);");
    expect(carousel).toContain("onShoot();");
    // a swipe on the camera brings the row along; the looks it glides past while steering don't count
    expect(carousel).toContain('el.scrollTo({ left: at * STEP, behavior: "smooth" });');
    expect(carousel).toContain("if (steering.current != null) {");
  });
  it("Post / Story is in view under the camera (Instagram's row); flip sits up top", () => {
    expect(cam).toContain("<ModeTabs");
    // no spacers pushing the row wider than the screen; it scrolls only when a tiny screen can't fit them
    expect(cam).not.toContain('<span className="w-1/2 shrink-0" aria-hidden />');
    expect(cam).toContain('<div className="mx-auto flex w-max">');
    expect(cam).toContain("setOver(el.scrollWidth > el.clientWidth + 1)");
    expect(cam).toContain('<button type="button" onClick={flip} className={pill} aria-label="Flip camera">');
  });
});
