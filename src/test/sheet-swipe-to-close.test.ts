import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEET_DRAG_START_PX, sheetDragCloses, sheetDragIntent } from "@/lib/post-sheet";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 17 2026: the coach opened his post's Activity (👁 views, ❤️ likes) over
 * the feed and couldn't swipe it down to close it: it had a grip, but only
 * the post's comments sheet knew the gesture. One rule now
 * (useSwipeDownToClose), and every Crew sheet that draws a grip turns it on.
 */
describe("a bottom sheet with a grip closes with one swipe down", () => {
  it("a finger is a drag of the sheet only once it's clearly moving down", () => {
    expect(sheetDragIntent(0, SHEET_DRAG_START_PX - 1)).toBe("wait");
    expect(sheetDragIntent(2, 12)).toBe("drag");
    expect(sheetDragIntent(10, 10)).toBe("drag");
    // up: the sheet's list scrolls
    expect(sheetDragIntent(0, -12)).toBe("pass");
    // sideways: a row of tabs or a carousel inside it
    expect(sheetDragIntent(20, 8)).toBe("pass");
    expect(sheetDragIntent(-20, 8)).toBe("pass");
    // and letting go far enough down, or with a flick, closes it
    expect(sheetDragCloses({ dy: 200, ms: 900, height: 600 })).toBe(true);
    expect(sheetDragCloses({ dy: 60, ms: 600, height: 600 })).toBe(false);
  });

  it("the shared sheet holds the gesture: bottom sheets that ask for it, closed through Radix like ✕", () => {
    const sheet = read("src/components/ui/sheet.tsx");
    expect(sheet).toContain('const swipes = !!swipeToClose && side === "bottom";');
    expect(sheet).toContain(
      "useSwipeDownToClose(swipes ? node : null, swipes, () => dragClose.current?.click());",
    );
    expect(sheet).toContain(
      "{swipes && <SheetPrimitive.Close ref={dragClose} hidden tabIndex={-1} aria-hidden />}",
    );
    const hook = read("src/hooks/use-swipe-down-to-close.ts");
    // a list scrolled down scrolls back up first; the transform stays so a closed sheet slides out from the finger
    expect(hook).toContain("if (n.scrollTop > 0) return true;");
    expect(hook).toContain(
      "// the transform stays: a sheet closed by a swipe slides out from where the finger left it",
    );
    // the rest of the touch is followed on the element it started on (a row that loads away mid-swipe never freezes it)
    expect(hook).toContain("follow(e.target);");
    expect(hook).toContain('target?.addEventListener("touchend", onEnd as EventListener);');
  });

  it("the post's Activity (views, likes) swipes down to close", () => {
    expect(read("src/components/community/post-activity.tsx")).toContain(
      '<SheetContent side="bottom" swipeToClose hideCloseButton className="flex max-h-[80dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]" data-post-activity>',
    );
  });

  it("every Crew sheet that draws a grip can be swiped down", () => {
    const dir = "src/components/community";
    const grip =
      /mx-auto[^"]*\bh-1(?:\.5)?\b[^"]*\bw-(?:9|10|12)\b[^"]*rounded-full|\bh-1(?:\.5)?\b[^"]*\bw-(?:9|10|12)\b[^"]*rounded-full[^"]*mx-auto/;
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = read(`${dir}/${f}`);
      let at = src.indexOf("<SheetContent");
      while (at !== -1) {
        const tagEnd = src.indexOf(">", src.indexOf("side=", at));
        const tag = src.slice(at, tagEnd);
        const after = src.slice(tagEnd, tagEnd + 600);
        if (tag.includes('side="bottom"') && grip.test(after) && !tag.includes("swipeToClose"))
          missing.push(`${f}:${src.slice(0, at).split("\n").length}`);
        at = src.indexOf("<SheetContent", at + 1);
      }
    }
    expect(missing).toEqual([]);
  });
});
