import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockMediaSave, onProtectedMedia } from "@/lib/protect-media";

const read = (p: string) => readFileSync(p, "utf8");

/** A stand-in element: `closest` answers whether it sits in a photo. */
const el = (inPhoto: boolean) => ({ closest: () => (inPhoto ? {} : null) }) as unknown as Element;

describe("public pages' photos can't be saved from the page", () => {
  it("refuses the menu and the drag on a photo, never on text", () => {
    expect(onProtectedMedia(el(true))).toBe(true);
    expect(onProtectedMedia(el(false))).toBe(false);
    expect(onProtectedMedia(null)).toBe(false);

    let prevented = 0;
    const event = (inPhoto: boolean) =>
      ({ target: el(inPhoto), preventDefault: () => prevented++ }) as never;
    blockMediaSave(event(true));
    blockMediaSave(event(false));
    expect(prevented).toBe(1);
  });

  it("every public page's frame protects its photos, on iPhone too", () => {
    const shell = read("src/components/sales/sales-page-shell.tsx");
    expect(shell).toContain("data-protect-media");
    expect(shell).toContain("onContextMenu={blockMediaSave}");
    expect(shell).toContain("onDragStart={blockMediaSave}");
    const css = read("src/styles.css");
    const rule = css.slice(css.indexOf("[data-protect-media]"));
    expect(rule).toMatch(/^\[data-protect-media\][^{]*\{[^}]*-webkit-touch-callout: none;[^}]*-webkit-user-drag: none;/);
    expect(read("src/routes/about.tsx")).toContain("draggable={false}");
  });
});

describe("About's comparison photos show no caption bar", () => {
  /** The part of the square still on screen after zooming `s`× around a point `o` down it. */
  const shown = (s: number, o: number) => ({ top: o - o / s, bottom: o + (1 - o) / s });

  it("the two leveled-up comparisons zoom past their bottom bar, the top where it was", () => {
    const about = read("src/routes/about.tsx");
    expect(about).toContain('const CAPTION_BAR_CROP = "origin-[50%_32%] scale-[1.31]"');
    for (const img of ["leveled-up-12-Dvp868jE.png", "leveled-up-4-DWlPm4Gd.png"]) {
      const line = about.split("\n").find((l) => l.includes(img) && l.trim().startsWith("["));
      expect(line, img).toContain("CAPTION_BAR_CROP]");
    }
    // measured on the coach's phone (Nov 20 2026): the bar starts 86.9% down the square
    const BAR = 0.869;
    const before = shown(1.18, 0.5);
    const after = shown(1.31, 0.32);
    expect(before.bottom).toBeGreaterThan(BAR);
    expect(after.bottom).toBeLessThan(BAR - 0.025);
    // nothing above what showed before comes into view
    expect(after.top).toBeGreaterThan(before.top - 0.002);
  });
});
