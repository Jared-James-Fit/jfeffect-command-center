/**
 * The top of every screen on an iPhone / iPad: iOS 26 blurs web content under
 * the status bar unless a fixed, full-width, opaque element is at the top edge
 * from the first frame; the chats start under the whole top bar (notch
 * included); the native app turns UIKit's scroll edge effect off.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("iOS 26 status-bar strip", () => {
  it("is the first thing in the server-rendered body, so it's there from the first frame", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toMatch(/<body>\s*\{\/\*[\s\S]*?\*\/\}\s*<div className="ios-status-band" aria-hidden="true" \/>\s*\{children\}/);
  });

  it("is fixed, full width, deeper than 10px, opaque, read but never painted, and topmost", () => {
    const css = read("src/styles.css");
    const rule = css.slice(css.indexOf(".ios-status-band {"), css.indexOf("}", css.indexOf(".ios-status-band {")));
    for (const decl of [
      "position: fixed;", "top: 0;", "left: 0;", "right: 0;",
      "height: max(12px, env(safe-area-inset-top, 0px));",
      "background-color: var(--background);", "background-clip: text;",
      "z-index: 2147483647;", "pointer-events: none;",
    ]) expect(rule).toContain(decl);
  });

  it("the Crew bar is opaque with no backdrop blur (Safari reads a blur as several colours)", () => {
    const bar = read("src/components/community/crew-header.tsx");
    expect(bar).toContain('className={cn("crew-bar fixed inset-x-0 top-[var(--app-chrome-top)] z-40 bg-background md:relative md:inset-auto", overlay && "dark text-foreground")}');
    expect(bar).not.toContain("backdrop-blur-xl");
  });

  it("over the paged feed the bar is see-through (the posts run up under it), its notch solid black and the status bar black too", () => {
    const css = read("src/styles.css");
    expect(css).toContain(".crew-bar[data-overlay] { background-color: transparent; }");
    expect(css).toContain("      #000 calc(var(--app-safe-top) - var(--app-edge-room)),\n      rgb(0 0 0 / 0.5) calc(var(--app-safe-top) - var(--app-edge-room)),");
    // iOS reads the strip's colour for the status bar: black over the feed, never the light theme's white
    expect(css).toContain("html.feed-paging:not([data-pov-banner-on]) .ios-status-band { background-color: #000; }");
    expect(css).not.toMatch(/\.crew-bar\[data-overlay\][^}]*backdrop-filter/);
  });
});

describe("full-height screens start under the whole top bar", () => {
  it("--app-top-chrome is the banner, the notch and the bar's row", () => {
    expect(read("src/styles.css")).toContain(
      ":root { --app-top-chrome: calc(var(--app-chrome-top) + var(--app-safe-top) + var(--shell-topbar-h)); }",
    );
  });

  it("the coach inbox, the coach thread and the client chat all use it", () => {
    for (const p of [
      "src/routes/_authenticated/admin/communication.tsx",
      "src/route-pages/_authenticated/admin/messages.tsx",
      "src/routes/_authenticated/portal/messages.tsx",
    ]) {
      const s = read(p);
      expect(s, p).toContain("var(--vv-top, 0px) + var(--app-top-chrome, 0px)");
      expect(s, p).toContain("calc(var(--vv-h, 100dvh) - var(--app-top-chrome, 0px) - var(--bottom-nav-clearance, 0px))");
      expect(s, p).not.toContain("var(--vv-top, 0px) + var(--shell-topbar-h, 0px)");
    }
  });

  it("on an iPad the sidebar and the page start under the status bar", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("md:flex md:pt-[env(safe-area-inset-top)] transition-[width]");
    expect(shell).toContain('<div className="flex min-w-0 flex-1 flex-col md:pt-[env(safe-area-inset-top)]">');
  });
});

describe("the native iPhone app", () => {
  it("turns iOS 26's scroll edge effect off on its web view, only with Xcode 26 and iOS 26+", () => {
    const ci = read(".github/workflows/ios-build.yml");
    expect(ci).toContain("#if compiler(>=6.2)");
    expect(ci).toContain("if #available(iOS 26.0, *), let scrollView = (window?.rootViewController as? CAPBridgeViewController)?.webView?.scrollView {");
    expect(ci).toContain("scrollView.topEdgeEffect.isHidden = true");
    expect(ci).toContain("scrollView.bottomEdgeEffect.isHidden = true");
  });
});

describe("Crew's feed uses the band under the clock (TikTok's)", () => {
  const css = read("src/styles.css");
  it("a post starts right under the status bar; the band the bars leave for iOS's blur shows the post, Crew's icons stay below it", () => {
    // the edge room in effect: the home-screen app's 28px, none in View as client (the banner holds the notch) or elsewhere
    expect(css).toContain(":root { --ios-edge-room: 0px; --app-edge-room: 0px; }");
    expect(css).toContain("  --app-edge-room: var(--ios-edge-room);");
    expect(css).toContain("html[data-pov-banner-on] { --app-safe-top: 0px; --app-chrome-top: var(--pov-banner-h, 0px); --app-edge-room: 0px; }");
    expect(css).toContain("  --feed-page-top: calc(var(--app-chrome-top) + var(--app-safe-top) - var(--app-edge-room));");
    // what sits at a post's top moves down past the band and the bar's row
    expect(css).toContain("  --feed-bar-room: calc(3rem + var(--app-edge-room));");
  });
});

describe("phones stay upright (TikTok's, Instagram's)", () => {
  it("the installed iPhone app is portrait only (iPads keep every orientation)", () => {
    const wf = read(".github/workflows/ios-build.yml");
    expect(wf).toContain('pl["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]');
    expect(wf).not.toContain('pl["UISupportedInterfaceOrientations~ipad"]');
    expect(read("public/manifest.json")).toContain('"orientation": "portrait-primary"');
  });

  it("where the browser can't lock it, a phone on its side gets one screen asking to turn it back", async () => {
    const { phoneOnItsSide } = await import("@/lib/portrait-only");
    const phone = { screenW: 430, screenH: 932, coarse: true };
    expect(phoneOnItsSide({ ...phone, type: "landscape-primary" })).toBe(true);
    expect(phoneOnItsSide({ ...phone, type: "portrait-primary" })).toBe(false);
    // older iPhones: window.orientation
    expect(phoneOnItsSide({ ...phone, angle: 90 })).toBe(true);
    expect(phoneOnItsSide({ ...phone, angle: -90 })).toBe(true);
    expect(phoneOnItsSide({ ...phone, angle: 0 })).toBe(false);
    // tablets and computers turn freely; nothing known, nothing shown
    expect(phoneOnItsSide({ screenW: 744, screenH: 1133, coarse: true, type: "landscape-primary" })).toBe(false);
    expect(phoneOnItsSide({ screenW: 390, screenH: 844, coarse: false, type: "landscape-primary" })).toBe(false);
    expect(phoneOnItsSide({ ...phone })).toBe(false);
    // read from the device, never the viewport's shape (a keyboard makes an upright phone's viewport wide)
    const lib = read("src/lib/portrait-only.ts");
    expect(lib).not.toContain("innerWidth");
    expect(read("src/routes/__root.tsx")).toContain("<PortraitOnly />");
  });
});
