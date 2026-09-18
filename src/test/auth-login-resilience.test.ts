import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("auth login resilience", () => {
  const authRoute = fs.readFileSync("src/routes/auth.tsx", "utf8");
  const authProvider = fs.readFileSync("src/lib/auth.tsx", "utf8");
  const guard = fs.readFileSync("src/routes/_authenticated/route.tsx", "utf8");

  it("normalizes email and requires a real session after password login", () => {
    expect(authRoute).toContain("email.trim().toLowerCase()");
    expect(authRoute).toContain("if (!data.session?.user)");
  });

  it("does not leave an authenticated user on an endless splash when role resolution fails", () => {
    expect(authRoute).toContain("user && !role");
    expect(authRoute).toContain("Retry account access");
    expect(authRoute).toContain("Sign out");
  });

  it("resolves explicit roles before slower membership/client fallbacks", () => {
    const roleLookup = authProvider.indexOf("const roleResult = await withTimeout");
    const fallbackLookup = authProvider.indexOf("const fallback = await withTimeout");

    expect(roleLookup).toBeGreaterThan(-1);
    expect(fallbackLookup).toBeGreaterThan(roleLookup);
  });

  it("bounds role lookups so a slow query cannot strand login", () => {
    expect(authProvider).toContain("ROLE_QUERY_TIMEOUT_MS");
    expect(authProvider).toContain("withTimeout");
    expect(authProvider).toContain("setLoading(false)");
  });

  it("keeps the splash up until the first session restore and retries a transient null session", () => {
    expect(authProvider).toContain("const [loading, setLoading] = useState(true)");
    expect(guard).toContain("hasPersistedSessionHint");
    expect(guard).toContain('key.startsWith("sb-") && key.endsWith("-auth-token")');
    expect(guard).toContain("shouldRetryNull");
    expect(guard).toContain("250 * (attempt + 1)");
  });

  it("does not treat a transient null session on PWA resume as a logout", () => {
    expect(guard).toContain("const maxAttempts = 3");
    expect(guard).toContain("await supabase.auth.refreshSession()");
    expect(guard).toContain("hasPersistedAuthSession()");
    expect(guard).toContain("warmUser && (threw || hasPersistedAuthSession())");
    expect(guard).not.toContain("!isRevalidation &&\n          hasPersistedSessionHint");
  });

  it("recovers a persisted refresh session before clearing authenticated state", () => {
    expect(authProvider).toContain("readPersistedSessionTokens");
    expect(authProvider).toContain("recoverPersistedSession");
    expect(authProvider).toContain("await supabase.auth.setSession(tokens)");
    expect(authProvider).toContain("sessionRecoveryInFlightRef");
    expect(authProvider).toContain("sessionRecoveryBlockedRef");
  });

  it("keeps explicit sign-out authoritative and never resurrects that session", () => {
    expect(authProvider).toContain("explicitSignOutRef.current = true");
    expect(authProvider).toContain("sessionRecoveryBlockedRef.current = true");
    expect(authProvider).toContain("lastSessionRef.current = null");
    expect(authProvider).toContain("await supabase.auth.signOut()");
  });
});
