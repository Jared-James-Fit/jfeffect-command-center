/**
 * Visits, from the browser (pulse-rules.ts says what's recorded and why). Started once from the
 * root (`AppPulse`), loaded after the app has painted. Fire-and-forget: it never waits on anything
 * the person is doing and never throws.
 *
 * Not recorded at all: a coach viewing as a client (their visit isn't the client's), Lovable's
 * preview hosts and local development, and an anonymous public-site visitor whose browser sends
 * Global Privacy Control or Do Not Track. A signed-in person whose browser sends one is counted
 * without a place.
 */
import { supabase } from "@/integrations/supabase/client";
import { readPovClient } from "@/lib/pov-guard";
import { captureSource, currentDevice, visitorId } from "@/lib/join-funnel";
import {
  BEAT_MS,
  featureOf,
  normalizePath,
  optedOut,
  osFor,
  platformOf,
  sessionStillGoing,
  surfaceOf,
  visitDevice,
} from "./pulse-rules";

const VISIT_KEY = "jf_visit_v1";

/** The device's time zone (Intl), which the server reads only to place a visit within its country. */
function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length <= 60 ? tz : null;
  } catch {
    return null;
  }
}
const ENDPOINT = "/api/public/app-pulse";

type View = { path: string; feature: string; at: string };

let started = false;
let visit: { id: string; lastActive: number } | null = null;
let queue: View[] = [];
let lastPath: string | null = null;
let visibleSince: number | null = null;
let activeMs = 0;
let sentFirst = false;
let flushTimer: number | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

function blockedHost(): boolean {
  const h = window.location.hostname;
  if (/(^|\.)lovableproject(-dev)?\.com$|^id-preview--|gpt-eng\.com$/.test(h)) return true;
  if ((h === "localhost" || h === "127.0.0.1") && !localStorage.getItem("jf_pulse_debug")) return true;
  return false;
}

/** The visit this page belongs to: the one in progress, or a new one after 30 minutes away. */
function currentVisit(now: number): { id: string; fresh: boolean } {
  if (!visit) {
    try {
      const raw = localStorage.getItem(VISIT_KEY);
      const saved = raw ? (JSON.parse(raw) as { id: string; lastActive: number }) : null;
      if (saved && /^[0-9a-f-]{36}$/i.test(saved.id) && sessionStillGoing(saved.lastActive, now)) visit = saved;
    } catch {
      visit = null;
    }
  }
  let fresh = false;
  if (!visit || !sessionStillGoing(visit.lastActive, now)) {
    visit = { id: uuid(), lastActive: now };
    fresh = true;
    sentFirst = false;
    activeMs = 0;
  }
  return { id: visit.id, fresh };
}

function touch(now = Date.now()): void {
  if (!visit) return;
  visit.lastActive = now;
  try {
    localStorage.setItem(VISIT_KEY, JSON.stringify(visit));
  } catch {
    /* private mode: the visit lives in memory */
  }
}

function nativePlatform(): "ios" | "android" | null {
  const cap = (window as any).Capacitor;
  try {
    const native = cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap.isNative);
    if (!native) return null;
    const p = typeof cap.getPlatform === "function" ? cap.getPlatform() : null;
    return p === "android" ? "android" : "ios";
  } catch {
    return null;
  }
}

function standalone(): boolean {
  try {
    return !!(window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone);
  } catch {
    return false;
  }
}

function povActive(signedInUserId: string | null): boolean {
  const pov = readPovClient();
  return !!pov && (!signedInUserId || pov.user_id !== signedInUserId);
}

async function send(final: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (visibleSince != null) {
    activeMs += now - visibleSince;
    visibleSince = document.visibilityState === "visible" ? now : null;
  }
  let token: string | null = null;
  let uid: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
    uid = data.session?.user?.id ?? null;
  } catch {
    token = null;
  }
  const out = optedOut(navigator as any, window as any);
  if (povActive(uid)) {
    queue = [];
    activeMs = 0;
    return;
  }
  if (!uid && out) {
    queue = [];
    return;
  }
  const vid = visitorId();
  if (!vid) return;
  const { id, fresh } = currentVisit(now);
  if (fresh) sentFirst = false;
  const views = queue.splice(0, 40);
  const seconds = Math.round(activeMs / 1000);
  activeMs = 0;
  if (!views.length && seconds <= 0 && sentFirst && !final) return;
  const first = !sentFirst;
  const path = lastPath ?? normalizePath(window.location.pathname);
  const body: Record<string, unknown> = {
    session: id,
    visitor: vid,
    views,
    seconds,
    optOut: out,
  };
  if (first) {
    const src = captureSource();
    const os = osFor(navigator.userAgent, (navigator as any).maxTouchPoints ?? 0);
    let coarse = false;
    try {
      coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    } catch {
      /* no media queries: size alone */
    }
    body.start = {
      surface: surfaceOf(window.location.pathname),
      entry: path,
      platform: platformOf({ native: nativePlatform(), standalone: standalone() }),
      device: visitDevice(currentDevice(), os, coarse),
      os,
      referrer: src.referrer ?? null,
      source: src.source ?? null,
      utm_source: src.utm_source ?? null,
      utm_medium: src.utm_medium ?? null,
      utm_campaign: src.utm_campaign ?? null,
      tz: deviceTimeZone(),
    };
  }
  sentFirst = true;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    // a lost beat loses a minute of counting, never anything the person did
  }
}

function record(pathname: string): void {
  const path = normalizePath(pathname);
  if (path === lastPath) return;
  lastPath = path;
  queue.push({ path, feature: featureOf(pathname), at: new Date().toISOString() });
  if (queue.length > 60) queue = queue.slice(-60);
  touch();
  // the first view goes at once (it opens the visit); later ones ride the next beat or a short wait
  if (!sentFirst) void send(false);
  else if (flushTimer == null)
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void send(false);
    }, 8_000);
}

/**
 * Start counting this tab's visit. `subscribe` calls back with the pathname on every resolved
 * navigation and returns an unsubscribe. Idempotent.
 */
export function startAppPulse(subscribe: (cb: (pathname: string) => void) => () => void): () => void {
  if (started || typeof window === "undefined" || blockedHost()) return () => {};
  started = true;
  visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  record(window.location.pathname);
  const unsub = subscribe((p) => record(p));
  const beat = window.setInterval(() => {
    if (document.visibilityState === "visible") void send(false);
  }, BEAT_MS);
  let lastTouch = 0;
  const onInput = () => {
    const now = Date.now();
    if (now - lastTouch > 15_000) {
      lastTouch = now;
      touch(now);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      visibleSince = Date.now();
      // back after 30 minutes away is a new visit, opened with the page on screen
      if (visit && !sessionStillGoing(visit.lastActive, Date.now())) {
        lastPath = null;
        record(window.location.pathname);
      } else touch();
    } else {
      void send(true);
    }
  };
  const onHide = () => void send(true);
  window.addEventListener("pointerdown", onInput, { passive: true });
  window.addEventListener("keydown", onInput);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  return () => {
    unsub();
    window.clearInterval(beat);
    window.removeEventListener("pointerdown", onInput);
    window.removeEventListener("keydown", onInput);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onHide);
    started = false;
  };
}
