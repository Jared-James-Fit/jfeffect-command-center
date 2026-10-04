import { describe, expect, it } from "vitest";

// Node test env: minimal localStorage-backed window.
const store = new Map<string, string>();
(globalThis as any).window ??= {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
};
const { appSoundsEnabled, isThreadOpen, registerOpenThread, setAppSoundsEnabled } = await import("@/lib/app-sounds");

describe("app sounds", () => {
  it("is on by default and remembers the toggle", () => {
    window.localStorage.removeItem("jf-app-sounds");
    expect(appSoundsEnabled()).toBe(true);
    setAppSoundsEnabled(false);
    expect(appSoundsEnabled()).toBe(false);
    setAppSoundsEnabled(true);
    expect(appSoundsEnabled()).toBe(true);
  });

  it("tracks open threads so the global listener stays quiet", () => {
    const off = registerOpenThread("c1");
    expect(isThreadOpen("c1")).toBe(true);
    off();
    expect(isThreadOpen("c1")).toBe(false);
  });
});
