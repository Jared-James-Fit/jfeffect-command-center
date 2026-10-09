import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { THEMED_PATH_RE, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

describe("dark mode", () => {
  it("only themes the signed-in app; public pages stay light", () => {
    for (const p of ["/portal", "/portal/progress", "/admin/clients", "/m", "/coach/x", "/notifications", "/finance", "/finance/revenue"]) expect(THEMED_PATH_RE.test(p)).toBe(true);
    for (const p of ["/", "/membership", "/auth", "/selkirk", "/media-kit", "/my", "/financial-literacy"]) expect(THEMED_PATH_RE.test(p)).toBe(false);
  });

  it("boot script reads the same key and path rule as the runtime", () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOT_SCRIPT).toContain(THEMED_PATH_RE.toString());
  });

  it("ships the generated dark palette and never overrides an explicit dark: class", () => {
    const css = readFileSync("src/styles/dark-palette.css", "utf8");
    expect(readFileSync("src/styles.css", "utf8")).toContain('@import "./styles/dark-palette.css"');
    expect(css).toMatch(/\.dark \.bg-amber-50:not\(\[class\*="dark:bg-"\]\)/);
    expect(css).toMatch(/\.dark \.text-emerald-700:not\(\[class\*="dark:text-"\]\)/);
  });

  it("portal header swaps the search button for the appearance toggle", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell).toContain("<ThemeToggle");
    expect(shell).not.toContain('<span className="hidden min-[380px]:inline">Workouts</span>');
  });
});
