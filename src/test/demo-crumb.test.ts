import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRUMB_FRESH_MS, demoCrumbMessage, judgeDemoCrumb, type DemoCrumb } from "@/lib/demo-crumb";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = 1_800_000_000_000;
const crumb = (over: Partial<DemoCrumb> = {}): DemoCrumb => ({ at: NOW - 5_000, path: "/portal/workouts/day-1", url: "https://vimeo.com/1", exit: null, ...over });

describe("a reload while a demo video was playing is reported, not guessed", () => {
  it("no clean exit: iOS ended the page", () => {
    const c = judgeDemoCrumb(crumb(), NOW);
    expect(c).not.toBeNull();
    expect(demoCrumbMessage(c!)).toBe("Demo video: the app reloaded while a demo was playing (iOS ended the page)");
  });

  it("the app's own reload says which one", () => {
    const c = judgeDemoCrumb(crumb({ exit: "reload: chunk recovery (vite:preloadError)" }), NOW)!;
    expect(demoCrumbMessage(c)).toBe("Demo video: the app reloaded itself while a demo was playing (chunk recovery (vite:preloadError))");
    expect(demoCrumbMessage(judgeDemoCrumb(crumb({ exit: "pagehide" }), NOW)!)).toContain("(no reason given)");
  });

  it("going to the background, an old note or nothing at all isn't a reload", () => {
    expect(judgeDemoCrumb(crumb({ exit: "background" }), NOW)).toBeNull();
    expect(judgeDemoCrumb(crumb({ at: NOW - CRUMB_FRESH_MS - 1 }), NOW)).toBeNull();
    expect(judgeDemoCrumb(null, NOW)).toBeNull();
  });

  it("every reload the app does itself names its reason first", () => {
    expect(read("src/lib/chunk-recovery.ts")).toContain("noteReloadReason(`chunk recovery (${reason})`);\n  window.location.reload();");
    expect(read("src/lib/lazy-chunk.tsx")).toContain('noteReloadReason("Update app");\n  window.location.reload();');
    expect(read("src/hooks/use-app-freshness.ts")).toContain('noteReloadReason("new build on reopen");\n          window.location.reload();');
    expect(read("src/lib/pwa/register-sw.ts")).toContain('noteReloadReason("update prompt");');
    expect(read("src/components/router-error-fallback.tsx")).toContain("noteReloadReason(`page error: ");
    // reported on the next launch, once
    expect(read("src/components/app-shell.tsx")).toContain("const c = takeDemoCrumb();");
  });
});
