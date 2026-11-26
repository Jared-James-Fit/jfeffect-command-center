import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionParagraphs, choosePreviewStop, cutPreview, previewLine, previewStops, previewText, wordStops } from "@/lib/caption-preview";
import {
  POST_SHEET_FULL_HEIGHT,
  POST_SHEET_HEIGHT,
  SHEET_CLOSE_SHARE,
  SHEET_GROW_PX,
  sheetDragCloses,
  sheetDragGrows,
  sheetDragMode,
  sheetFullRelease,
} from "@/lib/post-sheet";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the caption on a feed screen: two lines and … more (Reels')", () => {
  it("keeps its paragraphs as lines of their own (never one run-on block), with no empty line spent between them", () => {
    expect(previewText("Your rest day is part of your program.\n\nNot a day you failed to train.  ")).toBe(
      "Your rest day is part of your program.\nNot a day you failed to train.",
    );
    expect(previewText("61 PRs last week.\n\n\nMarc hit 165lbs x 8.\nColten hit 145lbs x 10.")).toBe("61 PRs last week.\nMarc hit 165lbs x 8.\nColten hit 145lbs x 10.");
    expect(captionParagraphs("  one\n\n two \n three  \n\n\n")).toEqual(["one", "two\nthree"]);
  });

  it("stops where a thought does: the opener whole, else a sentence, else the last word that fits", () => {
    const fits = (room: number) => (stop: number) => stop <= room;
    // the opening paragraph fits: it's the preview, never run into the next one
    const wins = previewText("61 PRs across the crew last week.\n\nNew all-time PR for Alyssa on comp squat, 52.5kg x 2 + 1 more PR.");
    expect(choosePreviewStop(wins, fits(80))).toBe("61 PRs across the crew last week.".length);
    expect(previewLine(wins, choosePreviewStop(wins, fits(80)))).toBe("61 PRs across the crew last week… more");
    // one block: a sentence end that keeps a fair share of the room
    const block = "Most taper mistakes are overcorrections. Lifters keep all the work because they're scared strength will disappear.";
    expect(choosePreviewStop(block, fits(90))).toBe("Most taper mistakes are overcorrections.".length);
    // a sentence end too early to be worth it: the last word that fits
    const early = "Easy. Then the long part of the caption keeps going and going with more and more words in it.";
    expect(choosePreviewStop(early, fits(60))).toBe(wordStops(early).filter((w) => w <= 60).pop());
    // nothing fits: cut by lines
    expect(choosePreviewStop("Supercalifragilistic words", fits(3))).toBe(-1);
    expect(previewStops("a.\nb. c").lines).toEqual([2]);
  });

  it("can stop after any word, mid-sentence or not, never at the very end", () => {
    const t = "AUSTIN, TX - A survivor decided to collaborate on a tour";
    const stops = wordStops(t);
    expect(stops[0]).toBe("AUSTIN,".length);
    expect(stops).toContain(t.indexOf(" a tour"));
    expect(stops).not.toContain(t.length);
    expect(wordStops("one")).toEqual([]);
    // the cut reads like Reels': "on a… more" (a comma or period at the cut gives way to the …)
    expect(previewLine(t, t.indexOf(" tour"))).toBe("AUSTIN, TX - A survivor decided to collaborate on a… more");
    expect(cutPreview("Rest day, then", "Rest day,".length).shown).toBe("Rest day");
  });

  it("the page's words are the preview, and a tap opens the sheet", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<PageCaption text={post.caption} mentions={post.mentions} onOpen={() => onOpenCaption(post)} />");
    const cap = read("src/components/community/page-caption.tsx");
    expect(cap).toContain("export const PAGE_CAPTION_LINES = 2;");
    expect(cap).toContain("setCut(choosePreviewStop(text, (stop) => lines(previewLine(text, stop)) <= PAGE_CAPTION_LINES));");
    expect(cap).toContain("withHandles(previewText(typed), typedMentions)");
    // measured and shown with its lines kept
    expect(cap).toContain('"block whitespace-pre-line break-words"');
  });
});

describe("the post's sheet: the whole caption, then the comments, one swipe to close", () => {
  it("one swipe down closes it: a quarter of the way, or a flick", () => {
    const height = 520;
    expect(sheetDragCloses({ dy: height * SHEET_CLOSE_SHARE, ms: 900, height })).toBe(true);
    expect(sheetDragCloses({ dy: 80, ms: 100, height })).toBe(true); // a flick
    expect(sheetDragCloses({ dy: 60, ms: 600, height })).toBe(false); // a slow nudge springs back
    expect(sheetDragCloses({ dy: 20, ms: 10, height })).toBe(false); // too little to mean it
    expect(sheetDragCloses({ dy: 0, ms: 10, height })).toBe(false);
  });

  it("drags from the grip, the caption, or the comments only once they're at the top; never from the comment box", () => {
    const sheet = read("src/components/community/post-sheet.tsx");
    // the one swipe-down rule every bottom sheet shares (useSwipeDownToClose)
    expect(sheet).toContain("useSwipeDownToClose(node, open, closeNow, {");
    const hook = read("src/hooks/use-swipe-down-to-close.ts");
    expect(hook).toContain('target?.addEventListener("touchmove", onMove as EventListener, { passive: false });');
    expect(hook).toContain('if (t?.closest?.(NO_DRAG) || targetOwns(t, "y", el)) return;');
    expect(hook).toContain("if (scrolled && !(ex?.enabled && !ex.full)) return;");
    expect(hook).toContain(`const NO_DRAG = "input, textarea, select, [contenteditable='true'], [role='slider'], [data-no-sheet-drag]";`);
    expect(hook).toContain("if (sheetDragCloses({ dy, ms, height })) closeRef.current();");
    // never the keyboard on open
    expect(sheet).toContain("e.preventDefault();\n            content.current?.focus({ preventScroll: true });");
  });

  it("the caption sits above the comments in the same scroll; 💬 opens it at the comments", () => {
    const thread = read("src/components/community/comments-sheet.tsx");
    expect(thread).toContain('data-sheet-scroll={inline ? undefined : ""}');
    expect(thread).toContain("{header}\n        <div ref={commentsStart} aria-hidden className=\"h-0\" />");
    expect(thread).toContain("if (startAtComments && header && box && mark) box.scrollTop = mark.offsetTop;");
    const sheet = read("src/components/community/post-sheet.tsx");
    expect(sheet).toContain('startAtComments={item.at === "comments"}');
    expect(sheet).toContain("named={false}");
  });

  it("the post shrinks into the space above the sheet and its words and buttons step aside", () => {
    expect(POST_SHEET_HEIGHT).toBe("62svh");
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("style={{ top: -raise, bottom: sheetOpen ? `calc(${POST_SHEET_HEIGHT} - var(--feed-gap, 0px))` : \"var(--feed-nav-room)\" }}");
    // up to Crew's bar: under it once the post is up, over the stories on the first screen
    expect(card).toContain("setRaise(belowBar(a));");
    expect(card).toContain('document.querySelector("[data-crew-bar]")');
    expect(card).toContain('(sheetOpen || under || holding) && "pointer-events-none opacity-0"');
  });

  it("above the sheet it's a rounded card at its own shape (Instagram's), the same elements so a clip keeps playing", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toMatch(/<PostMedia\s+post=\{post\}\s+thumbUrl=\{thumbUrl\}\s+page\s+shrunk=\{sheetOpen\}\s+onSlide=\{showSlide\}/);
    expect(card).toContain("<FitBox ratio={ratio} screen shrunk={shrunk}>");
    expect(card).toContain("<FitBox ratio={0.8} page shrunk={sheetOpen}>");
    // only the boxes change: the screen until the sheet opens, then the post's own shape with room around it
    expect(card).toContain('style={whole ? { width: "100cqw", height: "100cqh" } : { width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))` }}');
    expect(card).toContain('shrunk && "overflow-hidden rounded-xl [isolation:isolate] [transform:translateZ(0)]"');
    // nothing across it: the speaker in its corner, no set caption
    expect(card).toContain('controls={shrunk ? "corner" : page ? "top" : "bottom"}');
    expect(card).toContain("{slide.caption && !shrunk && !page && <SlideCaption");
    const video = read("src/components/community/inline-video.tsx");
    expect(video).toContain('const askTap = sound && !silent && controls !== "corner" && (refused ? decodedNow : blocked);');
  });

  it("the paged feed opens it from … more and 💬; the coach's card feed keeps its comments sheet", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("onOpenComments={openCommentsSheet}\n                  onOpenCaption={openCaptionSheet}\n                  onOpenWorkout={openWorkoutSheet}\n                  sheetOpen={sheet?.post.id === p.id}");
    // the feed's screens and a post on its own screen (post-open.ts) share it
    expect(screen).toContain("{pagedLook && <PostSheet post={sheetPost}");
    expect(screen).toContain("<CommentsSheet post={commentsFor}");
  });
});

describe("the post's sheet opens up for a long caption or thread (Nov 21 2026)", () => {
  it("a drag up from half grows it with the finger, before anything inside scrolls", () => {
    expect(sheetDragMode(0, -20, { canGrow: true })).toBe("grow");
    expect(sheetDragMode(0, -20, { canGrow: false })).toBe("pass"); // already full: the list scrolls
    expect(sheetDragMode(30, -10, { canGrow: true })).toBe("pass"); // sideways: tabs or a carousel
    expect(sheetDragMode(0, 20, { canGrow: true })).toBe("drag");
    expect(sheetDragMode(2, -3, { canGrow: true })).toBe("wait");
  });

  it("lets go at full past a short drag or a flick, else back to half", () => {
    expect(sheetDragGrows({ up: SHEET_GROW_PX, ms: 800 })).toBe(true);
    expect(sheetDragGrows({ up: 40, ms: 50 })).toBe(true); // a flick
    expect(sheetDragGrows({ up: 30, ms: 600 })).toBe(false);
    expect(sheetDragGrows({ up: 0, ms: 10 })).toBe(false);
  });

  it("from full, a pull down goes back to half, and a long pull or a flick closes it", () => {
    const height = 760;
    expect(sheetFullRelease({ dy: 20, ms: 400, height })).toBe("full");
    expect(sheetFullRelease({ dy: 90, ms: 500, height })).toBe("half");
    expect(sheetFullRelease({ dy: 220, ms: 900, height })).toBe("close");
    expect(sheetFullRelease({ dy: 60, ms: 60, height })).toBe("close");
  });

  it("the grip opens it up or back with a tap, never while typing", () => {
    const sheet = read("src/components/community/post-sheet.tsx");
    expect(sheet).toContain('aria-label={full ? "Show less" : "Show more"}');
    expect(sheet).toContain("enabled: !vv?.keyboard,");
    expect(sheet).toContain("{ height: full ? POST_SHEET_FULL_HEIGHT : POST_SHEET_HEIGHT }");
    expect(POST_SHEET_FULL_HEIGHT).toContain("var(--app-safe-top");
  });

  it("the caption reads apart from the comments: its own row, full width, paragraphs as written", () => {
    const sheet = read("src/components/community/post-sheet.tsx");
    expect(sheet).toContain('<CaptionText text={caption.text} mentions={caption.mentions} onOpenPerson={onOpenAuthor} className="mt-2.5 text-[15px] leading-[1.5]" />');
    expect(sheet).not.toContain("whitespace-pre-line break-words text-[15px] leading-[1.45]");
    const thread = read("src/components/community/comments-sheet.tsx");
    expect(thread).toContain('text-[14px] leading-[1.45]" data-comment-body');
  });
});
