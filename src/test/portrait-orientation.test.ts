import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  NARROW_QUERY,
  PHONE_ATTR,
  PHONE_BOOT_SCRIPT,
  PHONE_LAYOUT_EVENT,
  PHONE_SHORT_SIDE_MAX,
  isPhone,
  lockPortrait,
  phoneLayoutNow,
  syncPhoneAttr,
  unlockPortrait,
} from "@/lib/portrait-only";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !p.includes(`${path.sep}test${path.sep}`)) out.push(p);
  }
  return out;
}

/** A tiny <html> + window for the boot script and the helpers. */
function fakeDom({ screenW, screenH, coarse, width }: { screenW: number; screenH: number; coarse: boolean; width: number }) {
  const attrs = new Map<string, string>();
  const events: string[] = [];
  const root = {
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
  };
  const matchMedia = (q: string) => ({
    matches: q === "(pointer: coarse)" ? coarse : q === NARROW_QUERY ? width < 768 : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("screen", { width: screenW, height: screenH, orientation: { type: screenW > screenH ? "landscape-primary" : "portrait-primary" } });
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", { matchMedia, dispatchEvent: (e: Event) => events.push(e.type), addEventListener: () => {}, removeEventListener: () => {} });
  return { attrs, events };
}

describe("phones stay portrait without ever interrupting (Instagram's)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never covers the app: the sideways screen is gone, the lock draws nothing", () => {
    const comp = read("src/components/portrait-only.tsx");
    expect(comp).toContain("export function PortraitLock()");
    expect(comp).toContain("return null;");
    for (const gone of ["Turn your phone upright", "data-portrait-only", "role=\"alert\"", "<PortraitOnly"]) {
      expect(comp).not.toContain(gone);
    }
    const root = read("src/routes/__root.tsx");
    expect(root).toContain("<PortraitLock />");
    expect(root).not.toContain("<PortraitOnly");
    // nowhere in the app
    const hits = walk(path.join(process.cwd(), "src")).filter((f) => readFileSync(f, "utf8").includes("Turn your phone upright"));
    expect(hits).toEqual([]);
  });

  it("locks wherever the platform allows it: the iPhone app, the Android app, Android's installed web app", () => {
    // iPhone app: Info.plist, portrait only (iPads keep every orientation)
    expect(read(".github/workflows/ios-build.yml")).toContain('pl["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]');
    // Android app: the WebView can't lock itself, so MainActivity holds it (every build, cap add regenerates it)
    const android = read(".github/workflows/android-build.yml");
    expect(android).toContain("- name: Keep the Android app upright");
    expect(android).toContain('android:screenOrientation="portrait"');
    expect(android.indexOf("Keep the Android app upright")).toBeLessThan(android.indexOf("- name: Run cap sync"));
    // Android's installed web app: the manifest, plus screen.orientation.lock on launch and on coming back
    expect(JSON.parse(read("public/manifest.json")).orientation).toBe("portrait-primary");
    const comp = read("src/components/portrait-only.tsx");
    expect(comp).toContain("else void lockPortrait();");
    expect(comp).toContain('document.addEventListener("visibilitychange", back);');
  });

  it("asks for the lock only on a phone, never throws, and lets it go for the app's camera", async () => {
    const phone = { screenW: 393, screenH: 852, coarse: true };
    const lock = vi.fn(async () => undefined);
    const unlock = vi.fn();
    vi.stubGlobal("screen", { orientation: { type: "portrait-primary", lock, unlock } });
    expect(await lockPortrait(phone)).toBe(true);
    expect(lock).toHaveBeenCalledWith("portrait-primary");
    expect(await lockPortrait({ screenW: 820, screenH: 1180, coarse: true })).toBe(false); // an iPad turns freely
    unlockPortrait();
    expect(unlock).toHaveBeenCalled();
    // iPhone Safari / home-screen app and an Android browser tab refuse: nothing breaks
    vi.stubGlobal("screen", { orientation: { type: "portrait-primary", lock: () => Promise.reject(new DOMException("no", "NotSupportedError")) } });
    expect(await lockPortrait(phone)).toBe(false);
    vi.stubGlobal("screen", {});
    expect(await lockPortrait(phone)).toBe(false);
    expect(() => unlockPortrait()).not.toThrow();
  });

  it("marks a phone before the first paint, from the screen (never the window), upright or on its side", () => {
    expect(read("src/routes/__root.tsx")).toContain("<script dangerouslySetInnerHTML={{ __html: PHONE_BOOT_SCRIPT }} />");
    const boot = (d: Parameters<typeof fakeDom>[0]) => {
      const { attrs } = fakeDom(d);
      new Function(PHONE_BOOT_SCRIPT)();
      return attrs.has(PHONE_ATTR);
    };
    expect(boot({ screenW: 393, screenH: 852, coarse: true, width: 393 })).toBe(true); // iPhone upright
    expect(boot({ screenW: 393, screenH: 852, coarse: true, width: 852 })).toBe(true); // iPhone on its side (iOS keeps the upright size)
    expect(boot({ screenW: 915, screenH: 412, coarse: true, width: 915 })).toBe(true); // Android on its side (sizes swap)
    expect(boot({ screenW: 820, screenH: 1180, coarse: true, width: 1180 })).toBe(false); // iPad
    expect(boot({ screenW: 1440, screenH: 900, coarse: false, width: 1280 })).toBe(false); // computer
    expect(boot({ screenW: 390, screenH: 844, coarse: false, width: 390 })).toBe(false); // a narrow desktop window
    expect(PHONE_BOOT_SCRIPT).toContain(`m<${PHONE_SHORT_SIDE_MAX}`);
    expect(PHONE_BOOT_SCRIPT).not.toContain("innerWidth");
    // the same rule as isPhone
    expect(isPhone({ screenW: 915, screenH: 412, coarse: true })).toBe(true);
    expect(isPhone({ screenW: 820, screenH: 1180, coarse: true })).toBe(false);
  });

  it("keeps data-phone true to the device (a foldable opened or closed) and says so once", () => {
    const { attrs, events } = fakeDom({ screenW: 393, screenH: 852, coarse: true, width: 393 });
    expect(syncPhoneAttr({ screenW: 393, screenH: 852, coarse: true })).toBe(true);
    expect(attrs.has(PHONE_ATTR)).toBe(true);
    expect(syncPhoneAttr({ screenW: 852, screenH: 393, coarse: true, type: "landscape-primary" })).toBe(false); // a turn changes nothing
    expect(syncPhoneAttr({ screenW: 884, screenH: 1104, coarse: true })).toBe(true); // unfolded: a tablet
    expect(attrs.has(PHONE_ATTR)).toBe(false);
    expect(events).toEqual([PHONE_LAYOUT_EVENT, PHONE_LAYOUT_EVENT]);
  });

  it("JS chooses the phone layout the way the CSS does: a phone in any orientation, or narrower than md", () => {
    fakeDom({ screenW: 393, screenH: 852, coarse: true, width: 852 });
    expect(phoneLayoutNow()).toBe(false); // no attribute yet
    syncPhoneAttr({ screenW: 393, screenH: 852, coarse: true });
    expect(phoneLayoutNow()).toBe(true); // a phone on its side, 852 wide
    vi.unstubAllGlobals();
    fakeDom({ screenW: 1440, screenH: 900, coarse: false, width: 700 });
    expect(phoneLayoutNow()).toBe(true); // a narrow window
    vi.unstubAllGlobals();
    fakeDom({ screenW: 1440, screenH: 900, coarse: false, width: 1280 });
    expect(phoneLayoutNow()).toBe(false);
    const hooks = read("src/hooks/use-mobile.tsx");
    expect(hooks).toContain("setIsMobile(phoneLayoutNow())");
    expect(hooks).toContain("return onPhoneLayoutChange(onChange);");
    // nothing else chooses by width alone (a phone on its side would get the desktop branch and remount)
    const raw = walk(path.join(process.cwd(), "src"))
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(`lib${path.sep}portrait-only.ts`))
      .filter((f) => /matchMedia\("\((?:min|max)-width: 76[78]px\)"\)|innerWidth\s*(?:<|>=)\s*768/.test(readFileSync(f, "utf8")));
    expect(raw).toEqual([]);
  });

  it("CSS: md never switches a phone to the tablet / desktop layout, and the phone-only rules hold on its side", () => {
    const css = read("src/styles.css");
    expect(css).toContain("@custom-variant md {\n  @media (width >= 48rem) {\n    &:where(:root:not([data-phone]), :root:not([data-phone]) *) {");
    expect(css).toContain("@custom-variant max-md {\n  @media (width < 48rem) {\n    @slot;\n  }\n  &:where(:root[data-phone], :root[data-phone] *) {");
    // no raw 768px media query left that a phone on its side would fall through
    expect(css).not.toMatch(/@media \((?:max|min)-width: 76[78](?:\.98)?px\)/);
    expect(css).toContain(":root { @variant max-md { --shell-topbar-h: 49px; } }");
    expect(css).toContain(":root { @variant max-md { --bottom-nav-clearance: var(--mobile-bar-top); } }");
    expect(css).toContain("input, textarea, select {\n  @variant max-md { font-size: 16px; }\n}");
  });

  it("on its side a phone is one centered column, the tab bar's 560px row (an upright phone is narrower, so nothing changes)", () => {
    const css = read("src/styles.css");
    expect(css).toContain(":root[data-phone] .phone-column { max-width: 560px; margin-inline: auto; }");
    expect(css).toContain(":root[data-phone] .shell-bar { padding-inline: max(0.5rem, calc((100% - 560px) / 2)); }");
    expect(read("src/components/app-shell.tsx")).toContain('<main className="phone-column w-full');
    expect(read("src/components/app-shell.tsx")).toContain('<div className={cn("mx-auto grid h-[var(--mobile-bar-h)] max-w-[560px]"');
    expect(read("src/components/ui/sheet.tsx")).toContain('"phone-column inset-x-0 bottom-0 border-t');
    expect(read("src/components/ui/drawer.tsx")).toContain('"phone-column fixed inset-x-0 bottom-0 z-50');
    for (const chat of ["src/routes/_authenticated/portal/messages.tsx", "src/route-pages/_authenticated/admin/messages.tsx", "src/routes/_authenticated/portal/support.tsx", "src/routes/_authenticated/admin/communication.tsx"]) {
      expect(read(chat)).toContain("phone-column fixed inset-x-0 z-30");
    }
  });

  it("turning the phone is never read as a keyboard (one baseline per width)", () => {
    const kb = read("src/hooks/use-keyboard-open.ts");
    expect(kb).toContain("const baselines = new Map<number, number>();");
    expect(kb).toContain("const baseline = Math.max(baselines.get(w) ?? vv.height, vv.height);");
    expect(kb).not.toContain("let baseline = vv.height;");
  });
});
