import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { hasPersistedAuthSession } from "@/lib/session-hint";

function stubStorage(entries: Record<string, string>) {
  const store = { ...entries };
  vi.stubGlobal("window", {
    localStorage: Object.assign(Object.create(null), store, {
      getItem: (k: string) => store[k] ?? null,
    }),
  });
}

describe("session hint (fast path for first-time visitors)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false on the server and for a visitor with no saved session", () => {
    expect(hasPersistedAuthSession()).toBe(false);
    stubStorage({ "jf:last-email": "a@b.com" });
    expect(hasPersistedAuthSession()).toBe(false);
  });

  it("is true when a Supabase auth token is saved", () => {
    stubStorage({ "sb-abc-auth-token": '{"user":{"id":"u1"}}' });
    expect(hasPersistedAuthSession()).toBe(true);
  });

  it("does not bounce when storage is blocked (lets normal auth decide)", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(hasPersistedAuthSession()).toBe(true);
  });

  it("root route sends the signed-out installed app straight to /auth; a visitor gets the landing page", () => {
    const route = fs.readFileSync("src/routes/index.tsx", "utf8");
    expect(route).toContain("beforeLoad");
    expect(route).toContain("!hasPersistedAuthSession() && installedApp()");
    expect(route).toContain('redirect({ to: "/auth", replace: true })');
    expect(route).toContain("<LandingPage packages={packages} />");
  });
});
