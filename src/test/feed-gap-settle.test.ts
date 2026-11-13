import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_GAP_SETTLE_MS, watchFeedViewport } from "@/lib/feed-paging";

/** A tiny stand-in for the page: the window's height, what a fixed box measures, and its listeners. */
function fakePage(windowH: number, screenH: () => number) {
  const props = new Map<string, string>();
  const winL = new Map<string, Set<() => void>>();
  const docL = new Map<string, Set<() => void>>();
  const on = (m: Map<string, Set<() => void>>) => (t: string, f: () => void) => {
    if (!m.has(t)) m.set(t, new Set());
    m.get(t)!.add(f);
  };
  const off = (m: Map<string, Set<() => void>>) => (t: string, f: () => void) => m.get(t)?.delete(f);
  const doc = {
    visibilityState: "visible",
    activeElement: null as unknown,
    documentElement: { style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } },
    body: { appendChild: () => undefined },
    createElement: () => ({ style: { cssText: "" }, getBoundingClientRect: () => ({ height: screenH() }), remove: () => undefined }),
    addEventListener: on(docL),
    removeEventListener: off(docL),
  };
  const win = {
    innerWidth: 393,
    innerHeight: windowH,
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    addEventListener: on(winL),
    removeEventListener: off(winL),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  const fire = (m: Map<string, Set<() => void>>, t: string) => [...(m.get(t) ?? [])].forEach((f) => f());
  return { props, doc, win, fireWindow: (t: string) => fire(winL, t), fireDoc: (t: string) => fire(docL, t) };
}

describe("the gap under the window is read again once the app settles (Nov 14 2026)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a bad first reading (the screen at the window's height) never sticks: the next one fixes it", () => {
    vi.useFakeTimers();
    let screen = 793; // iOS at the launch: the screen read as the window
    const page = fakePage(793, () => screen);
    const stop = watchFeedViewport();
    expect(page.props.get("--feed-vh")).toBe("793px");
    expect(page.props.get("--feed-gap")).toBe("0px");
    screen = 852; // settled: the tab bar sits at the screen's real bottom
    vi.advanceTimersByTime(FEED_GAP_SETTLE_MS[1]);
    expect(page.props.get("--feed-gap")).toBe("59px");
    // the pages keep the window's height, so a swipe still lands on the next post
    expect(page.props.get("--feed-vh")).toBe("793px");
    stop();
    expect(page.props.has("--feed-gap")).toBe(false);
  });

  it("coming back to the app, a resize and the first touch read it again; never while typing", () => {
    vi.useFakeTimers();
    let screen = 852;
    const page = fakePage(793, () => screen);
    const stop = watchFeedViewport();
    vi.advanceTimersByTime(5000);
    expect(page.props.get("--feed-gap")).toBe("59px");
    screen = 793;
    page.fireDoc("visibilitychange");
    expect(page.props.get("--feed-gap")).toBe("0px");
    screen = 852;
    page.fireWindow("touchstart");
    expect(page.props.get("--feed-gap")).toBe("59px");
    // a keyboard up (Android shrinks what a fixed box measures): the gap waits
    page.doc.activeElement = { tagName: "TEXTAREA" };
    screen = 500;
    page.fireWindow("resize");
    expect(page.props.get("--feed-gap")).toBe("59px");
    stop();
  });
});
