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

import { cachedLaunchHome } from "@/lib/launch-home";

const read = (p: string) => readFileSync(p, "utf8");

describe("opening the app lands on Home", () => {
  beforeEach(() => {
    state.session = null;
    state.pov = false;
    state.viewMode = null;
  });

  it("goes straight to the role's Home when this device knows the role", () => {
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
  });

  it("waits for the full sign-in check when it can't be sure", () => {
    expect(cachedLaunchHome()).toBeNull(); // nothing cached
    state.session = { uid: "u1", role: "media_manager" };
    expect(cachedLaunchHome()).toBeNull(); // no Home of its own
    state.session = { uid: "u1", role: "admin" };
    state.pov = true;
    expect(cachedLaunchHome()).toBeNull(); // "View as client" in progress
    state.pov = false;
    state.viewMode = "client";
    expect(cachedLaunchHome()).toBeNull(); // staff + client account chose a view
  });

  it("never restores the last screen; the dual-account client view opens portal Home too", () => {
    expect(existsSync("src/lib/route-persistence.ts")).toBe(false);
    const index = read("src/routes/index.tsx");
    expect(index).not.toContain("getLastRoute");
    expect(index).toContain("forgetSavedLastRoutes();");
    expect(index).toContain('if (data?.id) navigate({ to: "/portal" as any, replace: true });');
    expect(index).not.toContain("/portal/workouts");
    expect(read("src/routes/__root.tsx")).not.toContain("saveLastRoute");
    expect(read("public/manifest.json")).toContain('"start_url": "/"');
  });
});
