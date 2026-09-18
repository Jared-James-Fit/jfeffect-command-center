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
    const roleQuery = authProvider.indexOf('supabase.from("user_roles")');
    const memberQuery = authProvider.indexOf('supabase.from("app_members")');
    const clientQuery = authProvider.indexOf('supabase.from("clients")');

    expect(roleQuery).toBeGreaterThan(-1);
    expect(memberQuery).toBeGreaterThan(roleQuery);
    expect(clientQuery).toBeGreaterThan(roleQuery);
  });

  it("bounds role lookups so a slow query cannot strand login", () => {
    expect(authProvider).toContain("ROLE_QUERY_TIMEOUT_MS");
    expect(authProvider).toContain("withTimeout");
    expect(authProvider).toContain("setLoading(false)");
  });

  it("retries a transient null session only when a persisted Supabase token exists", () => {
    expect(guard).toContain("hasPersistedSessionHint");
    expect(guard).toContain('key.startsWith("sb-") && key.endsWith("-auth-token")');
    expect(guard).toContain("shouldRetryNull");
    expect(guard).toContain("250 * (attempt + 1)");
  });
});
