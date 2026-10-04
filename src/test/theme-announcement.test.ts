import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert }) },
}));

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { saveSeen, THEME_FEATURE_KEY } = await import("@/components/whats-new/theme-announcement");

describe("dark-mode what's-new popup", () => {
  const src = readFileSync("src/components/whats-new/theme-announcement.tsx", "utf8");

  beforeEach(() => {
    upsert.mockReset();
    store.clear();
  });

  it("records 'seen' on the server (idempotent upsert) and clears the pending marker", async () => {
    upsert.mockResolvedValue({ error: null });
    store.set("pending", "1");
    expect(await saveSeen("user-1", "pending")).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", feature_key: THEME_FEATURE_KEY },
      { onConflict: "user_id,feature_key", ignoreDuplicates: true },
    );
    expect(store.has("pending")).toBe(false);
  });

  it("retries a failed save until it lands", async () => {
    vi.useFakeTimers();
    upsert.mockResolvedValueOnce({ error: { message: "network" } }).mockResolvedValue({ error: null });
    store.set("pending", "1");
    const p = saveSeen("user-1", "pending");
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(store.has("pending")).toBe(false);
    vi.useRealTimers();
  });

  it("keeps the pending marker if every attempt fails, so it stays dismissed and retries next launch", async () => {
    vi.useFakeTimers();
    upsert.mockResolvedValue({ error: { message: "offline" } });
    store.set("pending", "1");
    const p = saveSeen("user-1", "pending", 3);
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);
    expect(store.get("pending")).toBe("1");
    vi.useRealTimers();
  });

  it("only shows after a fresh server check, never from a stale cached answer", () => {
    expect(src).toContain('refetchOnMount: "always"');
    expect(src).toContain("!isFetchedAfterMount");
    expect(readFileSync("src/lib/query-persister.ts", "utf8")).toContain('"feature-announcement"');
  });

  it("any close (Got it, X, outside tap, Escape) marks it seen", () => {
    expect(src).toContain("Got it");
    expect(src).toContain('aria-label="Close"');
    expect(src).toMatch(/onOpenChange=\{\(o\) => \{ if \(!o\) onClose\(\); \}\}/);
    expect(src).toMatch(/markPending\(pendingKey\);\s*void saveSeen\(userId, pendingKey\);/);
  });

  it("is mounted once for every signed-in surface", () => {
    expect(readFileSync("src/routes/_authenticated/route.tsx", "utf8")).toContain("<ThemeAnnouncementGate />");
  });
});
