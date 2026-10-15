import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.stubGlobal("window", globalThis);
// service-tier's hooks aren't called here, only its pure rule
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ loading: false }) }));
vi.mock("@/lib/client-impersonation", () => ({ useClientImpersonation: () => ({}), usePortalUserId: () => undefined }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { readServiceTierHint, writeServiceTierHint } from "@/lib/service-tier-hint";
import { resolveTierState } from "@/lib/service-tier";
import { claimPersistedCacheFor, QUERY_PERSIST_KEY, QUERY_PERSIST_OWNER_KEY } from "@/lib/query-persister";
import { readStoredSession } from "@/lib/session-hint";

const A = "3d502a48-303a-48cd-97d6-fad7ca5cc7e3";
const B = "b3f6e5b9-dc9a-4349-b183-96c4866e7a46";

beforeEach(() => store.clear());

describe("the portal knows coaching vs member on its first frame", () => {
  it("remembers the last tier per person, and only a well-formed one", () => {
    expect(readServiceTierHint(A)).toBeNull();
    writeServiceTierHint(A, { clientId: "c-a", tier: "coaching", status: "Active", made: true });
    writeServiceTierHint(B, { clientId: "c-b", tier: "self_serve", status: "Member" });
    expect(readServiceTierHint(A)).toEqual({ clientId: "c-a", tier: "coaching", status: "Active" });
    expect(readServiceTierHint(B)?.tier).toBe("self_serve");
    writeServiceTierHint(A, null);
    expect(readServiceTierHint(A)).toBeNull();
    store.set(`jfeffect.serviceTier.${A}`, JSON.stringify({ clientId: "c-a", tier: "vip" }));
    expect(readServiceTierHint(A)).toBeNull();
    store.set(`jfeffect.serviceTier.${A}`, "{not json");
    expect(readServiceTierHint(A)).toBeNull();
  });

  it("waits for a known tier instead of guessing", () => {
    const base = { userId: A, isImpersonating: false, authLoading: false, isError: false, hint: () => null };
    const coaching = { clientId: "c-a", tier: "coaching" as const, status: "Active" };
    // auth still resolving: no user id yet, so not known (was: "coaching" by default)
    expect(resolveTierState({ ...base, userId: undefined, authLoading: true, data: undefined }).loading).toBe(true);
    // first read in flight
    expect(resolveTierState({ ...base, data: undefined }).loading).toBe(true);
    // answered
    expect(resolveTierState({ ...base, data: coaching })).toEqual({ loading: false, data: coaching });
    // "no client row" is an answer too, never an endless wait
    expect(resolveTierState({ ...base, data: null })).toEqual({ loading: false, data: null });
    // a failed read uses the last tier seen here, else stops waiting
    expect(resolveTierState({ ...base, data: undefined, isError: true, hint: () => coaching })).toEqual({ loading: false, data: coaching });
    expect(resolveTierState({ ...base, data: undefined, isError: true }).loading).toBe(false);
    // viewing a client with no account yet: nothing to wait for
    expect(resolveTierState({ ...base, userId: undefined, isImpersonating: true, authLoading: true, data: undefined }).loading).toBe(false);
  });

  it("seeds the first frame from the hint, and a failed read never reads as no row", () => {
    const src = read("src/lib/service-tier.ts");
    expect(src).toContain("placeholderData: () => (userId ? readServiceTierHint(userId) ?? undefined : undefined)");
    expect(src).not.toContain("loading: q.isLoading");
    expect(src).toContain("if (error) throw error;");
  });

  it("Nutrition holds its title and a skeleton until the tier is known", () => {
    const src = read("src/routes/_authenticated/portal/nutrition-targets.tsx");
    const gate = src.slice(src.indexOf("function PortalNutritionByTier"), src.indexOf("function PortalNutrition()"));
    expect(gate).toContain("<PageBodySkeleton />");
    expect(gate).not.toContain("return null");
    expect(gate).toContain('tier === "self_serve" ? <MemberNutritionPage /> : <PortalNutrition />');
  });

  it("member screens saved on the device are keyed per person", () => {
    const nutrition = read("src/components/nutrition/member-nutrition-page.tsx");
    expect(nutrition).toContain('queryKey: ["m-nutrition-context", uid]');
    expect(nutrition).toContain('queryKey: ["m-nutrition-targets", uid]');
    expect(read("src/lib/member-access.ts")).toContain('queryKey: ["current-member-access", uid]');
  });
});

describe("a saved cache only ever paints for the person it belongs to", () => {
  it("drops another person's cache, keeps your own", () => {
    store.set(QUERY_PERSIST_KEY, "{}");
    expect(claimPersistedCacheFor(A)).toBe(false); // no owner yet: claim it, keep it
    expect(store.get(QUERY_PERSIST_OWNER_KEY)).toBe(A);
    expect(store.has(QUERY_PERSIST_KEY)).toBe(true);
    expect(claimPersistedCacheFor(A)).toBe(false);
    expect(store.has(QUERY_PERSIST_KEY)).toBe(true);
    expect(claimPersistedCacheFor(B)).toBe(true); // someone else signs in here
    expect(store.has(QUERY_PERSIST_KEY)).toBe(false);
    expect(store.get(QUERY_PERSIST_OWNER_KEY)).toBe(B);
  });

  it("is claimed before restore and on every change of who's signed in; sign-out clears again after Supabase", () => {
    expect(read("src/lib/query-persister.ts")).toContain("if (stored) claimPersistedCacheFor(stored.userId);");
    const auth = read("src/lib/auth.tsx");
    expect(auth).toContain("if (identityChanged && newUid && claimPersistedCacheFor(newUid)) {");
    expect(auth).toContain("if (prevUid) setRole(cached);");
    const signOut = auth.slice(auth.indexOf("const signOut = async"));
    const afterSupabase = signOut.slice(signOut.indexOf("await supabase.auth.signOut()"));
    expect(afterSupabase.indexOf("queryClient.clear()")).toBeGreaterThan(-1);
    expect(afterSupabase.indexOf("clearPersistedQueryCache()")).toBeGreaterThan(-1);
  });
});

describe("switching pages never waits on Supabase or swaps the whole app", () => {
  it("reads who is signed in and when their token runs out, without the network", () => {
    expect(readStoredSession()).toBeNull();
    store.set("sb-abc-auth-token", JSON.stringify({ access_token: "x", refresh_token: "y", expires_at: 1_900_000_000, user: { id: A } }));
    expect(readStoredSession()).toEqual({ userId: A, expiresAt: 1_900_000_000_000 });
    store.set("sb-abc-auth-token", JSON.stringify({ access_token: "x" }));
    expect(readStoredSession()).toBeNull();
  });

  it("the signed-in guard lets an in-app navigation straight through when the session is good", () => {
    const guard = read("src/routes/_authenticated/route.tsx");
    const before = guard.slice(guard.indexOf("beforeLoad: async"));
    const fast = before.indexOf("const fast = warmUserStillSignedIn();");
    expect(fast).toBeGreaterThan(-1);
    expect(fast).toBeLessThan(before.indexOf("supabase.auth.getSession()"));
    expect(guard).toContain("stored.userId !== warmUser.id");
    expect(guard).toContain("stored.expiresAt - Date.now() < FAST_PASS_MARGIN_MS");
  });

  it("a slow page waits inside the shell; a cold start keeps one splash", () => {
    const router = read("src/router.tsx");
    expect(router).toContain("defaultPendingComponent: RoutePending");
    const pending = read("src/components/route-pending.tsx");
    expect(pending).toContain("if (inShell) return <RoutePendingSkeleton />;");
    expect(pending).toContain("if (signedIn) return <DashboardSplash />;");
    expect(read("src/components/app-shell.tsx")).toContain("<ShellPageContext.Provider value>{children}</ShellPageContext.Provider>");
    expect(read("src/routes/_authenticated/route.tsx")).toContain("<SignedInAppContext.Provider value>");
  });

  it("the bottom tabs' code is fetched ahead of the first tap", () => {
    expect(read("src/components/app-shell.tsx")).toContain('usePreloadTabs(bottomItems.map((i) => i.to).filter((to) => to.startsWith("/")));');
    const hook = read("src/hooks/use-preload-tabs.ts");
    expect(hook).toContain("router.preloadRoute({ to }");
    expect(hook).toContain("saveData");
  });
});
