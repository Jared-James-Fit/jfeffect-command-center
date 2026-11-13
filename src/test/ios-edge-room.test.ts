import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { IOS_EDGE_ROOM, IOS_WEB_APP_BOOT_SCRIPT } from "@/lib/ios-edge";

const read = (f: string) => readFileSync(f, "utf8");

describe("on the iPhone home-screen app every top bar starts below iOS's own blur", () => {
  const css = read("src/styles.css");

  it("marks the home-screen app before the first paint", () => {
    expect(IOS_WEB_APP_BOOT_SCRIPT).toContain("window.navigator.standalone===true");
    expect(IOS_WEB_APP_BOOT_SCRIPT).toContain('setAttribute("data-ios-web-app","")');
    const root = read("src/routes/__root.tsx");
    // right after the theme script, in <head>
    expect(root.indexOf("__html: IOS_WEB_APP_BOOT_SCRIPT")).toBeGreaterThan(root.indexOf("__html: THEME_BOOT_SCRIPT"));
    expect(root.indexOf("__html: IOS_WEB_APP_BOOT_SCRIPT")).toBeLessThan(root.indexOf("<HeadContent />"));
  });

  it("adds the room to the one notch variable the bars, spacers and chats use, and to Focus", () => {
    expect(IOS_EDGE_ROOM).toBe("28px");
    const rule = css.slice(css.indexOf("html[data-ios-web-app] {"), css.indexOf("}", css.indexOf("html[data-ios-web-app] {")));
    // only where the page still draws under the clock (an app added before the solid status bar)
    expect(rule).toContain(`--ios-edge-room: min(${IOS_EDGE_ROOM}, calc(env(safe-area-inset-top, 0px) * 100));`);
    expect(rule).toContain("--app-safe-top: calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room));");
    expect(rule).toContain("--focus-top: calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room));");
    // everywhere else nothing moves
    expect(css).toContain(":root { --ios-edge-room: 0px; --app-edge-room: 0px; }");
    expect(css).toContain(":root { --app-safe-top: env(safe-area-inset-top, 0px); --app-chrome-top: 0px; }");
  });

  it("View as client still wins: the banner holds the notch, so the bars get no padding of their own", () => {
    expect(css.indexOf("html[data-pov-banner-on] { --app-safe-top: 0px;")).toBeGreaterThan(css.indexOf("html[data-ios-web-app] {"));
  });

  it("toasts drop below the lowered bar", () => {
    expect(read("src/routes/__root.tsx")).toContain("calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room, 0px) + 72px)");
  });
});

describe("the home-screen app's status bar is solid: the app starts right under the clock (iOS 26.1+)", () => {
  const css = read("src/styles.css");
  const root = read("src/routes/__root.tsx");
  it("asks iOS for the solid status bar, so nothing sits under it for iOS to blur and the bars need no room for it", () => {
    expect(root).toContain('{ name: "apple-mobile-web-app-status-bar-style", content: "default" },');
    expect(root).not.toContain('"black-translucent"');
    // with the page below the status bar the inset is 0, and so is the room (min(28px, 0 * 100))
    expect(css).toContain("--ios-edge-room: min(28px, calc(env(safe-area-inset-top, 0px) * 100));");
  });

  it("the status bar is the page's own colour in each theme, black over Crew's feed", async () => {
    const { THEME_COLOR } = await import("@/lib/theme");
    // oklch(0.975 0.002 280) and oklch(0.16 0.005 280), the two --background tokens
    expect(THEME_COLOR).toEqual({ light: "#f6f7f8", dark: "#0d0d0f" });
    expect(css).toContain("  --background: oklch(0.975 0.002 280);");
    expect(css).toContain("  --background: oklch(0.16 0.005 280);");
    const lib = read("src/lib/feed-paging.ts");
    expect(lib).toContain('const FEED_THEME_COLOR = "#000000";');
    expect(lib).toContain("paintThemeColor(next);");
  });

  it("the shell fills the window's measured height (iOS's 100vh counts the status bar there)", () => {
    expect(IOS_WEB_APP_BOOT_SCRIPT).toContain('r.style.setProperty("--app-vh",window.innerHeight+"px")');
    expect(css).toContain("html[data-ios-web-app] [data-shell-root] { min-height: var(--app-vh, 100vh); }");
  });
});

describe("the status bar's colour is right from the first frame", () => {
  it("a script after the head's tags paints theme-color for the theme already applied", async () => {
    const { THEME_COLOR_SCRIPT } = await import("@/lib/theme");
    const root = read("src/routes/__root.tsx");
    expect(root.indexOf("__html: THEME_COLOR_SCRIPT")).toBeGreaterThan(root.indexOf("<HeadContent />"));
    expect(root).toContain('{ name: "theme-color", content: "#f6f7f8" },');
    expect(THEME_COLOR_SCRIPT).toContain('classList.contains("dark")?"#0d0d0f":"#f6f7f8"');
  });
});
