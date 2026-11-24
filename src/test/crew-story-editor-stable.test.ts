import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The story editor, Nov 23 2026: switching filters (Lock in, Today, Train,
 * Block, Fuel…) never resizes, moves or blanks the picture, never pops a
 * message, and never takes back what was done to it. Checked in Chromium on
 * the real camera (60 filters, twice, on a tall and a short screen): one frame
 * size throughout, no blank frame, no toast; before, the frame took 35 sizes
 * and "Picked up where you left off" stacked five deep.
 */
describe("switching story filters keeps the picture still", () => {
  const studio = read("src/components/community/share-studio.tsx");

  it("the chip's room under the picture stays while it's empty, so a chip coming and going never resizes it", () => {
    expect(studio).toContain("else if (chip || chipRoom) chipLatch.current = true;");
    expect(studio).toContain('const keepChipRoom = chipLatch.current && !(phase === "shoot" && fullScreen);');
    expect(studio).toContain('keepChipRoom && "h-12 items-center"');
    // the story camera says when a filter in its row has a chip (a lock in's, a workout's)
    expect(read("src/components/community/share-workout-picker.tsx")).toContain(
      'chipRoom={row.items.some((i) => i.key.startsWith("lockin:") || i.key.startsWith("workout:"))}',
    );
    // on a short screen the "hold for video" line keeps its room too (a filter turns filming off)
    expect(studio).toContain("const holdHintRoom = !fullScreen && canRecordClipsHere && status === \"live\" && holdUnseen;");
    // and the filter groups' chips stay put (out of sight) while filming
    expect(read("src/components/community/look-carousel.tsx")).toContain("<GroupChips chips={chips} on={onGroup} hidden={filming}");
  });

  it("nothing is mounted fresh on a switch: the card's canvas, the photo and the whole-picture preview stay on the page", () => {
    // the canvas is always there; it shows once this filter is painted on it, the photo or camera until then
    expect(studio).toContain('className={cn("pointer-events-none absolute", (!cardVisible || selItem) && "invisible")}');
    expect(studio).toContain("const cardVisible = showCard && cardPainted;");
    expect(studio).not.toContain("{showCard && (\n                <canvas");
    // the photo stays loaded and graded under a filter (no decode, no new WebGL context on Normal)
    expect(studio).toContain("showImage={!cardVisible}\n                  keepImage");
    expect(read("src/components/community/photo-framer.tsx")).toContain("const kept = showImage || (keepImage && !video);");
    expect(studio).toContain("hidden={cardVisible} />");
    // a camera frame is encoded once, in the background, never on the switch to Normal
    expect(studio).toContain("void shotBlob(shot).then((b) => {");
    // a new filter is painted before the screen shows the switch, over the framed photo kept from the last one
    expect(studio).toContain("if (!quick) return void paint();");
    expect(studio).toContain("const key = [s, framing, frameAspect, shotGrade, shotWhole, story];");
  });

  it("no popups over the editor, and a draft comes back quietly, only when the studio opens", () => {
    expect(studio).not.toContain("Picked up where you left off");
    expect(studio).not.toContain("Your caption is back");
    expect(studio).not.toContain("Two fingers to move or zoom the photo");
    expect(studio).not.toContain("data-pinch-hint");
    expect(read("src/components/community/post-composer.tsx")).not.toContain("Your caption is back");
    // once per open, under the post it opened on (the story camera hands over another post with each filter group)
    expect(studio).toContain("if (!open || !post || reply || share || draftKey.current) return;");
    expect(studio).toContain("Date.now() - d.savedAt > DRAFT_RESTORE_MS");
    // never over a photo already being made; Discard throws it away
    expect(studio).toContain("if (startedRef.current || draftKey.current !== key) return void URL.revokeObjectURL(url);");
    expect(studio).toContain("dropDraft();\n        leave();");
  });

  it("a filter never takes back a choice: the words, who sees it and hide weights stay theirs", () => {
    expect(studio).toContain("if (!open || !post || postingRef.current || ownChoices.current) return;");
    expect(studio.match(/ownChoices\.current = true;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
