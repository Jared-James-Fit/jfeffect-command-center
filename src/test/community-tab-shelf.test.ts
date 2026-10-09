import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Home } from "lucide-react";
import { MORE_BAR_TO, resolveVisibleBarItems } from "@/lib/floating-bar";
import { clientBottomNav } from "@/lib/admin-nav";
import type { NavItem } from "@/components/app-shell";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const shell = read("src/components/app-shell.tsx");
const portal = read("src/routes/_authenticated/portal/route.tsx");
const entry = read("src/components/community/community-entry.tsx");
const tile = read("src/components/community/post-tile.tsx");
const profile = read("src/components/community/profile-view.tsx");
const screen = read("src/components/community/community-screen.tsx");
const item = (to: string): NavItem => ({ to, label: to, icon: Home });

describe("client tab bar: League in the centre", () => {
  it("five destinations, League (standings + the crew) raised in the middle", () => {
    const visible = resolveVisibleBarItems(clientBottomNav, { more: false });
    expect(visible.map((i) => i.label)).toEqual(["Home", "Workouts", "League", "Nutrition", "Messages"]);
    expect(visible[2].featured).toBe(true);
    expect(visible.some((i) => i.to === MORE_BAR_TO)).toBe(false);
  });

  it("a bar without a header More keeps More as its last slot", () => {
    const visible = resolveVisibleBarItems(["/a", "/b", "/c", "/d", "/e"].map(item));
    expect(visible).toHaveLength(5);
    expect(visible[4].to).toBe(MORE_BAR_TO);
  });

  it("More opens from the top bar, in place of the gear (the avatar has the same menu)", () => {
    expect(portal).toContain('title="Client Portal" moreInHeader>');
    expect(shell).toContain('<Button variant="outline" aria-label="More" onClick={() => setMoreOpen(true)} className="h-10 w-10 shrink-0 rounded-xl px-0">');
    expect(shell).toContain("resolveVisibleBarItems(bottomItems, { more: !moreInHeader })");
  });

  it("the raised button isn't clipped, and rings + counts when there's something new", () => {
    expect(shell).toContain('raised ? "overflow-visible" : "overflow-hidden"');
    expect(shell).toContain('badge?.count ? "bg-[linear-gradient(135deg,#ffb054,#ef3340)]" : "bg-card"');
  });

  it("no community for this account: no centre button", () => {
    expect(portal).toContain('community?.enabled === false ? clientBottomNav.filter((i) => i.to !== "/portal/community") : clientBottomNav');
  });

  it("tapping it while you're there goes back to the top of the feed, fresh", () => {
    expect(screen).toContain("if ((e as CustomEvent).detail !== window.location.pathname) return;");
    expect(screen).toContain('window.addEventListener("nav-retap", onRetap);');
  });

  it("the header '🔥 new' nudge is for coaches only now", () => {
    expect(entry).toContain('const eligible = path.startsWith("/admin") && staff;');
  });
});

describe("Home's community shelf", () => {
  it("one tile per post from the last 7 days: live, then new to you, then the rest, yours last (max 8)", () => {
    expect(entry).toContain("const weekAgo = Date.now() - 7 * 86_400_000;");
    expect(entry).toContain(".sort((a, b) => rank(a) - rank(b))");
    expect(entry).toContain(".slice(0, 8);");
  });

  it("new to you wears the same story ring as the tab", () => {
    expect(entry).toContain('live ? "bg-red-500" : fresh && "bg-[linear-gradient(135deg,#ffb054,#ef3340)]"');
  });

  it("the profile grid and the shelf draw posts the same way, from a small file (no feed card in the app shell)", () => {
    expect(profile).toContain("<PostTileFace post={p} thumb={thumb} unit={unit} />");
    expect(entry).toContain('import { PostTileFace, postThumbPath } from "@/components/community/post-tile";');
    expect(tile).not.toMatch(/from "@\/components\/community\/post-card"/);
    expect(entry).not.toMatch(/from "@\/components\/community\/post-card"/);
  });

  it("a reopened workout without a photo still shows something (its words or the session)", () => {
    expect(tile).toContain("{post.caption || <span");
    expect(tile).not.toContain('<div className="h-full w-full bg-muted" />');
  });
});

describe("Home order: what you do today, then what you check", () => {
  const home = read("src/routes/_authenticated/portal/index.tsx");
  const at = (s: string) => home.indexOf(s);
  it("Today, the crew, then one Body swipe (weigh-in, water, progress), then the training block", () => {
    const order = ["<UpcomingScheduleCard", "<CommunityHomeStrip", "<BodyweightSummaryCard", "<HomeWaterCard", "<ProgressSummaryCard", "<TrainingBlockCard"];
    const idx = order.map(at);
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
});

describe("the recap's one-tap post", () => {
  const footer = read("src/components/community/recap-post.tsx");
  it("posts the workout card to the crew, with a caption right there (optional)", () => {
    expect(footer).toContain('saveCommunityPost({ completionId, caption: caption.trim(), visibility: "community", media: { action: "keep" } })');
    expect(footer).toContain("<CaptionRow value={caption} onOpen={() => setWriting(true)} />");
    expect(footer).toContain("<CaptionSheet open={writing}");
    // opening the camera instead keeps what they wrote
    expect(footer).toContain("onClick={() => onStudio(caption)}");
    expect(read("src/components/community/use-workout-studio.ts")).toContain("caption: existing ? existing.caption : draftCaption,");
  });
  it("says what it earns only when it really earns (DB rule: recent workout, 1 a day, 2 a week)", () => {
    expect(footer).toContain('const earn = hint?.tone === "earn" && points ? points.points : 0;');
    expect(footer).toContain("{earn > 0 && <span");
  });
  it("an earlier finish post: says where it is, Done takes over; a lock-in never counts as one", () => {
    expect(footer).toContain('"It\'s in the crew\'s feed"');
    expect(footer).toContain('existing.visibility === "coach"');
    expect(footer).not.toContain("locked_in_at");
    expect(footer).toContain('useMyPostForCompletion(completionId, true, "lockin")');
  });
});
