import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cutPreview, flatCaption, previewLine, wordStops } from "@/lib/caption-preview";
import { POST_SHEET_HEIGHT, SHEET_CLOSE_SHARE, sheetDragCloses } from "@/lib/post-sheet";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the caption on a feed screen: two lines and … more (Reels')", () => {
  it("reads line breaks as spaces so two lines show as much as they can", () => {
    expect(flatCaption("Your rest day is part of your program.\n\nNot a day you failed to train.  ")).toBe(
      "Your rest day is part of your program. Not a day you failed to train.",
    );
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
    expect(cap).toContain("lines(previewLine(text, stops[mid])) <= PAGE_CAPTION_LINES");
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
    expect(sheet).toContain('el.addEventListener("touchmove", onMove, { passive: false });');
    expect(sheet).toContain('if (list && list.scrollTop > 0) return;');
    expect(sheet).toContain('t?.closest?.("textarea, input, [contenteditable=\'true\']")');
    expect(sheet).toContain("if (sheetDragCloses({ dy, ms: e.timeStamp - startT, height: el.offsetHeight })) close();");
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
    expect(card).toContain('style={{ top: -raise, bottom: sheetOpen ? POST_SHEET_HEIGHT : "var(--feed-nav-room)" }}');
    // up to Crew's bar: under it once the post is up, over the stories on the first screen
    expect(card).toContain("setRaise(belowBar(a));");
    expect(card).toContain('document.querySelector("[data-crew-bar]")');
    expect(card).toContain('(sheetOpen || under) && "pointer-events-none opacity-0"');
  });

  it("the paged feed opens it from … more and 💬; the coach's card feed keeps its comments sheet", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("onOpenComments={openCommentsSheet}\n                  onOpenCaption={openCaptionSheet}\n                  sheetOpen={sheet?.post.id === p.id}");
    expect(screen).toContain("{paging && <PostSheet post={sheetPost}");
    expect(screen).toContain("<CommentsSheet post={commentsFor}");
  });
});
