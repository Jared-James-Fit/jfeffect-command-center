import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOSTED_WIDTHS, hostedImageProps, hostedImageUrl, hostedSrcSet, isHostedImage } from "@/lib/hosted-image";
import { Reveal } from "@/components/sales/reveal";

const read = (p: string) => readFileSync(p, "utf8");
const PHOTO = "/__l5e/assets-v1/880af8e5-58d4-4447-b212-88fb88ea5702/transformation-1.png";

describe("hosted photos are asked for at the size they're drawn", () => {
  it("adds the host's width to an asset-host URL, and leaves anything else alone", () => {
    expect(isHostedImage(PHOTO)).toBe(true);
    expect(hostedImageUrl(PHOTO, 480)).toBe(`${PHOTO}?w=480`);
    expect(hostedImageUrl(`${PHOTO}?v=2`, 480)).toBe(`${PHOTO}?v=2&w=480`);
    expect(hostedImageUrl("/assets/app-focus-CQybu712.webp", 480)).toBe("/assets/app-focus-CQybu712.webp");
    expect(isHostedImage("https://jaredjamesfit.com/assets/client.png")).toBe(false);
    expect(isHostedImage(null)).toBe(false);
  });

  it("a srcset over the shared widths, with sizes and a fallback for old browsers", () => {
    expect(hostedSrcSet(PHOTO)).toBe(HOSTED_WIDTHS.map((w) => `${PHOTO}?w=${w} ${w}w`).join(", "));
    expect(hostedImageProps(PHOTO, { sizes: "58vw", fallback: 480 })).toEqual({
      src: `${PHOTO}?w=480`,
      srcSet: hostedSrcSet(PHOTO),
      sizes: "58vw",
    });
    expect(hostedImageProps("/logo.png", { sizes: "28px" })).toEqual({ src: "/logo.png" });
  });

  it("every page that draws a hosted photo goes through it (never the 1–2 MB original)", () => {
    for (const f of [
      "src/components/landing/landing-page.tsx",
      "src/routes/coaching.index.tsx",
      "src/routes/about.tsx",
      "src/components/sales/transformations-strip.tsx",
      "src/components/sales/transformations-gallery.tsx",
      "src/components/sales/about-transformations.tsx",
      "src/components/sales/coach-timeline-section.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("hostedImageProps(");
      expect(src, f).not.toMatch(/src=\{(photo|p|coachTimeline|jaredAsset)\.url\}/);
    }
  });
});

describe("the landing page doesn't wait on its JavaScript to be read", () => {
  it("a Reveal section is sent visible: nothing is hidden until the page has loaded", () => {
    const html = renderToString(createElement(Reveal, null, createElement("p", null, "Log a set in seconds.")));
    expect(html).toContain("Log a set in seconds.");
    expect(html).not.toContain("opacity");
    expect(html).not.toContain("will-change");
  });

  it("the hero's second phone loads straight away, the first at high priority", () => {
    const landing = read("src/components/landing/landing-page.tsx");
    expect(landing).toContain("<PhoneShot src={shotHome} eager");
    expect(landing).toMatch(/<PhoneShot\s+src=\{shotFocus\}\s+priority/);
  });

  it("the phone menu's dialog is its own chunk, opened from a plain button", () => {
    const header = read("src/components/sales/public-header.tsx");
    expect(header).not.toContain("@radix-ui/react-dialog");
    expect(header).toContain('lazyWithRetry(() => import("@/components/sales/public-menu"))');
    expect(read("src/components/sales/public-menu.tsx")).toContain("returnFocusTo.current?.focus()");
  });
});

describe("tap-only code stays off the launch path", () => {
  it("the media viewer, Crew's tap-only views, the share sheets and the roadmap chart load on their own", () => {
    expect(read("src/components/media-viewer.tsx")).toContain('lazyWithRetry(() => import("@/components/media-viewer-surface"))');
    const crew = read("src/components/community/community-screen.tsx");
    for (const view of ["league-hub", "crew-activity", "reels-viewer", "post-detail"]) {
      expect(crew).toContain(`import("@/components/community/${view}")`);
    }
    expect(read("src/components/community/post-card.tsx")).toContain('from "@/components/community/lazy-sheets"');
    expect(read("src/components/nutrition-roadmap/roadmap-athlete.tsx")).not.toContain('import { RoadmapChart }');
  });

  it("the resumable upload client loads only for an upload that needs it", () => {
    const up = read("src/lib/lift-video-storage-upload.ts");
    expect(up).not.toMatch(/^import \* as tus/m);
    expect(up).toContain('await import("tus-js-client")');
  });

  it("the exercise aliases wait for an idle moment and never bring the search engine with the shell", () => {
    const hook = read("src/hooks/use-exercise-alias-index.ts");
    expect(hook).not.toMatch(/^import .*@\/lib\/exercise-search/m);
    expect(hook).toContain("enabled: ready");
  });
});
