import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { uid: string; role: string } | null,
  pov: false,
  viewMode: null as "staff" | "client" | null,
}));
vi.mock("@/lib/auth", () => ({ cachedSessionRole: () => state.session }));
vi.mock("@/lib/client-impersonation", () => ({ hasStoredClientPov: () => state.pov }));
vi.mock("@/lib/view-mode", () => ({ getViewMode: () => state.viewMode }));

import { cachedLaunchHome, cachedLaunchTarget } from "@/lib/launch-home";
import { clearLastRoute, lastRouteFor, saveLastRoute } from "@/lib/route-persistence";

const read = (p: string) => readFileSync(p, "utf8");

// the browser's storage, in memory (these tests run in Node)
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});

describe("opening the app comes back where you left off", () => {
  beforeEach(() => {
    state.session = null;
    state.pov = false;
    state.viewMode = null;
    localStorage.clear();
  });

  it("reopens the last screen (Crew, a workout, a client), else the role's Home", () => {
    state.session = { uid: "u1", role: "client" };
    expect(cachedLaunchTarget()).toBe("/portal"); // nothing saved yet
    saveLastRoute("u1", "/portal/community");
    expect(cachedLaunchTarget()).toBe("/portal/community");
    saveLastRoute("u1", "/portal/workouts/abc");
    expect(cachedLaunchTarget()).toBe("/portal/workouts/abc");
    state.session = { uid: "u2", role: "admin" };
    saveLastRoute("u2", "/admin/clients/42");
    expect(cachedLaunchTarget()).toBe("/admin/clients/42");
  });

  it("only reopens what the role may open; sign-in pages and old entries never", () => {
    saveLastRoute("u1", "/admin/clients/42");
    expect(lastRouteFor("u1", "client")).toBeNull(); // a client never lands in staff pages
    expect(lastRouteFor("u1", "coach")).toBe("/admin/clients/42");
    saveLastRoute("u1", "/portal/community");
    expect(lastRouteFor("u1", "admin", "client")).toBe("/portal/community"); // dual account, client view
    saveLastRoute("u1", "/admin");
    expect(lastRouteFor("u1", "admin", "client")).toBeNull(); // client view never reopens staff pages
    saveLastRoute("u3", "/auth");
    expect(lastRouteFor("u3", "client")).toBeNull();
    localStorage.setItem("jf:last-route:u4", JSON.stringify({ pathname: "/portal/community", savedAt: Date.now() - 8 * 86_400_000 }));
    expect(lastRouteFor("u4", "client")).toBeNull(); // older than 7 days
    saveLastRoute("u5", "/portal/community");
    clearLastRoute("u5"); // sign-out
    expect(lastRouteFor("u5", "client")).toBeNull();
  });

  it("the fast launch still goes straight there when this device knows the role", () => {
    for (const [role, home] of [
      ["client", "/portal"],
      ["member", "/portal"],
      ["admin", "/admin"],
      ["coach", "/admin"],
      ["finance", "/finance"],
    ] as const) {
      state.session = { uid: "u1", role };
      expect(cachedLaunchHome()).toBe(home);
    }
    expect((state.session = null, cachedLaunchTarget())).toBeNull(); // nothing cached
    state.session = { uid: "u1", role: "admin" };
    state.pov = true;
    expect(cachedLaunchTarget()).toBeNull(); // "View as client": the full check decides
    state.pov = false;
    state.viewMode = "client";
    expect(cachedLaunchTarget()).toBeNull(); // dual account chose a view: the full check decides
  });

  it("is wired in: every screen is saved, the launch and the dual-account client view reopen it, nothing sends a reopen to Home", () => {
    expect(read("src/routes/__root.tsx")).toContain("saveLastRoute(user.id, location.pathname);");
    const index = read("src/routes/index.tsx");
    expect(index).toContain("const target = cachedLaunchTarget();");
    expect(index).toContain('lastRouteFor(user.id, role, "client") ?? "/portal"');
    expect(index).toContain("const saved = lastRouteFor(user.id, role);");
    expect(read("src/lib/auth.tsx")).toContain("if (uid) clearLastRoute(uid);");
    expect(existsSync("src/lib/app-reopen.ts")).toBe(false);
    expect(read("src/routes/_authenticated/route.tsx")).not.toContain("reopenTarget");
    expect(read("public/manifest.json")).toContain('"start_url": "/"');
  });
});
