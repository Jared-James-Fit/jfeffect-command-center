import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FEED_AHEAD, FEED_BEHIND, feedPostMounted } from "@/lib/feed-window";
import {
  CAROUSEL_PLACES_MAX,
  carouselPlace,
  forgetCarouselPlaces,
  rememberCarouselPlace,
} from "@/lib/carousel-places";
import { LINE_SYNC_SLACK_MS, lineDriftMs, lineTimeMs } from "@/lib/video-scrub";

/**
 * Crew's feed and carousels stay responsive under a finger (Nov 23 2026).
 * Measured with a throttled phone (Chromium, 4× CPU) on the real app: swipes
 * failed or landed late because document-wide blocking touch listeners made
 * every touch wait on a main thread kept busy by re-rendering every post,
 * mounting closed sheets, re-layering the page every frame a clip played, and
 * decoding pictures on the main thread mid-swipe.
 */
const read = (p: string) => readFileSync(p, "utf8");
const screen = read("src/components/community/community-screen.tsx");
const card = read("src/components/community/post-card.tsx");
const scrubber = read("src/components/community/video-scrubber.tsx");
const queries = read("src/lib/community.queries.ts");
const root = read("src/routes/__root.tsx");
const ddt = read("src/lib/drag-drop-touch.ts");
const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");

describe("feed window", () => {
  it("keeps the first post and the ones around the post on screen", () => {
    expect(FEED_BEHIND).toBe(2);
    expect(FEED_AHEAD).toBe(3);
    expect(feedPostMounted(0, 20)).toBe(true);
    expect(feedPostMounted(10, 10)).toBe(true);
    expect(feedPostMounted(8, 10)).toBe(true);
    expect(feedPostMounted(7, 10)).toBe(false);
    expect(feedPostMounted(13, 10)).toBe(true);
    expect(feedPostMounted(14, 10)).toBe(false);
    // moments (people to follow, all caught up) aren't posts and are always there
    expect(feedPostMounted(-1, 10)).toBe(true);
  });
  it("a post outside it is a black box of the same height, the window moving in a transition", () => {
    expect(screen).toContain(
      '{feedPostMounted(postIndex[i], around) ? pg.node : <div className="h-full w-full bg-black" aria-hidden data-feed-placeholder />}',
    );
    expect(screen).toMatch(/startTransition\(\(\) => setAround\(k\)\)/);
    expect(screen).toMatch(/threshold: \[0\.5\]/);
  });
  it("a post row only re-renders when its own props change", () => {
    expect(screen).toMatch(/const PostRow = memo\(function PostRow/);
    expect(screen).toMatch(/const onReact = useCallback\(/);
    expect(screen).toContain(
      "const openAuthor = useCallback((a: CommunityAuthor) => openAuthorRef.current(a), []);",
    );
  });
});

describe("carousel", () => {
  beforeEach(() => forgetCarouselPlaces());
  it("opens a post it let go on the slide it was left on", () => {
    expect(carouselPlace("page:a", 4)).toBe(0);
    rememberCarouselPlace("page:a", 2);
    expect(carouselPlace("page:a", 4)).toBe(2);
    // never past the last slide (a post whose slides changed)
    expect(carouselPlace("page:a", 2)).toBe(1);
    expect(carouselPlace(undefined, 4)).toBe(0);
    rememberCarouselPlace("page:a", 0);
    expect(carouselPlace("page:a", 4)).toBe(0);
  });
  it("remembers at most so many posts, the oldest going first", () => {
    for (let i = 0; i <= CAROUSEL_PLACES_MAX; i++) rememberCarouselPlace(`k${i}`, 1);
    expect(carouselPlace("k0", 3)).toBe(0);
    expect(carouselPlace(`k${CAROUSEL_PLACES_MAX}`, 3)).toBe(1);
  });
  it("never re-renders mid-swipe: the counter is written straight in and the slide settles at the end", () => {
    expect(card).toMatch(
      /if \(text && text\.nodeType === Node\.TEXT_NODE\) text\.nodeValue = `\$\{i \+ 1\}\/\$\{count\}`;/,
    );
    expect(card).toMatch(/if \(Math\.abs\(x - i\) < SLIDE_SETTLED\) return settleOn\(i\);/);
    expect(card).toMatch(/el\.addEventListener\("scrollend", end\);/);
    expect(card).toMatch(/const SLIDE_SETTLE_MS = 140;/);
  });
  it("slides near the one showing are mounted, the full-size photo only for the slide on screen and the next", () => {
    expect(card).toMatch(/const near = Math\.abs\(i - index\) <= SLIDES_AHEAD \|\| i < seen;/);
    expect(card).toContain("useFullMediaUrl(slide.path, full && (active || !!warm) && !isVideo)");
    expect(card).toMatch(/place=\{`page:\$\{post\.id\}`\}/);
  });
  it("a picture is never blanked: the sharper one is decoded before it replaces the one showing", () => {
    expect(card).toMatch(/const shownPictures = new Set<string>\(\);/);
    expect(card).toMatch(
      /if \(typeof next\.decode === "function"\) next\.decode\(\)\.then\(swap, swap\);/,
    );
  });
  it("the soft backdrop behind a photo is drawn only once the screen is still", () => {
    expect(card).toMatch(/void whenStill\(\)\.then\(\(\) => \{/);
  });
});

describe("scrubber line", () => {
  it("runs as one compositor animation, never a style write per frame", () => {
    expect(scrubber).toMatch(
      /f\.animate\(\[\{ transform: "scaleX\(0\)" \}, \{ transform: "scaleX\(1\)" \}\]/,
    );
    expect(scrubber).toMatch(
      /lineDriftMs\(lineTimeMs\(at, len\), Number\(a\.currentTime \?\? 0\), dur\) > LINE_SYNC_SLACK_MS/,
    );
  });
  it("puts the line inside one round of the clip and measures drift around the loop", () => {
    expect(lineTimeMs(0, 10)).toBe(0);
    expect(lineTimeMs(4.5, 10)).toBe(4500);
    expect(lineTimeMs(10, 10)).toBe(9999);
    expect(lineTimeMs(-1, 10)).toBe(0);
    expect(lineTimeMs(3, 0)).toBe(0);
    expect(lineDriftMs(4500, 4400, 10_000)).toBe(100);
    // just past the loop is close to just before it
    expect(lineDriftMs(50, 9950, 10_000)).toBe(100);
    expect(lineDriftMs(14_500, 4500, 10_000)).toBe(0);
    expect(lineDriftMs(1, 2, 0)).toBe(0);
    expect(LINE_SYNC_SLACK_MS).toBeGreaterThan(16);
  });
});

describe("nothing blocks a swipe that isn't its own", () => {
  it("the drag-and-drop polyfill is never loaded for the whole app", () => {
    expect(root).not.toMatch(/import\("drag-drop-touch"\)/);
    expect(ddt).toContain('import("drag-drop-touch/DragDropTouch.js?raw")');
    expect(ddt).toMatch(/if \(type\.startsWith\("touch"\)\) held\.push\(\[type, fn, opts\]\);/);
    expect(ddt).toMatch(
      /for \(const \[type, fn, opts\] of held\) el\.addEventListener\(type, fn, opts\);/,
    );
    expect(ddt).toMatch(
      /if \(el\) for \(const \[type, fn, opts\] of held\) el\.removeEventListener\(type, fn, opts\);/,
    );
    expect(editor).toContain("useDragDropTouch(dragRoot, !phone);");
    expect(editor).toContain("<div ref={dragRoot}");
  });
  it("a like never reloads the feed's pages under a finger", () => {
    const react = queries.slice(
      queries.indexOf("export function useReact("),
      queries.indexOf("export function useReact(") + 3000,
    );
    expect(react).toContain(
      'qc.invalidateQueries({ queryKey: ["community-feed"], refetchType: "none" });',
    );
  });
  it("a post's sheets and dialogs are only mounted once they've been opened", () => {
    const hook = read("src/hooks/use-opened-once.ts");
    expect(hook).toMatch(/if \(open\) opened\.current = true;/);
    expect(read("src/components/community/reactors-sheet.tsx")).toContain(
      "return useOpenedOnce(!!props.postId) ? <ReactorsSheetBody {...props} /> : null;",
    );
    const actions = read("src/components/community/post-actions.tsx");
    for (const name of ["deleteMounted", "editMounted", "stickerMounted"])
      expect(actions).toContain(`const ${name} = useOpenedOnce(`);
    expect(read("src/components/community/post-views.tsx")).toContain(
      "const activityMounted = useOpenedOnce(open);",
    );
    expect(read("src/components/community/repost-save.tsx")).toContain(
      "const pickerMounted = useOpenedOnce(picker);",
    );
  });
});
