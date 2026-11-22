import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  IDENTITY,
  RUBBER,
  clampView,
  dismissCloses,
  dismissIntent,
  dismissLook,
  doubleTapView,
  flipFrom,
  fullAvatarPath,
  isDoubleTap,
  pinchView,
  rubberView,
  viewBounds,
  wheelView,
} from "@/lib/photo-zoom";

const read = (p: string) => readFileSync(p, "utf8");

// a 342 px circle in the middle of a 390 × 844 phone
const box = { left: 24, top: 200, w: 342, h: 342 };
const vp = { w: 390, h: 844 };

describe("photo viewer gestures (photo-zoom.ts)", () => {
  it("an unzoomed photo can't be moved; a zoomed one moves until its edge meets the screen's", () => {
    expect(clampView({ x: 40, y: -30, s: 1 }, box, vp)).toEqual(IDENTITY);
    const b = viewBounds(2, box, vp);
    // 684 px wide on a 390 px screen: from its right edge on the screen's to its left edge on the screen's
    expect(b.maxX).toBe(-24);
    expect(b.minX).toBe(390 - 24 - 684);
    // 684 px tall on an 844 px screen still fits: it stays centred where it was
    expect(b.minY).toBe(b.maxY);
    expect(b.minY).toBe((342 - 684) / 2);
    expect(clampView({ x: 500, y: 0, s: 2 }, box, vp).x).toBe(-24);
  });

  it("a pinch that ends barely zoomed springs back, and nothing goes past 4×", () => {
    expect(clampView({ x: 3, y: 3, s: 1.01 }, box, vp)).toEqual(IDENTITY);
    expect(clampView({ x: 0, y: 0, s: 9 }, box, vp).s).toBe(4);
    // fingers spread to twice as far apart: twice the size, the spot between them stays put
    const v = pinchView(IDENTITY, { x: box.left, y: box.top }, 100, { x: 195, y: 371 }, 200, { x: 195, y: 371 });
    expect(v.s).toBe(2);
    // the photo's own point that was under the fingers (171 px in) is still under them
    expect(box.left + v.x + v.s * (195 - box.left)).toBeCloseTo(195, 5);
  });

  it("past an edge the photo follows a little, never all the way", () => {
    const b = viewBounds(2, box, vp);
    const pulled = rubberView({ x: b.maxX + 100, y: b.minY, s: 2 }, box, vp);
    expect(pulled.x).toBeCloseTo(b.maxX + 100 * RUBBER, 5);
    // inside the bounds it follows the finger exactly
    expect(rubberView({ x: b.maxX - 10, y: b.minY, s: 2 }, box, vp).x).toBe(b.maxX - 10);
  });

  it("a double tap zooms in on the spot tapped, and again goes back", () => {
    const at = { x: 195, y: 371 }; // the middle of the photo
    const v = doubleTapView(IDENTITY, box, vp, at);
    expect(v.s).toBe(DOUBLE_TAP_SCALE);
    // the photo's middle is still under the finger
    expect(box.left + v.x + v.s * (171)).toBeCloseTo(195, 5);
    expect(doubleTapView(v, box, vp, at)).toEqual(IDENTITY);
    // two taps far apart or slow aren't one
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 200, x: 110, y: 104 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 450, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 100, x: 200, y: 100 })).toBe(false);
    expect(isDoubleTap(null, { t: 100, x: 100, y: 100 })).toBe(false);
  });

  it("a trackpad pinch or wheel zooms around the pointer, within 1× and 4×", () => {
    const v = wheelView(IDENTITY, box, vp, { x: 195, y: 371 }, -100, true);
    expect(v.s).toBeGreaterThan(1);
    expect(wheelView(IDENTITY, box, vp, { x: 195, y: 371 }, 500, true)).toEqual(IDENTITY);
    expect(wheelView({ x: 0, y: 0, s: 4 }, box, vp, { x: 195, y: 371 }, -500, true).s).toBe(4);
  });

  it("a swipe up or down puts an unzoomed photo away; sideways does nothing", () => {
    expect(dismissIntent(2, 3)).toBe("wait");
    expect(dismissIntent(5, 40)).toBe("drag");
    expect(dismissIntent(5, -40)).toBe("drag");
    expect(dismissIntent(40, 5)).toBe("pass");
    // a quarter of the photo's height, or a flick
    expect(dismissCloses(100, 600, 342)).toBe(true);
    expect(dismissCloses(-100, 600, 342)).toBe(true);
    expect(dismissCloses(40, 50, 342)).toBe(true);
    expect(dismissCloses(40, 400, 342)).toBe(false);
    // pulled away, the photo shrinks a little and the page shows through
    const half = dismissLook(211, 844);
    expect(half.scale).toBeLessThan(1);
    expect(half.shade).toBeLessThan(1);
    expect(dismissLook(0, 844)).toEqual({ scale: 1, shade: 1 });
  });

  it("the photo grows out of the avatar tapped (and goes back into it)", () => {
    const f = flipFrom({ left: 16, top: 100, width: 78, height: 78 }, box);
    expect(f.s).toBeCloseTo(78 / 342, 5);
    // centre to centre
    expect(f.x).toBeCloseTo(16 + 39 - (24 + 171), 5);
    expect(f.y).toBeCloseTo(100 + 39 - (200 + 171), 5);
  });
});

describe("full-size Crew photos", () => {
  it("only a Crew photo has a full-size copy, beside it", () => {
    expect(fullAvatarPath("u1/community-1731999999999.jpg")).toBe("u1/community-1731999999999-full.jpg");
    expect(fullAvatarPath("u1/community-1731999999999-full.jpg")).toBeNull();
    expect(fullAvatarPath("u1/profile-123.jpg")).toBeNull();
    expect(fullAvatarPath("https://example.com/a.jpg")).toBeNull();
    expect(fullAvatarPath(null)).toBeNull();
  });

  it("the copy is shared exactly when its photo is (the SQL undoes fullAvatarPath)", () => {
    const sql = read("supabase/migrations/20270419100000_full_size_crew_photos.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.avatar_is_shared(_name text)");
    expect(sql).toContain("_name LIKE '%/community-%-full.jpg'");
    expect(sql).toContain("cp.avatar_path = left(_name, -9) || '.jpg'");
    // the coach's team photo and the photo itself are still shared as before
    expect(sql).toContain("cp.avatar_path = _name");
    expect(sql).toContain("co.profile_picture_url = _name");
    const full = fullAvatarPath("u1/community-42.jpg")!;
    expect(full.slice(0, -9) + ".jpg").toBe("u1/community-42.jpg");
  });

  it("uploads save both sizes and removing a photo removes both", () => {
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("COMMUNITY_AVATAR_PX = 512");
    expect(media).toContain("COMMUNITY_AVATAR_FULL_PX = 1080");
    expect(media).toContain("bucket.upload(fullAvatarPath(path)!, full!");
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain('remove(communityAvatarFiles(previous))');
    expect(q).toContain('remove(communityAvatarFiles(path))');
  });
});

describe("one photo viewer, everywhere", () => {
  it("UserAvatar opens the shared viewer (no lightbox of its own)", () => {
    const av = read("src/components/user-avatar.tsx");
    expect(av).toContain('import { useMediaViewer } from "@/components/media-viewer";');
    expect(av).toContain('shape: "circle"');
    expect(av).toContain("better: full ? () => resolveAvatarUrl(full) : null");
    expect(av).not.toContain("DialogContent");
    // a missing or broken photo opens nothing: the initials stay a plain circle
    expect(av).toContain("const canExpand = expandable && !!url && !failed;");
  });

  it("chat photos go through the same viewer, and the old second lightbox is gone", () => {
    const mv = read("src/components/media-viewer.tsx");
    expect(mv).toContain("<PhotoViewer");
    expect(mv).not.toContain("function ImageViewer");
    expect(existsSync("src/components/chat-image-lightbox.tsx")).toBe(false);
  });

  it("is a Radix dialog layer, so a sheet underneath never closes with it", () => {
    const pv = read("src/components/photo-viewer.tsx");
    expect(pv).toContain('import * as DialogPrimitive from "@radix-ui/react-dialog";');
    expect(pv).toContain("onEscapeKeyDown");
    expect(pv).toContain("onPointerDownOutside={(e) => e.preventDefault()}");
    expect(pv).toContain("touch-none");
    expect(pv).toContain('aria-label="Close"');
  });

  it("profile headers: a tap views the photo, editing has its own button", () => {
    const pv = read("src/components/community/profile-view.tsx");
    // with no story up a tap opens the photo big; with one, it plays the story (story-ring.tsx)
    expect(pv).toContain("<StoryAvatar userId={profile.author.user_id} src={profile.author.avatar_url} name={profile.author.name} size={78} expandable story={story} />");
    expect(pv).toContain("data-profile-photo-change");
    const acct = read("src/routes/_authenticated/portal/account.tsx");
    expect(acct).toContain("<UserAvatar src={form.profile_picture_url} name={displayName} size={56} />");
    expect(acct).toContain("data-account-photo-change");
    // the client's chat header: their coach's photo opens big
    const msgs = read("src/routes/_authenticated/portal/messages.tsx");
    // (no decorative ring: a ring around a photo only ever means a story)
    expect(msgs).toMatch(/src=\{coach\?\.profile_picture_url \?\? null\}\s*name=\{coachName\}\s*size=\{40\}\s*\/>/);
  });
});
