import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");

function pointerDownHandler() {
  const start = thread.indexOf("onPointerDown={(e) => {");
  return thread.slice(start, thread.indexOf("onPointerMove={onPointerMoveDuringHold}", start));
}

describe("holding a message", () => {
  it("works the same on every part of a message, photos and videos included", () => {
    const h = pointerDownHandler();
    // Before: buttons (every photo/video tile, links, the reply quote) were skipped,
    // so the same hold did nothing, played the video, or opened the menu depending on where it landed.
    expect(h).not.toContain('closest("a,button,textarea,input,audio,video")');
    expect(h).toContain('closest("textarea,input,select,audio,video[controls],[data-clip-reply]")');
    expect(h).toContain("e.currentTarget as HTMLElement");
  });

  it("never lets the release of a hold tap what's underneath", () => {
    expect(thread).toContain("suppressClickRef.current = true;");
    expect(thread).toMatch(/onClickCapture=\{\(e\) => \{\s*if \(suppressClickRef\.current && !fromPortal\(e\)\)/);
    // ...and a hold whose release made no click can't swallow the next real tap.
    expect(thread).toContain("if (!fromPortal(e)) suppressClickRef.current = false;");
  });

  it("shows the hold registered without re-rendering the thread", () => {
    expect(thread).toContain('el.style.transform = "scale(0.96)";');
    expect(thread).toContain("releasePress(lp.el);");
    expect(thread).toContain("if (longPressRef.current?.fired) { swipeRef.current = null; return; }");
  });

  it("opens a clean sheet: what was held at the top, no duplicate Back, no keyboard bounce", () => {
    const sheet = thread.slice(thread.indexOf("{/* Mobile/tablet long-press action sheet. */}"));
    expect(sheet).toContain("hideCloseButton");
    expect(sheet).toContain("onCloseAutoFocus={(e) => e.preventDefault()}");
    expect(sheet).toContain('<SheetTitle className="sr-only">Message actions</SheetTitle>');
    expect(sheet).toContain("{who} · {fmtTime(m.created_at)}");
    expect(sheet).toContain("`Video · ${fmtDuration(shown.att.duration)}`");
    expect(sheet).not.toContain('(m.attachments?.length ? "Attachment" : "")');
  });
});
