import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ upsert }) } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { reconcileTheme, saveThemeToAccount } = await import("@/lib/theme-account-sync");

const T1 = "2026-10-04T10:00:00.000Z";
const T2 = "2026-10-04T12:00:00.000Z";
const base = { userId: "u1", dirty: false };

describe("theme follows the account until changed", () => {
  beforeEach(() => { upsert.mockReset(); store.clear(); });

  it("a fresh device adopts the choice saved on the account", () => {
    expect(reconcileTheme({ ...base, local: "light", localAt: null, localOwner: null, remote: { theme: "dark", theme_updated_at: T1 } }))
      .toEqual({ action: "apply", theme: "dark", at: T1 });
  });

  it("a choice made on this device before accounts were synced is saved to the account", () => {
    expect(reconcileTheme({ ...base, local: "dark", localAt: T1, localOwner: null, remote: null }))
      .toEqual({ action: "push", theme: "dark", at: T1 });
  });

  it("newest change wins: a later change on another device is applied here", () => {
    expect(reconcileTheme({ ...base, local: "dark", localAt: T1, localOwner: "u1", remote: { theme: "light", theme_updated_at: T2 } }))
      .toEqual({ action: "apply", theme: "light", at: T2 });
  });

  it("newest change wins: a later change here is pushed to the account", () => {
    expect(reconcileTheme({ ...base, local: "dark", localAt: T2, localOwner: "u1", remote: { theme: "light", theme_updated_at: T1 } }))
      .toEqual({ action: "push", theme: "dark", at: T2 });
  });

  it("an offline change that never saved is pushed on the next launch", () => {
    expect(reconcileTheme({ ...base, dirty: true, local: "dark", localAt: T1, localOwner: "u1", remote: { theme: "light", theme_updated_at: T2 } }))
      .toEqual({ action: "push", theme: "dark", at: T1 });
  });

  it("in sync → nothing to do", () => {
    expect(reconcileTheme({ ...base, local: "dark", localAt: T1, localOwner: "u1", remote: { theme: "dark", theme_updated_at: T1 } }))
      .toEqual({ action: "none" });
  });

  it("another account on a shared device never inherits the previous person's dark mode", () => {
    expect(reconcileTheme({ ...base, userId: "u2", local: "dark", localAt: T2, localOwner: "u1", remote: null }))
      .toMatchObject({ action: "apply", theme: "light" });
    expect(reconcileTheme({ ...base, userId: "u2", local: "light", localAt: T2, localOwner: "u1", remote: { theme: "dark", theme_updated_at: T1 } }))
      .toEqual({ action: "apply", theme: "dark", at: T1 });
  });

  it("saving retries until it lands and clears the dirty flag", async () => {
    vi.useFakeTimers();
    upsert.mockResolvedValueOnce({ error: { message: "offline" } }).mockResolvedValue({ error: null });
    const p = saveThemeToAccount("u1", "dark", T1);
    expect(store.get("jf-theme-dirty")).toBe("1");
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ user_id: "u1", theme: "dark", theme_updated_at: T1 }),
      { onConflict: "user_id" },
    );
    expect(store.has("jf-theme-dirty")).toBe(false);
    vi.useRealTimers();
  });
});
