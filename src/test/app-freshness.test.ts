import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideOnNewBuild, isSafeToReloadPath, RESUME_MIN_AWAY_MS } from "@/lib/app-freshness";

const base = { live: "b2", running: "b1", awayMs: RESUME_MIN_AWAY_MS, pathname: "/admin/messages", unsaved: false, alreadyReloadedFor: null };

describe("picking up a new publish on the phone", () => {
  it("does nothing when already on the live build (or in dev)", () => {
    expect(decideOnNewBuild({ ...base, live: "b1" })).toBe("none");
    expect(decideOnNewBuild({ ...base, running: "dev" })).toBe("none");
  });

  it("reloads on reopening the app where nothing can be lost", () => {
    expect(decideOnNewBuild(base)).toBe("reload");
    expect(decideOnNewBuild({ ...base, pathname: "/portal" })).toBe("reload");
  });

  it("only prompts mid-task: typing/uploading, a workout or form, or without leaving the app", () => {
    expect(decideOnNewBuild({ ...base, unsaved: true })).toBe("prompt");
    expect(decideOnNewBuild({ ...base, pathname: "/portal/workouts/abc" })).toBe("prompt");
    expect(decideOnNewBuild({ ...base, pathname: "/portal/check-ins/form-1" })).toBe("prompt");
    expect(decideOnNewBuild({ ...base, awayMs: 5_000 })).toBe("prompt");
  });

  it("never reload-loops on the same build", () => {
    expect(decideOnNewBuild({ ...base, alreadyReloadedFor: "b2" })).toBe("prompt");
  });

  it("treats home, messages, inbox and notifications as safe", () => {
    for (const p of ["/", "/admin", "/m/", "/admin/messages", "/admin/communication", "/notifications"]) {
      expect(isSafeToReloadPath(p)).toBe(true);
    }
    for (const p of ["/portal/workouts/1", "/admin/clients", "/portal/check-in"]) {
      expect(isSafeToReloadPath(p)).toBe(false);
    }
  });

  it("stamps every build and checks from the app root", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toContain("__APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID)");
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain("useAppFreshness();");
    expect(readFileSync("src/lib/app-version.functions.ts", "utf8")).toContain("createServerFn");
  });
});
