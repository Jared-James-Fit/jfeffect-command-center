import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !p.includes(`${path.sep}test${path.sep}`)) out.push(p);
  }
  return out;
}

/** A tiny browser: storage, visibility, matchMedia, and whichever haptics route the test wants. */
function fakeBrowser(opts: { vibrate?: boolean; native?: boolean; nativeRegisterOnly?: boolean; nativeWithoutPlugin?: boolean; ios?: boolean; reduceMotion?: boolean; hidden?: boolean; active?: { tagName: string; type?: string } }) {
  const store = new Map<string, string>();
  const vibrate = vi.fn(() => true);
  const native = { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}), vibrate: vi.fn(async () => {}), selectionStart: vi.fn(async () => {}), selectionChanged: vi.fn(async () => {}), selectionEnd: vi.fn(async () => {}) };
  const labelClicks = vi.fn();
  const registerPlugin = vi.fn((name: string) => (name === "Haptics" ? native : undefined));
  const created: any[] = [];
  const body = { appendChild: (n: any) => { n.isConnected = true; created.push(n); return n; } };
  const document: any = {
    visibilityState: opts.hidden ? "hidden" : "visible",
    activeElement: opts.active ?? null,
    body,
    createElement: (tag: string) => {
      const el: any = { tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [] as any[], isConnected: false };
      el.setAttribute = (k: string, v: string) => (el.attrs[k] = v);
      el.addEventListener = () => {};
      el.appendChild = (c: any) => { el.children.push(c); return c; };
      Object.defineProperty(el, "firstElementChild", { get: () => el.children[0] ?? null });
      if (tag === "label") el.click = labelClicks;
      el.blur = () => {};
      return el;
    },
  };
  const window: any = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    matchMedia: (q: string) => ({ matches: q.includes("reduced-motion") ? !!opts.reduceMotion : false }),
    setTimeout: (f: () => void) => { f(); return 0; },
    // like the apps' bridges: each plugin the build links is on Plugins (registerPlugin is the
    // fallback for one that isn't, `nativeRegisterOnly`)
    Capacitor: opts.native || opts.nativeRegisterOnly || opts.nativeWithoutPlugin
      ? {
          isNativePlatform: () => true,
          isPluginAvailable: (n: string) => !opts.nativeWithoutPlugin && n === "Haptics",
          Plugins: opts.native ? { Haptics: native } : {},
          registerPlugin,
        }
      : undefined,
  };
  const navigator: any = {
    userAgent: opts.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (Linux; Android 14)",
    maxTouchPoints: 5,
  };
  if (opts.vibrate) navigator.vibrate = vibrate;
  class HTMLInputElement {}
  if (opts.ios) (HTMLInputElement.prototype as any).switch = false;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal("HTMLInputElement", HTMLInputElement);
  return { store, vibrate, native, labelClicks, created, registerPlugin };
}

async function engine() {
  vi.resetModules();
  return await import("@/platform/haptics");
}

describe("the haptics engine", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("picks the best route a device has: the app's own plugin, then vibrate, then the iPhone's switch", async () => {
    const { pickHapticRoute } = await import("@/platform/haptics");
    expect(pickHapticRoute({ native: true, vibrate: true, iosSwitch: true })).toBe("native");
    expect(pickHapticRoute({ native: false, vibrate: true, iosSwitch: false })).toBe("vibrate");
    expect(pickHapticRoute({ native: false, vibrate: false, iosSwitch: true })).toBe("ios");
    expect(pickHapticRoute({ native: false, vibrate: false, iosSwitch: false })).toBe("none");
  });

  it("never turns a burst into a buzz: two at once keep the stronger, a style never repeats faster than its gap", async () => {
    const { admitHaptic } = await import("@/platform/haptics");
    const g = { lastAny: -Infinity, lastWeight: 0, lastBy: {} };
    expect(admitHaptic("medium", 0, g)).toBe(true); // a set
    expect(admitHaptic("light", 10, g)).toBe(false); // a weaker one in the same instant
    expect(admitHaptic("success", 20, g)).toBe(true); // the PR right on top of it wins
    expect(admitHaptic("selection", 200, g)).toBe(true);
    expect(admitHaptic("selection", 220, g)).toBe(false); // a filter wheel spun fast: not every step
    expect(admitHaptic("selection", 260, g)).toBe(true);
    expect(admitHaptic("success", 300, g)).toBe(false); // the same success again inside its 400 ms
  });

  it("Android: short, tuned vibrate patterns; the setting, a hidden app and the spacing silence it", async () => {
    const b = fakeBrowser({ vibrate: true });
    const h = await engine();
    expect(h.hapticRoute()).toBe("vibrate");
    h.haptic("light");
    expect(b.vibrate).toHaveBeenLastCalledWith(12);
    vi.advanceTimersByTime(500);
    h.haptic("success");
    expect(b.vibrate).toHaveBeenLastCalledWith([14, 70, 22]);
    vi.advanceTimersByTime(500);
    h.setHapticsEnabled(false);
    b.vibrate.mockClear();
    h.haptic("medium");
    expect(b.vibrate).not.toHaveBeenCalled();
    expect(b.store.get("jf-haptics")).toBe("0");
    h.setHapticsEnabled(true); // turning it on gives a sample tap
    expect(b.vibrate).toHaveBeenCalledTimes(1);
  });

  it("nothing buzzes while the app is hidden, and reduce motion makes a pattern one short tap", async () => {
    const hidden = fakeBrowser({ vibrate: true, hidden: true });
    let h = await engine();
    h.haptic("success");
    expect(hidden.vibrate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const calm = fakeBrowser({ vibrate: true, reduceMotion: true });
    h = await engine();
    h.haptic("success");
    expect(calm.vibrate).toHaveBeenLastCalledWith(20); // medium, one pulse
    vi.advanceTimersByTime(2000);
    h.haptic("alarm"); // a timer still buzzes like a timer
    expect(calm.vibrate).toHaveBeenLastCalledWith([220, 110, 220, 110, 380]);
  });

  it("the installed app: the Capacitor Haptics plugin when its build has it (Taptic Engine kinds)", async () => {
    const b = fakeBrowser({ native: true, vibrate: true });
    const h = await engine();
    expect(h.hapticRoute()).toBe("native");
    h.haptic("medium");
    expect(b.native.impact).toHaveBeenLastCalledWith({ style: "MEDIUM" });
    vi.advanceTimersByTime(500);
    h.haptic("success");
    expect(b.native.notification).toHaveBeenLastCalledWith({ type: "SUCCESS" });
    vi.advanceTimersByTime(500);
    h.haptic("selection");
    expect(b.native.selectionChanged).toHaveBeenCalled();
    expect(b.vibrate).not.toHaveBeenCalled();
    expect(b.registerPlugin).not.toHaveBeenCalled();
    // a bridge that only lists it in its headers: registered once from the page
    vi.unstubAllGlobals();
    const reg = fakeBrowser({ nativeRegisterOnly: true, vibrate: true });
    const h3 = await engine();
    expect(h3.hapticRoute()).toBe("native");
    h3.haptic("light");
    h3.hapticRoute();
    expect(reg.native.impact).toHaveBeenLastCalledWith({ style: "LIGHT" });
    expect(reg.registerPlugin).toHaveBeenCalledTimes(1);
    expect(reg.registerPlugin).toHaveBeenCalledWith("Haptics");
    // an app build without the plugin falls back to the web's own route
    vi.unstubAllGlobals();
    const bare = fakeBrowser({ nativeWithoutPlugin: true, vibrate: true });
    const h2 = await engine();
    expect(h2.hapticRoute()).toBe("vibrate");
    h2.haptic("light");
    expect(bare.vibrate).toHaveBeenLastCalledWith(12);
    expect(bare.registerPlugin).not.toHaveBeenCalled();
  });

  it("iPhone web: a scripted switch tick (iOS 17.4–26.4) from a switch that's never drawn, never right after a real tap ticked", async () => {
    const b = fakeBrowser({ ios: true });
    const h = await engine();
    expect(h.hapticRoute()).toBe("ios");
    h.haptic("light");
    expect(b.labelClicks).toHaveBeenCalledTimes(1);
    const sw = b.created[0];
    expect(sw.tagName).toBe("LABEL");
    expect(sw.children[0].type).toBe("checkbox");
    expect(sw.children[0].attrs.switch).toBe("");
    // never drawn, so it can't take focus (a set logged by typing its weight still ticks)
    expect(sw.style.display).toBe("none");
    expect(sw.children[0].style.display).toBe("none");
    vi.advanceTimersByTime(500);
    h.haptic("success"); // two ticks
    expect(b.labelClicks).toHaveBeenCalledTimes(3);
    // a real tap on a HapticTap just ticked: the same moment's scripted tick stays quiet
    vi.advanceTimersByTime(500);
    h.noteTrustedTick();
    h.haptic("medium");
    expect(b.labelClicks).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(h.TRUSTED_TICK_QUIET_MS + 10);
    h.haptic("medium");
    expect(b.labelClicks).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
    const typing = fakeBrowser({ ios: true, active: { tagName: "INPUT", type: "text" } });
    const h2 = await engine();
    h2.haptic("medium");
    expect(typing.labelClicks).toHaveBeenCalledTimes(1);
  });

  it("a computer has no haptics, and the setting's row says so by not showing", async () => {
    fakeBrowser({});
    const h = await engine();
    expect(h.hapticRoute()).toBe("none");
    expect(h.hapticsAvailable()).toBe(false);
    const card = read("src/components/push/push-notification-card.tsx");
    expect(card).toContain('{route !== "none" && (');
    expect(card).toContain("data-haptics-switch");
    expect(card).toContain("data-sounds-switch");
  });
});

describe("one feedback() per moment", () => {
  it("everyday social taps are a light tap and silent; logging and milestones are felt and heard", async () => {
    const { FEEDBACK } = await import("@/lib/feedback");
    for (const e of ["like", "follow", "save", "repost", "comment"] as const) {
      expect(FEEDBACK[e]).toEqual({ haptic: "light", sound: null });
    }
    expect(FEEDBACK.set).toEqual({ haptic: "medium", sound: "set" });
    expect(FEEDBACK.exercise).toEqual({ haptic: "medium", sound: "exercise" });
    expect(FEEDBACK.pr).toEqual({ haptic: "success", sound: "pr" });
    // the JF Effect signature (the recap plays its longer sting instead)
    expect(FEEDBACK.workout).toEqual({ haptic: "success", sound: "workout" });
    // a confirmed value is a quiet tick; footage done and rest over are their own cues
    expect(FEEDBACK.confirm).toEqual({ haptic: "selection", sound: "confirm" });
    expect(FEEDBACK.upload).toEqual({ haptic: "success", sound: "upload" });
    expect(FEEDBACK.rest).toEqual({ haptic: "success", sound: "rest" });
    expect(FEEDBACK.warning).toEqual({ haptic: "warning", sound: "warning" });
    expect(FEEDBACK.milestone).toEqual({ haptic: "heavy", sound: "milestone" });
    expect(FEEDBACK.timer).toEqual({ haptic: "alarm", sound: "timer" });
    expect(FEEDBACK.error).toEqual({ haptic: "error", sound: "error" });
    // incoming things are heard, never felt
    for (const e of ["message", "notify", "reply"] as const) expect(FEEDBACK[e].haptic).toBeNull();
    // selection-weight moments never make a sound but a checkbox's tick
    for (const e of ["tap", "detent"] as const) expect(FEEDBACK[e]).toEqual({ haptic: "selection", sound: null });
    expect(FEEDBACK.toggle).toEqual({ haptic: "selection", sound: "tick" });
  });

  it("is the only way the app vibrates or plays a cue (one engine, one setting each)", () => {
    const files = walk(path.join(process.cwd(), "src"));
    const vibrates = files.filter((f) => !f.endsWith(`platform${path.sep}haptics.ts`) && /navigator\??\.vibrate|\.vibrate\??\.?\(/.test(readFileSync(f, "utf8")));
    expect(vibrates).toEqual([]);
    const sounds = files.filter((f) => !/lib[\\/](app-sounds|ui-sounds|feedback)\.ts$/.test(f) && /playAppSound\(/.test(readFileSync(f, "utf8")));
    expect(sounds).toEqual([]);
  });

  it("the iPhone's real-tap haptic sits under the buttons that matter, never a link or a submit", () => {
    const tap = read("src/components/haptic-tap.tsx");
    expect(tap).toContain("{...({ switch: \"\" } as Record<string, string>)}");
    expect(tap).toContain("onClick={(e) => e.stopPropagation()}");
    expect(tap).toContain("if (e.nativeEvent.isTrusted) noteTrustedTick();");
    expect(tap).toContain('if (hapticRoute() !== "ios") return;');
    for (const f of [
      "src/components/community/reaction-button.tsx",
      "src/components/community/follow-button.tsx",
      "src/components/community/repost-save.tsx",
      "src/components/workout-day/WorkoutDayView.tsx",
      "src/components/ui/checkbox.tsx",
      "src/components/ui/switch.tsx",
      // what logs, sends or finishes: Suggested's chip, the chat and comment sends, the review's save
      "src/components/workout-day/load-suggestion-card.tsx",
      "src/components/message-thread.tsx",
      "src/components/group-message-thread.tsx",
      "src/components/community/comments-sheet.tsx",
      "src/components/workout/shared/workout-review-editor.tsx",
    ]) {
      expect(read(f), f).toContain("<HapticTap />");
    }
  });

  it("each moment fires with its animation: the like's pop, the double-tap's heart, the set's green, the PR chip, the recap's reveal", () => {
    const like = read("src/components/community/reaction-button.tsx");
    expect(like).toContain('if (next) setPop((n) => n + 1);\n    // the heart\'s pop and its tap land together');
    expect(like).toContain('setBurst((b) => ({ n: b.n + 1, x, y }));\n    // every double-tap is a like: its tap lands with the heart\n    feedback("like");');
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain('const moment = feedback(completedSetCount >= setCount ? "exercise" : "set", {');
    expect(wdv).toContain('feedback("pr", { key: `${rowId}:${setIndex}:${existing.completed_at}`, at: existing.completed_at });');
    expect(read("src/components/workout-submission-summary.tsx")).toContain('const moment = feedback(stingRef.current === "pr" ? "pr" : "workout", { sound: false, key: `recap:');
    expect(read("src/lib/community.queries.ts")).toContain('feedback("post");');
    expect(read("src/components/tab-refresh.tsx")).toContain('if (p >= 1 && pullRef.current < 1) feedback("detent");');
  });

  it("the Android app declares vibration, or its web view's navigator.vibrate never reaches the motor", () => {
    const yml = read(".github/workflows/android-build.yml");
    expect(yml).toContain('"android.permission.VIBRATE"');
    expect(yml).toContain('assert "android.permission.VIBRATE" in open(app).read()');
    // and links the Haptics plugin (amplitude-controlled taps), checked after cap sync
    const add = yml.indexOf("@capacitor/haptics@8.");
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(yml.indexOf("npx cap add android"));
    expect(yml).toContain('grep -q "capacitor-haptics" android/capacitor.settings.gradle');
  });
});
