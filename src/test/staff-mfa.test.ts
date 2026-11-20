import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bearerToken,
  decodeJwtClaims,
  MFA_NEEDED_MESSAGE,
  mfaGateStep,
  roleRequiresMfa,
  serverRefusesForMfa,
  verifiedFactorCount,
} from "@/lib/mfa-rules";

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: (...a: any[]) => rpc.fn(...a) } }));

import { checkStaffMfa, resetMfaGuardCache } from "@/lib/mfa-guard.server";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CLIENT = "00000000-0000-0000-0000-00000000000c";

function token(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.c2lnbmF0dXJl`;
}

describe("who has to set up or enter a code", () => {
  it("is the admin and the finance login, nobody else", () => {
    expect(roleRequiresMfa("admin")).toBe(true);
    expect(roleRequiresMfa("finance")).toBe(true);
    for (const r of ["client", "coach", "media_manager", null, undefined, ""]) expect(roleRequiresMfa(r as any)).toBe(false);
  });

  it("asks the admin and finance logins to set one up, and lets everyone else through", () => {
    expect(mfaGateStep({ accountRole: "admin", aal: "aal1", verifiedFactors: 0 })).toBe("enroll");
    expect(mfaGateStep({ accountRole: "finance", aal: "aal1", verifiedFactors: 0 })).toBe("enroll");
    expect(mfaGateStep({ accountRole: "client", aal: "aal1", verifiedFactors: 0 })).toBe("pass");
    expect(mfaGateStep({ accountRole: null, aal: "aal1", verifiedFactors: 0 })).toBe("pass");
  });

  it("asks anyone with an authenticator for its code once per session, whatever their role", () => {
    expect(mfaGateStep({ accountRole: "admin", aal: "aal1", verifiedFactors: 1 })).toBe("verify");
    expect(mfaGateStep({ accountRole: "client", aal: "aal1", verifiedFactors: 2 })).toBe("verify");
    expect(mfaGateStep({ accountRole: null, aal: undefined, verifiedFactors: 1 })).toBe("verify");
    expect(mfaGateStep({ accountRole: "admin", aal: "aal2", verifiedFactors: 1 })).toBe("pass");
  });

  it("asks a login that needs one to set one up even when its session still reads verified from an authenticator since removed", () => {
    // The finance login's Oct 10 session is still aal2, from the code step removed Oct 9 2026.
    expect(mfaGateStep({ accountRole: "finance", aal: "aal2", verifiedFactors: 0 })).toBe("enroll");
    expect(mfaGateStep({ accountRole: "admin", aal: "aal2", verifiedFactors: 0 })).toBe("enroll");
    expect(mfaGateStep({ accountRole: "client", aal: "aal2", verifiedFactors: 0 })).toBe("pass");
  });

  it("checks with Supabase before showing setup, so one just added in a verified session never asks twice", () => {
    const gate = readFileSync("src/components/two-step/staff-mfa-gate.tsx", "utf8");
    expect(gate).toContain("firstAuthenticatorId()");
    expect(gate).toContain("if (id && sessionVerified) return onAlreadyDone();");
  });

  it("counts only verified authenticators (a half-finished setup is none)", () => {
    expect(verifiedFactorCount({ factors: [{ status: "verified" }, { status: "unverified" }] })).toBe(1);
    expect(verifiedFactorCount({ factors: [] })).toBe(0);
    expect(verifiedFactorCount(null)).toBe(0);
    expect(verifiedFactorCount({})).toBe(0);
  });
});

describe("reading the session's level from its token", () => {
  it("reads a Supabase token's claims, accents and all", () => {
    const claims = decodeJwtClaims(token({ sub: ADMIN, aal: "aal2", email: "josé@example.com" }));
    expect(claims).toMatchObject({ sub: ADMIN, aal: "aal2", email: "josé@example.com" });
  });

  it("gives nothing for anything that isn't a token", () => {
    for (const t of [null, undefined, "", "abc", "a.b", "a.!!!.c", "a.b.c.d"]) expect(decodeJwtClaims(t as any)).toBeNull();
  });

  it("takes the token from a Bearer header only", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer  abc ")).toBe("abc");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
  });

  it("refuses only a login with an authenticator whose session hasn't had its code", () => {
    const enrolled = new Set([ADMIN]);
    expect(serverRefusesForMfa({ sub: ADMIN, aal: "aal1" }, enrolled)).toBe(true);
    expect(serverRefusesForMfa({ sub: ADMIN }, enrolled)).toBe(true);
    expect(serverRefusesForMfa({ sub: ADMIN, aal: "aal2" }, enrolled)).toBe(false);
    expect(serverRefusesForMfa({ sub: CLIENT, aal: "aal1" }, enrolled)).toBe(false);
    expect(serverRefusesForMfa({ sub: ADMIN, aal: "aal1" }, null)).toBe(false);
    expect(serverRefusesForMfa(null, enrolled)).toBe(false);
    expect(serverRefusesForMfa({ role: "service_role" }, enrolled)).toBe(false);
  });
});

describe("the server guard every server function runs through", () => {
  beforeEach(() => {
    resetMfaGuardCache();
    rpc.fn.mockReset();
    rpc.fn.mockResolvedValue({ data: [ADMIN], error: null });
  });

  it("refuses an enrolled admin's password-only session and lets the same login through after its code", async () => {
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1" })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal2" })}`)).resolves.toBeUndefined();
  });

  it("lets clients and signed-out calls through, and reads the list once a minute, not per call", async () => {
    for (let i = 0; i < 5; i++) await checkStaffMfa(`Bearer ${token({ sub: CLIENT, aal: "aal1" })}`);
    await checkStaffMfa(null);
    await checkStaffMfa("Bearer not-a-token");
    expect(rpc.fn).toHaveBeenCalledTimes(1);
    expect(rpc.fn).toHaveBeenCalledWith("mfa_enforced_logins");
  });

  it("never asks the database for a session that has had its code", async () => {
    await checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal2" })}`);
    expect(rpc.fn).not.toHaveBeenCalled();
  });

  it("goes through when the list can't be read (the database's own checks still hold)", async () => {
    rpc.fn.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1" })}`)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("keeps the last list it read when a later read fails", async () => {
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1" })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    rpc.fn.mockRejectedValue(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1" })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
    warn.mockRestore();
    vi.useRealTimers();
  });
});

describe("wired in everywhere", () => {
  it("runs the guard on every server function, before the team-preview guard", () => {
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain("functionMiddleware: [attachSupabaseAuth, staffMfaGuard, teamPreviewGuard]");
    expect(start).toContain('import("@/lib/mfa-guard.server")');
  });

  it("puts the gate over every signed-in page, and the backup authenticator card on the admin's account", () => {
    const layout = readFileSync("src/routes/_authenticated/route.tsx", "utf8");
    const body = layout.slice(layout.indexOf("function AuthenticatedLayout"));
    expect(body.indexOf("<StaffMfaGate>")).toBeGreaterThan(-1);
    expect(body.indexOf("<StaffMfaGate>")).toBeLessThan(body.indexOf("<CoachingAgreementProvider>"));
    expect(body.indexOf("</StaffMfaGate>")).toBeGreaterThan(body.indexOf("</CoachingAgreementProvider>"));
    expect(readFileSync("src/routes/_authenticated/admin/account.tsx", "utf8")).toContain("<TwoStepCard />");
  });
});

describe("the database half (20270424091500_staff_mfa.sql)", () => {
  const sql = readFileSync("supabase/migrations/20270424091500_staff_mfa.sql", "utf8");
  const fn = (name: string) => {
    const at = sql.indexOf(`FUNCTION public.${name}(`);
    return sql.slice(at, sql.indexOf("$function$;", at));
  };

  it("lets a session use a login's staff rights only once it has had its code, if that login has an authenticator", () => {
    const ok = fn("caller_mfa_ok");
    expect(ok).toContain("_uid IS DISTINCT FROM auth.uid()");
    expect(ok).toContain("coalesce(auth.jwt() ->> 'aal', '') = 'aal2'");
    expect(ok).toContain("f.user_id = _uid AND f.status = 'verified'");
  });

  it("checks it in all four functions, only after the role is found, and never for the client role", () => {
    for (const name of ["has_role", "has_permission", "is_admin_viewer", "is_business_owner"]) {
      const body = fn(name);
      expect(body, name).toMatch(/CASE[\s\S]*THEN[\s\S]*caller_mfa_ok/);
    }
    expect(fn("has_role")).toContain("_role = 'client' OR public.caller_mfa_ok(_user_id)");
    // the finance login's admin view still goes through is_admin_viewer, in read-only transactions
    expect(fn("has_role")).toContain("current_setting('transaction_read_only') = 'on'");
    expect(fn("has_role")).toContain("public.is_admin_viewer()");
  });

  it("keeps the list of logins with an authenticator for the server only", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.mfa_enforced_logins() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mfa_enforced_logins() TO service_role;");
  });

  it("defines is_business_owner before has_permission uses it, and gives up on a busy lock", () => {
    expect(sql.indexOf("FUNCTION public.is_business_owner(")).toBeLessThan(sql.indexOf("FUNCTION public.has_permission("));
    expect(sql).toContain("SET lock_timeout = '5s';");
    expect(sql.trim().endsWith("RESET lock_timeout;")).toBe(true);
  });
});
