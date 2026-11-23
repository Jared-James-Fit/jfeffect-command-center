import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMERA_PARALLAX,
  CREATE_COMMIT_SHARE,
  cameraUnderFeed,
  CREATE_NO_START,
  createProgress,
  createSettleMs,
  createSwipeCommits,
  createSwipeIntent,
  swipeSpeed,
} from "@/lib/swipe-to-create";
import { MODE_SWIPE_PX, modeAfterSwipe } from "@/lib/mode-selector";

const read = (p: string) => readFileSync(p, "utf8");

describe("swipe to create: which finger is pulling the camera in", () => {
  it("waits until the finger has moved, then takes only a sideways move to the right", () => {
    expect(createSwipeIntent(4, 3)).toBe("wait");
    expect(createSwipeIntent(30, 6)).toBe("mine");
    // left is a carousel's (the recap) or nothing: never this
    expect(createSwipeIntent(-30, 2)).toBe("theirs");
    // up or down is the feed's
    expect(createSwipeIntent(4, 30)).toBe("theirs");
    expect(createSwipeIntent(3, -40)).toBe("theirs");
  });
  it("a diagonal is the feed's, not the camera's", () => {
    expect(createSwipeIntent(20, 18)).toBe("theirs");
    expect(createSwipeIntent(26, 18)).toBe("mine");
  });
  it("the page already moving under the finger is a scroll, whatever the direction", () => {
    expect(createSwipeIntent(40, 0, true)).toBe("theirs");
  });
});

describe("swipe to create: letting go", () => {
  const W = 390;
  it("the camera follows the finger, never past the screen", () => {
    expect(createProgress(0, W)).toBe(0);
    expect(createProgress(195, W)).toBeCloseTo(0.5);
    expect(createProgress(900, W)).toBe(1);
    expect(createProgress(-20, W)).toBe(0);
    expect(createProgress(100, 0)).toBe(0);
  });
  it("opens past a third of the screen, or on a flick toward it", () => {
    expect(createSwipeCommits(W * CREATE_COMMIT_SHARE + 1, W, 0)).toBe(true);
    expect(createSwipeCommits(80, W, 0.1)).toBe(false);
    expect(createSwipeCommits(60, W, 0.8)).toBe(true);
    // a flick too short to mean it
    expect(createSwipeCommits(20, W, 1.2)).toBe(false);
    // pulled far, then flicked back: it goes back
    expect(createSwipeCommits(250, W, -0.9)).toBe(false);
  });
  it("the rest of the slide is quick and never slower than the finger was", () => {
    expect(createSettleMs(0.5, true, 0, W)).toBe(150);
    expect(createSettleMs(0.9, true, 0, W)).toBe(120);
    expect(createSettleMs(0.1, true, 0, W)).toBeLessThanOrEqual(300);
    // a fast flick lands fast
    expect(createSettleMs(0.3, true, 2, W)).toBe(137);
    expect(createSettleMs(0.3, false, 0, W)).toBe(120);
  });
  it("the finger's speed is read over its last moments", () => {
    expect(swipeSpeed([{ x: 0, t: 0 }])).toBe(0);
    expect(swipeSpeed([{ x: 0, t: 0 }, { x: 10, t: 200 }, { x: 60, t: 250 }, { x: 110, t: 300 }])).toBeCloseTo(1);
  });
  it("starts anywhere on a post (a button too: a pull is never its tap), never in a text box or a scrub bar", () => {
    expect(CREATE_NO_START).not.toMatch(/(^|, )button/);
    for (const sel of ["input", "textarea", "[role=slider]", "[data-video-scrubber]", "[data-no-create-swipe]"]) expect(CREATE_NO_START).toContain(sel);
  });
});

describe("swipe to create: the feed is pushed off, the camera is underneath (Instagram's)", () => {
  it("the camera's right edge is always the feed's edge, whatever the progress", () => {
    const W = 390;
    for (const p of [0, 0.1, 0.33, 0.5, 0.8, 1]) {
      const { shiftPct, clipRightPct } = cameraUnderFeed(p);
      // the camera's box is shifted, then clipped from its right: its visible right edge on screen
      const right = W + (shiftPct / 100) * W - (clipRightPct / 100) * W;
      expect(right).toBeCloseTo(p * W, 6);
    }
  });
  it("it moves a third as fast as the feed, and is dimmed until it's in", () => {
    expect(CAMERA_PARALLAX).toBeCloseTo(0.3);
    expect(cameraUnderFeed(0)).toEqual({ shiftPct: -30, clipRightPct: 70, dim: 0.5 });
    expect(cameraUnderFeed(1)).toEqual({ shiftPct: -0, clipRightPct: 0, dim: 0 });
  });
});

describe("POST · STORY: the selector's swipe", () => {
  it("the camera's row moves with the finger: left brings the next one in", () => {
    expect(modeAfterSwipe(0, 2, -MODE_SWIPE_PX - 1, 0, "row")).toBe(1);
    expect(modeAfterSwipe(1, 2, MODE_SWIPE_PX + 1, 0, "row")).toBe(0);
    expect(modeAfterSwipe(0, 2, -10, 0, "row")).toBe(0);
  });
  it("the pill's highlight moves with the finger: right is the next one", () => {
    expect(modeAfterSwipe(0, 2, 40, 0, "thumb")).toBe(1);
    expect(modeAfterSwipe(0, 2, -40, 0, "thumb")).toBe(0);
  });
  it("a flick back at the end wins, and it never goes past either end", () => {
    expect(modeAfterSwipe(0, 2, -40, 0.6, "row")).toBe(0);
    expect(modeAfterSwipe(1, 2, -80, -1, "row")).toBe(1);
    expect(modeAfterSwipe(0, 2, 80, 1, "row")).toBe(0);
  });
});

describe("Crew's create flow, wired", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const hook = read("src/components/community/swipe-to-create.tsx");
  const btn = read("src/components/community/share-workout-picker.tsx");
  const studio = read("src/components/community/share-studio.tsx");
  const composer = read("src/components/community/post-composer.tsx");
  const selector = read("src/components/community/mode-selector.tsx");

  it("the swipe is the clients' paged feed's only (never a coach's preview), opening the + button's story camera", () => {
    expect(screen).toContain("useSwipeToCreate({ enabled: paging && canShare && !coach && !previewOnly, onOpen: () => cameraRef.current?.() })");
    expect(screen).toContain("cameraRef={cameraRef}");
    expect(btn).toContain('cameraRef.current = () => beginStory("swipe");');
  });
  it("it reads touches before anything on a post, steps aside for everything that's theirs, and asks for the camera in the touch's end", () => {
    expect(hook).toContain('document.addEventListener("touchmove", move, { passive: false, capture: true });');
    expect(hook).toContain("if (scrolledAcross(target)) return;");
    expect(hook).toContain("if (page && inClipScrubBand(page, x, y)) return;");
    expect(hook).toContain("if (target.closest(CREATE_NO_START) || screenBusy()) return;");
    expect(hook).toContain("if (inSafariTab() && x < SAFARI_EDGE_PX) return;");
    expect(hook).toContain("if (e.touches.length !== 1) return void cancel();");
    // the camera's ask goes out inside the touchend (iOS reuses an Allow only from a tap)
    const end = hook.slice(hook.indexOf("const end = (e: TouchEvent)"), hook.indexOf("const cancel = ()"));
    expect(end).toContain("openRef.current();");
    expect(end).toContain("swallowClick();");
    // the stand-in hands over to the real camera once it's there
    expect(end).toContain('document.querySelector("[data-share-studio]")');
    expect(studio).toContain("data-share-studio={kind}");
  });
  it("the camera slides in from the left and back out that way (the + and the swipe), fades when switched to from Post", () => {
    expect(studio).toContain('animation: `jf-camera-in ${ENTER_MS}ms ${SLIDE_EASE} both`');
    // closing: the camera a third slower than the feed sliding back over it, clipped at its edge
    expect(studio).toContain('transform: "translate3d(-30%,0,0)", clipPath: "inset(0 70% 0 0)"');
    expect(studio).toContain("window.dispatchEvent(new CustomEvent(CAMERA_LEAVE_EVENT, { detail: { ms } }));");
    expect(studio).toContain("window.dispatchEvent(new CustomEvent(CAMERA_ENTER_EVENT, { detail: { ms } }));");
    // the feed, both its bars and its rounded edge move together
    const hook = read("src/components/community/swipe-to-create.tsx");
    expect(hook).toContain('const FEED_LAYERS = "[data-feed-pager], [data-crew-bar], [data-mobile-bottom-nav]";');
    expect(hook).toContain("window.addEventListener(CAMERA_LEAVE_EVENT, onLeave);");
    expect(hook).toContain("data-create-swipe-edge");
    expect(btn).toContain('setCamVia(how === "post" ? { entry: "fade", from: "post" } : { entry: how === "swipe" ? "none" : "slide", from: null });');
    expect(btn).toContain('setPostVia(fromCamera ? { entry: "fade", from: "story" } : { entry: "rise", from: null });');
    expect(read("src/styles.css")).toContain("@keyframes jf-camera-in");
  });
  it("only the modes Crew has: Post and Story, the one selector in the camera and the New post screen", () => {
    expect(selector).toMatch(/export const CAMERA_MODES: CreateMode\[\] = \[\n {2}\{ key: "post", label: "Post" \},\n {2}\{ key: "story", label: "Story" \},\n\];/);
    expect(composer).toContain('<ModeSelector variant="pill" modes={CAMERA_MODES} value="post" onChange={(k) => k === "story" && toStory()} enterFrom={modeFrom} className="pointer-events-auto" />');
    expect(studio).not.toContain("function ModeTabs");
    expect(composer).not.toContain("function KindPill");
  });
  it("the flash is offered only where it can fire: the back camera's light, or the screen for a selfie", () => {
    // (and steps away while it films: only the clip's time sits there then)
    expect(studio).toContain('{status === "live" && (facing === "user" || torchOk) && !recorder.recording && (');
    expect(studio).toContain("setTorchOk(torchSupported(stream.getVideoTracks()[0]));");
    expect(studio).toContain("data-studio-screen-flash");
    // in the middle of the top, Instagram's
    expect(studio).toContain('className={cn("absolute left-1/2 top-2.5 -translate-x-1/2", pill, flashOn && "bg-white text-black")}');
  });
  it("the camera's tools are a rail down the left, names first then icons, only what works right now", () => {
    expect(studio).toContain("<CameraRail");
    expect(studio).toContain('setTimeout(() => setRailLabels(false), RAIL_LABELS_MS)');
    // Type: a words story on a colour (the story reply's backdrop), the keyboard up, the colour wheel to change it
    expect(studio).toContain('story && !card && canShoot && !adding && !reply && !share');
    expect(studio).toContain('freeze({ src: paintReplyBackdrop(0), file: null, live: false, at: new Date() });\n    // a colour is the picture as it is');
    expect(studio).toContain("data-studio-typed-colour");
    // the active mode is bold white, no dot (Instagram's)
    expect(selector).not.toContain("rounded-full bg-white\" aria-hidden />");
  });
  it("nothing is lost by accident: leaving, retaking a photo with words on it and switching to Story ask first", () => {
    expect(studio).toContain('setDiscard({ title: story ? "Discard story?" : "Discard post?"');
    expect(studio).toContain('setDiscard({ title: "Discard edits?"');
    expect(studio).toContain("<Dialog open={open} onOpenChange={(o) => !o && requestLeave()}>");
    expect(composer).toContain('if (dirty && !posted) return setConfirm("story");');
    expect(composer).toContain("const toStory = () => {");
  });
});
