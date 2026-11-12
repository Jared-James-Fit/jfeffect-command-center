import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postMediaRatio } from "@/components/community/post-card";
import type { CommunityPost } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("Crew's feed: one post per screen, swiped one at a time", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const card = read("src/components/community/post-card.tsx");
  const css = read("src/styles.css");

  it("the clients' Crew pages its feed; the coach's Crew page keeps its working cards", () => {
    expect(screen).toContain('const paging = ownBar && scope.kind === "feed";');
    expect(screen).toContain('root.classList.add("feed-paging");');
    expect(screen).toContain('layout="page"');
    // Crew's bar stays put while paging: the screens are sized to it
    expect(screen).toContain('useBarHidden(ownBar && scope.kind === "feed" && !paging)');
  });

  it("the window snaps to each screen, one per swipe, and nothing between it and the posts traps the snapping", () => {
    expect(css).toContain("html.feed-paging { scroll-snap-type: y mandatory; }");
    expect(css).toMatch(
      /\.feed-page \{\s*height: calc\(100svh - var\(--feed-page-top\)\);\s*scroll-snap-align: start;\s*scroll-snap-stop: always;/,
    );
    // a hidden overflow makes a box a scroll container that keeps the snap points from the window
    expect(css).toContain("html.feed-paging main { overflow-x: clip; }");
    expect(css).toContain("html.feed-paging body,");
    expect(css).toContain("html.feed-paging [data-shell-root],");
    expect(read("src/components/app-shell.tsx")).toContain("data-shell-root>");
    // under Crew's bar on a phone; on a computer the bar scrolls away
    expect(css).toContain(
      "--feed-page-top: calc(var(--app-chrome-top) + var(--app-safe-top) + 3rem);",
    );
    expect(css).toContain("@media (min-width: 768px) { :root { --feed-page-top: 0px; } }");
  });

  it("the first screen is the stories and the first post; its snap point is the very top (a pull there still refreshes)", () => {
    expect(css).toContain(
      ".feed-first { scroll-snap-align: start; scroll-snap-stop: always; scroll-margin-top: 100vh; }",
    );
    expect(screen).toContain(
      '<div ref={firstScreen} className="feed-first flex flex-col" data-feed-first>',
    );
    expect(screen).toContain("const h = `calc(100svh - ${top}px)`;");
  });

  it("the feed's own moments get a screen when they have something to show, never an empty one", () => {
    expect(css).toContain(".feed-page:empty { display: none; }");
    expect(screen).toContain('key: "caught-up"');
    expect(screen).toContain('key: "suggested"');
    expect(screen).toContain('key: "share-nudge"');
    // more on the way: a screen of its own, replaced by the posts it was waiting for
    expect(screen).toContain(
      '<div className="feed-page grid place-items-center text-muted-foreground" role="status" aria-label="Loading more posts" data-feed-more>',
    );
  });

  it("a post's screen: the picture as big as it fits on black, the name and words over the bottom, the buttons down the right", () => {
    expect(card).toContain('if (layout === "page") {');
    expect(card).toContain("<FitBox ratio={auto ? 0.8 : postMediaRatio(post)}>");
    expect(card).toContain("width: `min(100cqw, calc(100cqh * ${ratio}))`");
    expect(card).toContain(
      "<ReactionBar post={post} onReact={onReact} onOpenComments={onOpenComments} onOpenAuthor={onOpenAuthor} onReposted={note.ask} unit={unit} column />",
    );
    // above the floating tab bar
    expect(card).toContain('style={{ bottom: "var(--bottom-nav-clearance)" }}');
    // pictures sit on black whatever the theme; words, workouts and lock ins follow the theme
    expect(card).toContain('visual ? "dark bg-black" : "bg-background"');
  });

  it("on its own screen a clip is already full size: a tap pauses it, two taps ❤️", () => {
    expect(card).toContain("clip.dispatchEvent(new Event(CLIP_TOGGLE_EVENT));");
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("box.addEventListener(CLIP_TOGGLE_EVENT, toggle);");
    expect(inline).toContain("if (!visible || !active) setUserPaused(false);");
    // its set's caption and speaker sit at the top, clear of the words and buttons
    expect(card).toContain(
      "<SlideCaption caption={slide.caption} withDots={withDots} top={page} />",
    );
    expect(inline).toContain('controls === "top" ? "top-12" : "bottom-2.5"');
  });

  it("a picture's shape on its screen is the feed's own: a clip its own (9:16 to 16:9), a photo 4:5 to 16:9", () => {
    const post = (over: Partial<CommunityPost>) =>
      ({ media_path: "x", media_thumb_path: null, extra_media: null, ...over }) as CommunityPost;
    expect(
      postMediaRatio(post({ media_type: "video", media_width: 1080, media_height: 1920 })),
    ).toBeCloseTo(9 / 16, 6);
    expect(
      postMediaRatio(post({ media_type: "image", media_width: 1080, media_height: 1920 })),
    ).toBe(0.8);
    expect(
      postMediaRatio(post({ media_type: "image", media_width: 1080, media_height: 1080 })),
    ).toBe(1);
    expect(
      postMediaRatio(post({ media_type: "video", media_width: 1080, media_height: 1920 }), true),
    ).toBe(0.8);
  });
});
