import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEED_MAX_ASPECT,
  FEED_VIDEO_MAX_HEIGHT,
  VIDEO_MIN_ASPECT,
  feedAspect,
  videoAspect,
} from "@/lib/photo-frame";
import { REEL_SLOTS, reelIndexAt, reelItems, reelLoaded, reelSlot, reelStart } from "@/lib/reels";
import { postMediaExtras } from "@/lib/community.queries";
import type { CommunityPost } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

function post(id: string, over: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id,
    media_path: null,
    media_thumb_path: null,
    media_type: null,
    media_width: null,
    media_height: null,
    extra_media: null,
    ...over,
  } as unknown as CommunityPost;
}

const film = post("film", {
  media_path: "u/film/1.mp4",
  media_thumb_path: "u/film/1.jpg",
  media_type: "video",
  media_width: 1080,
  media_height: 1920,
  extra_media: [
    {
      path: "u/film/2.mp4",
      thumb: "u/film/2.jpg",
      type: "video",
      width: 1080,
      height: 1920,
      focus: null,
    },
    {
      path: "u/film/p.jpg",
      thumb: "u/film/p_t.jpg",
      type: "image",
      width: 1080,
      height: 1350,
      focus: null,
    },
    { path: "u/film/3.mp4", thumb: null, type: "video", width: 1920, height: 1080, focus: null },
  ],
} as Partial<CommunityPost>);
const photo = post("photo", {
  media_path: "u/p.jpg",
  media_thumb_path: "u/p_t.jpg",
  media_type: "image",
  media_width: 1080,
  media_height: 1350,
});
const clip = post("clip", {
  media_path: "u/c.mp4",
  media_thumb_path: "u/c.jpg",
  media_type: "video",
  media_width: 720,
  media_height: 1280,
});
const words = post("words");

describe("a clip in the feed shows whole, at its own shape", () => {
  it("a phone's 9:16 stays 9:16 (a picture is held to 4:5), a wide one 16:9, unknown is 4:5", () => {
    expect(videoAspect(1080, 1920)).toBeCloseTo(9 / 16, 6);
    expect(videoAspect(720, 1280)).toBeCloseTo(9 / 16, 6);
    // taller than a phone's screen recording: the frame stops at 9:16 and the clip fits inside it
    expect(videoAspect(1080, 2400)).toBe(VIDEO_MIN_ASPECT);
    expect(videoAspect(1920, 1080)).toBeCloseTo(16 / 9, 2);
    expect(videoAspect(4000, 1000)).toBe(FEED_MAX_ASPECT);
    expect(videoAspect(null, null)).toBe(0.8);
    expect(videoAspect(0, 1920)).toBe(0.8);
    // the same clip as a picture would be cut to 4:5
    expect(feedAspect(1080, 1920)).toBe(0.8);
    expect(FEED_VIDEO_MAX_HEIGHT).toBe("calc(100svh - 15rem)");
  });

  it("the frame takes the clip's shape, as tall as the screen allows, and every clip fits inside it", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain('const clipCover = !fixed && !lead && cover?.type === "video";');
    expect(card).toContain(
      'return post.media_type === "video" ? videoAspect(post.media_width, post.media_height) : feedAspect(post.media_width, post.media_height);',
    );
    expect(card).toContain("{ aspectRatio: String(ratio), maxHeight: FEED_VIDEO_MAX_HEIGHT }");
    expect(card).toContain(
      '<InlineVideo path={slide.path} poster={thumbUrl} active={active} position={position} fit={fit} controls={shrunk ? "corner" : page ? "top" : "bottom"} />',
    );
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('fit === "contain" ? "object-contain" : "object-cover"');
    // a crop's focus only matters where it's cropped
    expect(inline).toContain(
      'style={between ? POSTER_BETWEEN_BARS : position && fit === "cover" ? { objectPosition: position } : undefined}',
    );
  });
});

describe("full-screen clips, one per swipe", () => {
  it("every clip in the feed in order, a workout film's sets one after another, photos and word posts left out", () => {
    const items = reelItems([words, film, photo, clip]);
    expect(items.map((i) => i.slide.path)).toEqual([
      "u/film/1.mp4",
      "u/film/2.mp4",
      "u/film/3.mp4",
      "u/c.mp4",
    ]);
    expect(items.map((i) => `${i.clip}/${i.clips}`)).toEqual(["1/3", "2/3", "3/3", "1/1"]);
    expect(items[0].key).toBe("film:u/film/1.mp4");
    // the same post twice (a repost moved up) is one set of pages
    expect(reelItems([film, film])).toHaveLength(3);
  });

  it("opens on the clip that was tapped, else the post's first clip, else the first", () => {
    const items = reelItems([film, clip]);
    expect(reelStart(items, "film", "u/film/2.mp4")).toBe(1);
    expect(reelStart(items, "clip", "u/c.mp4")).toBe(3);
    expect(reelStart(items, "film", "gone.mp4")).toBe(0);
    expect(reelStart(items, "clip", null)).toBe(3);
    expect(reelStart(items, "nope", null)).toBe(0);
  });

  it("only the clip on screen and the one either side hold a video; neighbours never share an element", () => {
    expect(REEL_SLOTS).toBe(3);
    expect([4, 5, 6].map((i) => reelLoaded(i, 5))).toEqual([true, true, true]);
    expect(reelLoaded(3, 5)).toBe(false);
    expect(reelLoaded(7, 5)).toBe(false);
    for (let a = 1; a < 20; a++)
      expect(new Set([reelSlot(a - 1), reelSlot(a), reelSlot(a + 1)]).size).toBe(3);
    expect(reelIndexAt(0, 800, 4)).toBe(0);
    expect(reelIndexAt(1190, 800, 4)).toBe(1);
    expect(reelIndexAt(1210, 800, 4)).toBe(2);
    expect(reelIndexAt(99_999, 800, 4)).toBe(3);
    expect(reelIndexAt(400, 0, 4)).toBe(0);
  });

  it("the viewer: three pooled elements unlocked by the tap, the feed's clips held still underneath, ❤️ 💬 🔊", () => {
    const viewer = read("src/components/community/reels-viewer.tsx");
    expect(viewer).toContain("const v = reelVideo(slot);");
    expect(viewer).toContain("useEffect(() => holdFeedVideos(), []);");
    expect(viewer).toContain("snap-y snap-mandatory overflow-y-scroll");
    expect(viewer).toContain("snap-start snap-always");
    expect(viewer).toContain('import { reelVideo } from "@/lib/video-pool";');
    expect(viewer).toContain("if (!post.my_reaction) like(true);");
    expect(viewer).toContain("onClick={() => onOpenComments(post)}");
    const pool = read("src/lib/video-pool.ts");
    expect(pool).toContain("reels = Array.from({ length: REEL_SLOTS }, () => {");
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain(
      "const shouldPlay = active && visible && !held && !holdPaused && !!el && (auto || tapped) && !failed;",
    );
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("<ReelsViewer start={reel} posts={feedPosts}");
    expect(screen).toContain("onOpenReel={openReel}");
  });
});

describe("the feed loads ahead of the scroll", () => {
  it("signs every clip and every carousel thumbnail with the page, in one round trip", () => {
    expect(postMediaExtras(film)).toEqual([
      "u/film/1.mp4",
      "u/film/2.mp4",
      "u/film/2.jpg",
      "u/film/p_t.jpg",
      "u/film/3.mp4",
    ]);
    expect(postMediaExtras(photo)).toEqual([]);
    expect(postMediaExtras(clip)).toEqual(["u/c.mp4"]);
    expect(postMediaExtras(words)).toEqual([]);
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("queryFn: () => signCommunityPaths([...covers, ...extras]),");
  });

  it("a clip's link and header two screens away, the whole clip within a screen; a card painted two screens ahead; photos never held back", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('{ rootMargin: "200% 0px" }');
    expect(inline).toContain('{ rootMargin: "100% 0px" }');
    expect(inline).toContain(
      'if (el) el.preload = soon && active && (auto || tapped) ? "auto" : "metadata";',
    );
    expect(inline).toContain("useFullMediaUrl(path, near);");
    expect(read("src/components/community/post-art.tsx")).toContain('{ rootMargin: "200%" },');
    const card = read("src/components/community/post-card.tsx");
    const fade = card.slice(
      card.indexOf("function FadeImg"),
      card.indexOf("function PostCarousel"),
    );
    expect(fade).not.toContain('loading="lazy"');
    // posts below the first screenful have finished easing in before they're scrolled to
    expect(read("src/components/community/feed-motion.tsx")).toContain(
      '{ rootMargin: "0px 0px 150% 0px", threshold: 0.01 }',
    );
  });
});
