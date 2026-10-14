import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reopenTarget, type AppBoot } from "@/lib/app-reopen";

const read = (p: string) => readFileSync(p, "utf8");
const boot = (path: string, prev: AppBoot["previous"], link = false): AppBoot => ({ path, previous: prev, link });
const away = (path: string) => ({ path, state: "away" as const, at: 0 });
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
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "leaving", at: 0 }))).toBeNull();
    expect(go(boot("/portal/workouts/abc", { path: "/portal/workouts/abc", state: "open", at: 0 }))).toBeNull();
    expect(go(boot("/portal/workouts/abc", null))).toBeNull();
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
  });
});
