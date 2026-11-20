/**
 * Haptics: one engine for every way a phone can give a tap (feedback.ts picks
 * which tap a moment gets). In order of preference:
 *
 *   native   the installed app's Taptic Engine / vibrator, when its build has
 *            the Capacitor Haptics plugin (`Capacitor.isPluginAvailable`).
 *   vibrate  Android's browsers and home-screen app: `navigator.vibrate`,
 *            short patterns tuned so a light tap stays light.
 *   ios      iPhone Safari, its home-screen app and the app's web view, which
 *            have no vibrate: WebKit taps the Taptic Engine when an
 *            `<input type="checkbox" switch>` changes. A real finger tap on
 *            one does it on every iOS from 17.4 (HapticTap puts a hidden one
 *            under the key buttons); a scripted click did too until iOS 26.5,
 *            so it's still tried for older iPhones and does nothing on newer.
 *   none     computers, and anything else.
 *
 * The person's own switch (Settings → Notifications → Sounds & haptics,
 * per device, on by default) turns all of it off, nothing buzzes while the
 * app is hidden, and with "reduce motion" on a pattern is one short tap.
 * iPhones also follow their own System Haptics setting, Android its own.
 */

export type HapticStyle =
  /** a value picked, a switch flipped, a swipe crossing its commit point */
  | "selection"
  /** an everyday action (like, follow, save, send) */
  | "light"
  /** a set logged, a long press opening something */
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error"
  /** a timer going off: the one long buzz */
  | "alarm";

const KEY = "jf-haptics";
const listeners = new Set<(on: boolean) => void>();

export function hapticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l(on));
  if (on) haptic("success", { force: true });
}

export function subscribeHaptics(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Android / vibrate patterns (ms). Below ~8 ms many motors don't spin up at all. */
export const VIBRATE_PATTERNS: Record<HapticStyle, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 20,
  heavy: 32,
  success: [14, 70, 22],
  warning: [24, 80, 24],
  error: [30, 60, 30, 60, 30],
  alarm: [220, 110, 220, 110, 380],
};

/** iPhone web: how many switch ticks a style is (a scripted tick, iOS 17.4–26.4 only). */
export const IOS_TICKS: Record<HapticStyle, number> = {
  selection: 1,
  light: 1,
  medium: 1,
  heavy: 2,
  success: 2,
  warning: 2,
  error: 3,
  alarm: 3,
};

/** With "reduce motion" on, a pattern is one tap (the alarm stays: it's what a timer is for). */
export function reducedStyle(style: HapticStyle): HapticStyle {
  if (style === "alarm") return style;
  if (style === "success" || style === "warning" || style === "heavy") return "medium";
  if (style === "error") return "medium";
  return style;
}

/** How strong a style is: two at once keep the stronger. */
export const HAPTIC_WEIGHT: Record<HapticStyle, number> = {
  selection: 0,
  light: 1,
  medium: 2,
  heavy: 3,
  warning: 3,
  success: 4,
  error: 4,
  alarm: 5,
};
/** The same style again only after this long (ms): a burst of events is one tap. */
const SAME_GAP: Record<HapticStyle, number> = {
  selection: 40,
  light: 70,
  medium: 90,
  heavy: 150,
  success: 400,
  warning: 400,
  error: 400,
  alarm: 1000,
};

export type HapticGate = { lastAny: number; lastWeight: number; lastBy: Partial<Record<HapticStyle, number>> };
/**
 * Two haptics in the same instant are one (the stronger), and a style never
 * repeats faster than its own gap, so nothing ever turns into a buzz.
 * Updates `gate` when it admits.
 */
export function admitHaptic(style: HapticStyle, now: number, gate: HapticGate): boolean {
  const weight = HAPTIC_WEIGHT[style];
  if (now - gate.lastAny < 45 && weight <= gate.lastWeight) return false;
  if (now - (gate.lastBy[style] ?? -Infinity) < SAME_GAP[style]) return false;
  gate.lastAny = now;
  gate.lastWeight = weight;
  gate.lastBy[style] = now;
  return true;
}
const gate: HapticGate = { lastAny: -Infinity, lastWeight: 0, lastBy: {} };

export type HapticRoute = "native" | "vibrate" | "ios" | "none";
export type RouteReading = { native: boolean; vibrate: boolean; iosSwitch: boolean };

/** Which route this device has (pure, tested): native beats vibrate beats the iPhone switch. */
export function pickHapticRoute(r: RouteReading): HapticRoute {
  if (r.native) return "native";
  if (r.vibrate) return "vibrate";
  if (r.iosSwitch) return "ios";
  return "none";
}

type NativeHaptics = {
  impact: (o: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void>;
  notification: (o: { type: "SUCCESS" | "WARNING" | "ERROR" }) => Promise<void>;
  vibrate?: (o: { duration: number }) => Promise<void>;
  selectionStart?: () => Promise<void>;
  selectionChanged?: () => Promise<void>;
  selectionEnd?: () => Promise<void>;
};
let nativePlugin: NativeHaptics | null = null;
function nativeHaptics(): NativeHaptics | null {
  if (nativePlugin) return nativePlugin;
  if (typeof window === "undefined") return null;
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.("Haptics")) return null;
    // The app's bridge puts each plugin its build links on Capacitor.Plugins (Android and iOS
    // alike); registerPlugin is only the fallback, since the page never imports @capacitor/haptics.
    const p = cap.Plugins?.Haptics ?? (typeof cap.registerPlugin === "function" ? cap.registerPlugin("Haptics") : null);
    if (p && typeof p.impact === "function") nativePlugin = p as NativeHaptics;
    return nativePlugin;
  } catch {
    return null;
  }
}

/** An iPhone / iPad (the iPad that says it's a Mac too) whose WebKit has the switch control. */
export function iosSwitchHaptics(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && typeof HTMLInputElement !== "undefined" && "switch" in HTMLInputElement.prototype;
}

export function hapticRoute(): HapticRoute {
  if (typeof window === "undefined") return "none";
  return pickHapticRoute({
    native: !!nativeHaptics(),
    vibrate: typeof navigator !== "undefined" && typeof (navigator as any).vibrate === "function",
    iosSwitch: iosSwitchHaptics(),
  });
}

/** This device can give a tap at all (the setting shows only where it can). */
export function hapticsAvailable(): boolean {
  return hapticRoute() !== "none";
}

// ── iPhone: the switch ─────────────────────────────────────────────────────

/** A real tap just ticked a switch (HapticTap): a scripted tick right after would be a second one. */
let trustedTickAt = -Infinity;
/** How long after a real tick a scripted one stays quiet (a set's save, a PR, land well after the tap). */
export const TRUSTED_TICK_QUIET_MS = 1200;
export function noteTrustedTick() {
  trustedTickAt = Date.now();
}

let switchLabel: HTMLLabelElement | null = null;
function hiddenSwitch(): HTMLLabelElement | null {
  if (switchLabel?.isConnected) return switchLabel;
  if (typeof document === "undefined" || !document.body) return null;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.setAttribute("data-haptic-switch", "");
  // never drawn (WebKit still taps the Taptic Engine for a switch it doesn't draw), so it can
  // never take focus: a tick while a weight box has the keyboard up leaves the keyboard alone
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  input.style.display = "none";
  label.appendChild(input);
  // never let a scripted tick reach the page's own click handlers ("click outside" closers)
  label.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(label);
  switchLabel = label;
  return label;
}

function iosTick() {
  const label = hiddenSwitch();
  if (!label) return;
  try {
    label.click();
  } catch {
    /* not here */
  }
}

function playIos(style: HapticStyle) {
  // a real tap already ticked: the tap was this moment's haptic
  if (Date.now() - trustedTickAt < TRUSTED_TICK_QUIET_MS) return;
  const n = IOS_TICKS[style];
  for (let i = 0; i < n; i++) {
    if (i === 0) iosTick();
    else window.setTimeout(iosTick, i * 110);
  }
}

function playNative(p: NativeHaptics, style: HapticStyle) {
  const run = (f: () => Promise<void> | undefined) => {
    try {
      void f()?.catch?.(() => {});
    } catch {
      /* not here */
    }
  };
  switch (style) {
    case "selection":
      if (p.selectionChanged) {
        run(() => p.selectionStart?.());
        run(() => p.selectionChanged?.());
        run(() => p.selectionEnd?.());
      } else run(() => p.impact({ style: "LIGHT" }));
      return;
    case "light":
      return run(() => p.impact({ style: "LIGHT" }));
    case "medium":
      return run(() => p.impact({ style: "MEDIUM" }));
    case "heavy":
      return run(() => p.impact({ style: "HEAVY" }));
    case "success":
      return run(() => p.notification({ type: "SUCCESS" }));
    case "warning":
      return run(() => p.notification({ type: "WARNING" }));
    case "error":
      return run(() => p.notification({ type: "ERROR" }));
    case "alarm":
      return run(() => (p.vibrate ? p.vibrate({ duration: 600 }) : p.notification({ type: "WARNING" })));
  }
}

function reduceMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Give a tap. Never throws, never waits. `force` skips the switch and the
 * spacing (the setting's own sample tap).
 */
export function haptic(style: HapticStyle = "light", opts: { force?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  if (!opts.force) {
    if (!hapticsEnabled()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!admitHaptic(style, Date.now(), gate)) return;
  }
  const s = reduceMotion() ? reducedStyle(style) : style;
  const route = hapticRoute();
  try {
    if (route === "native") {
      const p = nativeHaptics();
      if (p) playNative(p, s);
    } else if (route === "vibrate") {
      (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(VIBRATE_PATTERNS[s]);
    } else if (route === "ios") {
      playIos(s);
    }
  } catch {
    /* never let a haptic break the UI */
  }
}
