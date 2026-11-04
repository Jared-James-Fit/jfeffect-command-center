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
    expect(rule).toContain(`--ios-edge-room: ${IOS_EDGE_ROOM};`);
    expect(rule).toContain("--app-safe-top: calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room));");
    expect(rule).toContain("--focus-top: calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room));");
    // everywhere else nothing moves
    expect(css).toContain(":root { --ios-edge-room: 0px; }");
    expect(css).toContain(":root { --app-safe-top: env(safe-area-inset-top, 0px); --app-chrome-top: 0px; }");
  });

  it("View as client still wins: the banner holds the notch, so the bars get no padding of their own", () => {
    expect(css.indexOf("html[data-pov-banner-on] { --app-safe-top: 0px;")).toBeGreaterThan(css.indexOf("html[data-ios-web-app] {"));
  });

  it("toasts drop below the lowered bar", () => {
    expect(read("src/routes/__root.tsx")).toContain("calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room, 0px) + 72px)");
  });
});
