import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("dark-mode what's-new popup", () => {
  const src = readFileSync("src/components/whats-new/theme-announcement.tsx", "utf8");
  it("stores seen state server-side, never in localStorage", () => {
    expect(src).toContain('from("feature_announcement_views")');
    expect(src).not.toMatch(/localStorage/);
  });
  it("is closable by Got it, the X, tapping outside and Escape", () => {
    expect(src).toContain("Got it");
    expect(src).toContain('aria-label="Close"');
    expect(src).toMatch(/onOpenChange=\{\(o\) => \{ if \(!o\) onClose\(\); \}\}/);
  });
  it("is mounted once for every signed-in surface", () => {
    expect(readFileSync("src/routes/_authenticated/route.tsx", "utf8")).toContain("<ThemeAnnouncementGate />");
  });
});
