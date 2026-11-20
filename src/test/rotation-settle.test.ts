import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  onRotationSettle,
  plausibleViewport,
  ROTATION_SETTLE_MS,
  tallestPerWidth,
} from "@/lib/rotation-settle";
import { IOS_WEB_APP_BOOT_SCRIPT } from "@/lib/ios-edge";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

// An iPhone 15 Pro in the home-screen app: 393 × 852 points; upright the window is 393 × 793
// under the solid status bar, on its side 852 × 393. Mid-turn WebKit gives the new width with
// the old height (WebKit 322083), which is what these tests feed in.
const SW = 393;
const SH = 852;

/** A window with events, enough for onRotationSettle and the boot script. */
function fakeWindow(init: { w: number; h: number; standalone?: boolean }) {
  const listeners = new Map<string, Set<(e?: unknown) => void>>();
  const docListeners = new Map<string, Set<(e?: unknown) => void>>();
  const styles = new Map<string, string>();
  const attrs = new Map<string, string>();
  const orientationListeners = new Set<() => void>();
  let active: { tagName: string; isContentEditable?: boolean } | null = null;
  const win = {
    innerWidth: init.w,
    innerHeight: init.h,
    navigator: { standalone: init.standalone ?? true },
    addEventListener: (t: string, f: () => void) =>
      (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: number) => clearTimeout(t),
  };
  const doc = {
    visibilityState: "visible",
    get activeElement() {
      return active;
    },
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
      style: {
        setProperty: (k: string, v: string) => styles.set(k, v),
        removeProperty: (k: string) => styles.delete(k),
        getPropertyValue: (k: string) => styles.get(k) ?? "",
      },
    },
    addEventListener: (t: string, f: () => void) =>
      (docListeners.get(t) ?? docListeners.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => docListeners.get(t)?.delete(f),
  };
  const scr = {
    width: SW,
    height: SH,
    orientation: {
      type: "portrait-primary",
      addEventListener: (_: string, f: () => void) => orientationListeners.add(f),
      removeEventListener: (_: string, f: () => void) => orientationListeners.delete(f),
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("screen", scr);
  const fire = (t: string) => listeners.get(t)?.forEach((f) => f());
  return {
    win,
    styles,
    attrs,
    /** The phone turns: the width changes at once, the height catches up `lagMs` later (WebKit). */
    turn(w: number, h: number, lagMs: number) {
      win.innerWidth = w;
      fire("resize");
      fire("orientationchange");
      orientationListeners.forEach((f) => f());
      setTimeout(() => {
        win.innerHeight = h;
        fire("resize");
      }, lagMs);
    },
    resize(h: number) {
      win.innerHeight = h;
      fire("resize");
    },
    focus(tag: string | null) {
      active = tag ? { tagName: tag } : null;
      docListeners.get(tag ? "focusin" : "focusout")?.forEach((f) => f());
    },
    listenerCount: () =>
      [...listeners.values()].reduce((n, s) => n + s.size, 0) +
      [...docListeners.values()].reduce((n, s) => n + s.size, 0) +
      orientationListeners.size,
  };
}

describe("a turn of the phone: sizes are read as it settles, never from a stale reading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a window bigger than the screen is a mid-turn reading (the new width with the old height)", () => {
    expect(plausibleViewport(852, 852, SW, SH)).toBe(false); // turned on its side, height not caught up
    expect(plausibleViewport(852, 793, SW, SH)).toBe(false);
    expect(plausibleViewport(852, 393, SW, SH)).toBe(true); // on its side
    expect(plausibleViewport(393, 793, SW, SH)).toBe(true); // upright
    expect(plausibleViewport(393, 393, SW, SH)).toBe(true); // stale the other way: fits, so it's read again later
    expect(plausibleViewport(852, 393, SH, SW)).toBe(true); // Android swaps screen.width/height: same area
    expect(plausibleViewport(1280, 800, 0, 0)).toBe(true); // nothing to check against
    expect(plausibleViewport(0, 793, SW, SH)).toBe(false);
  });

  it("the keyboard's no-keyboard height: one per width, never from a stale reading (the tab bar that vanished)", () => {
    const t = tallestPerWidth();
    expect(t.see(393, 793, SW, SH)).toBe(793); // upright
    expect(t.see(852, 793, SW, SH)).toBe(793); // mid-turn: not kept as the landscape baseline...
    expect(t.see(852, 393, SW, SH)).toBe(393); // ...so on its side 393 is the baseline: no keyboard
    expect(t.see(393, 393, SW, SH)).toBe(793); // back upright, stale 393: the upright baseline holds
    expect(t.see(393, 793, SW, SH)).toBe(793);
    expect(t.see(393, 450, SW, SH)).toBe(793); // a real keyboard upright: 343 under the baseline
  });

  it("reads at once and again as the turn settles; a new turn starts over; a keyboard never counts as a turn", () => {
    const w = fakeWindow({ w: 393, h: 793 });
    const steps: number[] = [];
    const stop = onRotationSettle((s) => steps.push(s));
    w.resize(450); // a keyboard: same width
    vi.advanceTimersByTime(3000);
    expect(steps).toEqual([]);
    w.turn(852, 393, 500);
    vi.advanceTimersByTime(ROTATION_SETTLE_MS[ROTATION_SETTLE_MS.length - 1] + 10);
    expect(steps).toEqual(ROTATION_SETTLE_MS.map((_, i) => i));
    expect(ROTATION_SETTLE_MS[ROTATION_SETTLE_MS.length - 1]).toBeGreaterThanOrEqual(2000); // iOS can take 500ms+
    steps.length = 0;
    w.turn(393, 793, 500);
    vi.advanceTimersByTime(300);
    w.turn(852, 393, 500); // turned again mid-settle: one fresh run
    vi.advanceTimersByTime(3000);
    expect(steps.filter((s) => s === 0)).toHaveLength(2);
    expect(steps.slice(-ROTATION_SETTLE_MS.length)).toEqual(ROTATION_SETTLE_MS.map((_, i) => i));
    stop();
    expect(w.listenerCount()).toBe(0);
  });

  it("--app-vh (the home-screen app's height) ends right after turns where iOS lags, both ways", () => {
    const w = fakeWindow({ w: 393, h: 793 });
    new Function(IOS_WEB_APP_BOOT_SCRIPT)();
    expect(w.attrs.has("data-ios-web-app")).toBe(true);
    expect(w.styles.get("--app-vh")).toBe("793px");
    w.turn(852, 393, 450); // on its side; the height lags 450ms
    vi.advanceTimersByTime(100);
    expect(w.styles.get("--app-vh")).toBe("793px"); // the stale 852 × 793 was never kept
    vi.advanceTimersByTime(3000);
    expect(w.styles.get("--app-vh")).toBe("393px");
    w.turn(393, 793, 700); // back upright; mid-turn it reads 393 × 393, which fits on the screen
    vi.advanceTimersByTime(3000);
    expect(w.styles.get("--app-vh")).toBe("793px"); // the settle readings put it right
  });

  it("--app-vh: a keyboard never changes it, and a turn made while typing is read once the box is left", () => {
    const w = fakeWindow({ w: 393, h: 793 });
    new Function(IOS_WEB_APP_BOOT_SCRIPT)();
    w.focus("INPUT");
    w.resize(450); // the keyboard (the home-screen app's window shrinks with it)
    vi.advanceTimersByTime(3000);
    expect(w.styles.get("--app-vh")).toBe("793px");
    w.turn(852, 200, 0); // turned with the keyboard up
    vi.advanceTimersByTime(3000);
    expect(w.styles.get("--app-vh")).toBe("793px"); // not the keyboard's height
    w.resize(393); // keyboard down
    w.focus(null);
    vi.advanceTimersByTime(400);
    expect(w.styles.get("--app-vh")).toBe("393px");
  });

  it("only the iPhone home-screen app runs it", () => {
    const w = fakeWindow({ w: 393, h: 793, standalone: false });
    new Function(IOS_WEB_APP_BOOT_SCRIPT)();
    expect(w.attrs.has("data-ios-web-app")).toBe(false);
    expect(w.styles.has("--app-vh")).toBe(false);
  });

  it("every size kept across a turn is read as it settles: the keyboard, Crew's screens, the bottom gap, the pinned bars, the phone marker", () => {
    const kb = read("src/hooks/use-keyboard-open.ts");
    expect(kb).toContain("const baselines = tallestPerWidth();");
    expect(kb).toContain("const open = inset > 120 && typingNow();"); // no text box, no keyboard: a bad reading can't hide the bars
    expect(kb).toContain("onRotationSettle(schedule)");
    expect(read("src/hooks/use-touch-viewport.ts")).toContain("const tallest = tallestPerWidth();");
    const feed = read("src/lib/feed-paging.ts");
    expect(feed).toContain("const stopSettle = onRotationSettle((step) => {");
    expect(feed).toContain("if (step === 0) anchor = postOnScreen();");
    expect(feed).toContain("keepOnScreen(anchor);");
    expect(read("src/lib/ios-edge.ts")).toContain("const stopSettle = onRotationSettle(measure);");
    expect(read("src/components/app-shell.tsx")).toContain(
      "const stopSettle = onRotationSettle(schedule);",
    );
    expect(read("src/components/portrait-only.tsx")).toContain(
      "const stopSettle = onRotationSettle(sync);",
    );
  });
});
