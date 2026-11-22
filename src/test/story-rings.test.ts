import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ringGeometry, storyGroupFor, storyRings } from "@/lib/story-ring";
import { markStorySeen, resetSeenStories } from "@/lib/story-seen";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// Nov 22 2026: profile photos wore a permanent orange / red ring whether or
// not anyone had a story up. A ring is now only ever a story, read from the
// stories actually up.
describe("story rings: read from the stories actually up, never hardcoded", () => {
  const now = Date.UTC(2026, 10, 22, 18);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const author = (id: string) => ({ user_id: id, name: id, avatar_url: null, is_coach: false });
  const post = (id: string, who: string, h: number, seen = false, extra: object = {}) =>
    ({ id, author: author(who), created_at: at(h), auto: false, stats: null, visibility: "community", is_mine: false, seen, ...extra }) as any;
  const story = (id: string, who: string, h: number, seen = false, extra: object = {}) => post(id, who, h, seen, { story: true, ...extra });

  beforeEach(() => resetSeenStories());

  it("no story up: no ring (a feed post, nothing at all, or a story that ran out)", () => {
    const rings = storyRings([post("p", "marc", 1), story("old", "vicky", 25)], { now });
    expect(rings.get("marc")).toBeUndefined();
    expect(rings.get("vicky")).toBeUndefined();
    expect(rings.get("nobody")).toBeUndefined();
  });

  it("a story with a moment you haven't watched: the brand ring; all watched: grey; Close Friends: green", () => {
    const rings = storyRings(
      [story("a1", "ann", 2), story("a2", "ann", 1, true), story("b1", "bob", 3, true), story("c1", "cat", 1, false, { visibility: "close_friends" })],
      { now },
    );
    expect(rings.get("ann")).toBe("unseen");
    expect(rings.get("bob")).toBe("seen");
    expect(rings.get("cat")).toBe("close_friends");
  });

  it("watching it turns it grey at once, before the server knows (this visit)", () => {
    const posts = [story("a1", "ann", 2), story("a2", "ann", 1)];
    expect(storyRings(posts, { now, seen: new Set(["a1"]) }).get("ann")).toBe("unseen");
    expect(storyRings(posts, { now, seen: new Set(["a1", "a2"]) }).get("ann")).toBe("seen");
  });

  it("a story that runs out loses its ring by itself; a deleted one is simply gone", () => {
    const posts = [story("a1", "ann", 23)];
    expect(storyRings(posts, { now }).get("ann")).toBe("unseen");
    expect(storyRings(posts, { now: now + 2 * 3600e3 }).get("ann")).toBeUndefined();
    expect(storyRings([], { now }).get("ann")).toBeUndefined();
  });

  it("your own story: the brand ring until you've watched it (kept on this phone, since views never count the author), then grey", () => {
    const mine = [story("me1", "jared", 3, false, { is_mine: true }), story("me2", "jared", 1, false, { is_mine: true })];
    expect(storyRings(mine, { now }).get("jared")).toBe("unseen");
    expect(storyRings(mine, { now, seen: new Set(["me1"]) }).get("jared")).toBe("unseen");
    expect(storyRings(mine, { now, seen: new Set(["me1", "me2"]) }).get("jared")).toBe("seen");
    // your feed post is never a story
    expect(storyRings([post("f", "jared", 1, false, { is_mine: true })], { now }).get("jared")).toBeUndefined();
    // remembered on the phone: your own go to its storage, someone else's only for this visit
    const store = new Map<string, string>();
    const g = globalThis as { window?: unknown };
    const had = g.window;
    g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } };
    try {
      markStorySeen("me2", true);
      markStorySeen("a1", false);
      const kept = JSON.parse(store.get("jf-own-story-seen-v1") ?? "{}");
      expect(kept).toHaveProperty("me2");
      expect(kept).not.toHaveProperty("a1");
    } finally {
      g.window = had;
    }
  });

  it("a photo plays that person's story (yours or theirs), or nothing when there's none", () => {
    const posts = [story("me1", "jared", 2, false, { is_mine: true }), story("a1", "ann", 1), post("p", "bob", 1)];
    expect(storyGroupFor(posts, "jared", now)?.items.map((p) => p.id)).toEqual(["me1"]);
    expect(storyGroupFor(posts, "ann", now)?.items.map((p) => p.id)).toEqual(["a1"]);
    expect(storyGroupFor(posts, "bob", now)).toBeNull();
  });

  it("the ring sits outside the photo: thin on small faces, a little heavier on a profile", () => {
    expect(ringGeometry(32)).toEqual({ stroke: 1.5, gap: 1.5 });
    expect(ringGeometry(56)).toEqual({ stroke: 2, gap: 2 });
    expect(ringGeometry(78)).toEqual({ stroke: 2.5, gap: 3 });
  });
});

describe("one story ring system across the app", () => {
  it("the ring is drawn outside the photo, never changing its size, and only eases colour to grey", () => {
    const ring = read("src/components/community/story-ring.tsx");
    expect(ring).toContain("style={{ width: size, height: size }} data-story-ring={state}");
    expect(ring).toContain("style={{ left: -pad, top: -pad, width: outer, height: outer }}");
    // the base styles cap an svg at its parent's width: without this the ring sat squashed off centre
    expect(ring).toContain('className="pointer-events-none absolute max-w-none overflow-visible"');
    expect(ring).toContain("transition-opacity duration-300 ease-out motion-reduce:transition-none");
    expect(ring).not.toContain("animate-spin");
    expect(ring).not.toContain("jf-live-ring");
  });

  it("no photo wears a decorative ring: the profile's gradient is gone, UserAvatar has no ring prop", () => {
    const profile = read("src/components/community/profile-view.tsx");
    expect(profile).not.toMatch(/bg-gradient-to-tr from-amber/);
    expect(profile).toContain("<StoryAvatar");
    const avatar = read("src/components/user-avatar.tsx");
    expect(avatar).not.toContain('"ring-1 ring-border"');
    expect(avatar).not.toContain("ring?: boolean");
  });

  it("people's photos across Crew and the chats read the same rings", () => {
    for (const f of [
      "src/components/community/post-card.tsx",
      "src/components/community/comments-sheet.tsx",
      "src/components/community/post-sheet.tsx",
      "src/components/community/follow-button.tsx",
      "src/components/community/reactors-sheet.tsx",
      "src/components/community/discover.tsx",
      "src/components/community/crew-activity.tsx",
      "src/components/community/post-activity.tsx",
      "src/components/community/crew-list.tsx",
      "src/components/community/suggested-athletes.tsx",
      "src/components/community/reels-viewer.tsx",
    ]) {
      expect(read(f), f).toContain("<StoryAvatar");
    }
    expect(read("src/components/direct-chat.tsx")).toContain("storyUserId={leading ? null : thread.other.user_id}");
    expect(read("src/components/group-chats-pane.tsx")).toContain("storyUserId={pinned.storyUserId}");
    expect(read("src/components/messages/chat-list-row.tsx")).toContain("<StoryRing state={story.state} size={CHAT_ROW_AVATAR}>");
  });

  it("the Crew screen hosts its own rings; the app hosts the rest from the same data, and nothing rings in View as client", () => {
    expect(read("src/components/community/community-screen.tsx")).toContain("<StoryHostProvider");
    expect(read("src/components/app-shell.tsx")).toContain("<GlobalStoryHost>");
    const host = read("src/components/community/global-story-host.tsx");
    expect(host).toContain("communityKeys.feed(null)");
    expect(host).toContain("isImpersonating || !data ? EMPTY");
  });

  it("the story viewer marks what you watch, yours kept on this phone", () => {
    expect(read("src/components/community/crew-stories.tsx")).toContain("markStorySeen(post.id, !!post.is_mine)");
  });
});
