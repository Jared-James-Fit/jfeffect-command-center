import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STALE_OPEN_MS, reopenTarget, type AppBoot } from "@/lib/app-reopen";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = 10_000_000;
const boot = (path: string, prev: AppBoot["previous"], link = false): AppBoot => ({ path, at: NOW, previous: prev, link });
const away = (path: string) => ({ path, state: "away" as const, at: NOW - 5_000 });
const go = (b: AppBoot, extra: Partial<Parameters<typeof reopenTarget>[0]> = {}) =>
  reopenTarget({ installed: true, boot: b, currentPath: b.path, home: "/portal", ...extra });

describe("a reopened app lands on Home, even when the phone hands back the last page", () => {
  it("closed from the app switcher on a workout → Home for the role", () => {
    expect(go(boot("/portal/workouts/abc", away("/portal/workouts/abc")))).toBe("/portal");
    expect(go(boot("/admin/clients/1", away("/admin/clients/1")), { home: "/admin" })).toBe("/admin");
    // role unknown here (View as client, dual account): the launch screen decides
    expect(go(boot("/portal/progress", away("/portal/progress")), { home: null })).toBe("/");
  });

  it("keeps the page for a reload or a hand-off while the app was in use", () => {
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "leaving", at: NOW - 3_600_000 }))).toBeNull();
    // died mid-use (a crash): its last beat is fresh
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "open", at: NOW - 20_000 }))).toBeNull();
    expect(go(boot("/portal/workouts/abc", null))).toBeNull();
  });

  it("the iPhone app: iOS reclaimed it asleep and Capacitor reloaded the last page (no 'hidden' ever fired)", () => {
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "open", at: NOW - STALE_OPEN_MS - 1 }))).toBe("/portal");
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "open", at: NOW - STALE_OPEN_MS + 1_000 }))).toBeNull();
  });

  it("honors a notification tap or a link to another page", () => {
    expect(go(boot("/portal/messages", away("/portal/messages"), true))).toBeNull();
    expect(go(boot("/portal/check-ins/x", away("/portal")))).toBeNull();
  });

  it("only the installed app, only the page it opened on, never Home itself or public pages", () => {
    expect(go(boot("/portal/workouts/abc", away("/portal/workouts/abc")), { installed: false })).toBeNull();
    expect(go(boot("/portal/workouts/abc", away("/portal/workouts/abc")), { currentPath: "/portal/plans" })).toBeNull();
    expect(go(boot("/portal", away("/portal")))).toBeNull();
    expect(go(boot("/admin/", away("/admin")), { home: "/admin" })).toBeNull();
    expect(go(boot("/book/jared", away("/book/jared")))).toBeNull();
    expect(go(boot("/auth", away("/auth")))).toBeNull();
  });

  it("is wired in before the page renders, and notification taps are marked", () => {
    const gate = read("src/routes/_authenticated/route.tsx");
    expect(gate).toContain("if (home) throw redirect({ to: home, replace: true });");
    expect(gate).toContain("installed: isInstalledApp(),");
    const root = read("src/routes/__root.tsx");
    expect(root).toContain("useEffect(() => trackAppState(), []);");
    expect(root).toContain("useEffect(() => noteAppPage(location.pathname), [location.pathname]);");
    expect(read("public/push-sw.js")).toContain("u.searchParams.set('jf_open', '1')");
    expect(read("vite.config.ts")).toContain('importScripts: ["/push-sw.js?v=20261014-open-link"]');
    const mod = read("src/lib/app-reopen.ts");
    expect(mod).toContain("if (e.persisted) return;");
    expect(mod).toContain("if (unloading) return;");
    // native pause / resume, and the on-screen heartbeat (silent while paused)
    expect(mod).toContain('keep(await App.addListener("pause", () => {');
    expect(mod).toContain("if (!unloading && !paused && document.visibilityState !== \"hidden\") writeState(\"open\", path());");
  });

  it("the app entry page (/app) sends a signed-in person to the same Home, not the membership welcome", () => {
    const app = read("src/routes/app.tsx");
    expect(app).toContain("const home = cachedLaunchHome();");
    expect(app).toContain('if (session?.user) navigate({ to: "/", replace: true });');
    expect(app).not.toContain('"/m/welcome"');
    expect(app).not.toContain('"/coach"');
  });
});
