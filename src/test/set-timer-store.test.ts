import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTimer } from "@/lib/set-timer-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("set timer external-store snapshots", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a Jennifer-style stored Plank timer snapshot referentially stable until storage changes", () => {
    const timerKey = "jennifer-day-1-plank-set-1";
    const storageKey = `jf.settimer.${timerKey}`;
    storage.setItem(storageKey, JSON.stringify({
      target: 45,
      endsAt: null,
      pausedRemaining: null,
    }));

    const first = readTimer(timerKey);
    const second = readTimer(timerKey);

    // This is the getSnapshot contract required by useSyncExternalStore.
    // A fresh parsed object on each read causes React #185 (maximum update depth)
    // when a stored per-set timer is rendered on mobile.
    expect(second).toBe(first);
    expect(first).toEqual({ target: 45, endsAt: null, pausedRemaining: null });

    storage.setItem(storageKey, JSON.stringify({
      target: 45,
      endsAt: 1_700_000_045_000,
      pausedRemaining: null,
    }));

    const changed = readTimer(timerKey);
    expect(changed).not.toBe(first);
    expect(readTimer(timerKey)).toBe(changed);
  });
});
