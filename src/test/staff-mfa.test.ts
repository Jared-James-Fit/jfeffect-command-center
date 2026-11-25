import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bearerToken,
  decodeJwtClaims,
  MFA_NEEDED_MESSAGE,
  roleRequiresMfa,
  serverRefusesForMfa,
  verifiedFactorCount,
} from "@/lib/mfa-rules";
import { twoStepGateStep } from "@/lib/two-step";

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
  const gate = (o: Partial<Parameters<typeof twoStepGateStep>[0]>) =>
    twoStepGateStep({ team: false, required: false, aal: "aal1", verifiedFactors: 0, rememberedVerified: false, status: null, ...o });
  const verified = { verified: true, methods: [{ id: "1", kind: "sms" as const, label: "", createdAt: null, lastUsedAt: null }] };
  const unverified = { ...verified, verified: false };

  it("is the admin, the finance login and coaches (they see client records or the money), nobody else", () => {
    expect(roleRequiresMfa("admin")).toBe(true);
    expect(roleRequiresMfa("finance")).toBe(true);
    expect(roleRequiresMfa("coach")).toBe(true);
    for (const r of ["client", "member", "media_manager", null, undefined, ""]) expect(roleRequiresMfa(r as any)).toBe(false);
  });

  it("lets clients and members straight through with no request", () => {
    expect(gate({ team: false })).toBe("pass");
    expect(gate({ team: false, aal: "aal2" })).toBe("pass");
  });

  it("asks the server about a team login, unless this device confirmed the session already", () => {
    expect(gate({ team: true, required: true })).toBe("check");
    expect(gate({ team: true, required: true, rememberedVerified: true })).toBe("pass");
    expect(gate({ team: true, verifiedFactors: 1, aal: "aal2" })).toBe("pass");
  });

  it("asks a login that needs one and has none to set one up, and anyone else with none passes", () => {
    expect(gate({ team: true, required: true, status: { verified: false, methods: [] } })).toBe("enroll");
    // the finance login's old aal2 session, from an authenticator since removed, still sets one up
    expect(gate({ team: true, required: true, aal: "aal2", status: { verified: true, methods: [] } })).toBe("enroll");
    expect(gate({ team: true, required: false, status: { verified: false, methods: [] } })).toBe("pass");
  });

  it("asks a login with any way (text, passkey, app) to confirm once per session", () => {
    expect(gate({ team: true, required: true, status: unverified })).toBe("verify");
    expect(gate({ team: true, required: true, status: verified })).toBe("pass");
    // the server's answer wins over what this device remembered
    expect(gate({ team: true, required: true, rememberedVerified: true, status: unverified })).toBe("verify");
    // anyone with an authenticator app, whatever their role
    expect(gate({ team: false, verifiedFactors: 1, status: unverified })).toBe("verify");
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

  it("lets a session the server confirmed (a text, Face ID, a trusted device) through, and remembers it a minute", async () => {
    const SID = "a1000000-0000-0000-0000-000000000001";
    rpc.fn.mockImplementation(async (name: string, args: any) => {
      if (name === "mfa_enforced_logins") return { data: [ADMIN], error: null };
      if (name === "two_step_session_live") return { data: args._session === SID && args._uid === ADMIN, error: null };
      return { data: null, error: null };
    });
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1", session_id: SID })}`)).resolves.toBeUndefined();
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1", session_id: SID })}`)).resolves.toBeUndefined();
    expect(rpc.fn.mock.calls.filter((c) => c[0] === "two_step_session_live")).toHaveLength(1);
    // another session of the same login, not confirmed, is refused (and asked about every time)
    const other = "a2000000-0000-0000-0000-000000000002";
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1", session_id: other })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1", session_id: other })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
    expect(rpc.fn.mock.calls.filter((c) => c[0] === "two_step_session_live")).toHaveLength(3);
    // no session id at all: refused without asking
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1" })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
  });

  it("refuses when it can't check a session (never lets an unknown one through)", async () => {
    rpc.fn.mockImplementation(async (name: string) =>
      name === "mfa_enforced_logins" ? { data: [ADMIN], error: null } : { data: null, error: { message: "timeout" } },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkStaffMfa(`Bearer ${token({ sub: ADMIN, aal: "aal1", session_id: "a1000000-0000-0000-0000-000000000001" })}`)).rejects.toThrow(MFA_NEEDED_MESSAGE);
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
    expect(start).toContain("functionMiddleware: [attachSupabaseAuth, staffMfaGuard, teamPreviewGuard, nativeAppMark]");
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

  it("lets a session use a login's staff rights only once it's confirmed, if that login has a way to confirm (20270512090000)", () => {
    const later = readFileSync("supabase/migrations/20270512090000_two_step_sms_passkeys.sql", "utf8");
    const at = later.indexOf("FUNCTION public.caller_mfa_ok(");
    const ok = later.slice(at, later.indexOf("$function$;", at));
    expect(ok).toContain("_uid IS DISTINCT FROM auth.uid()");
    expect(ok).toContain("coalesce(auth.jwt() ->> 'aal', '') = 'aal2'");
    expect(ok).toContain("NOT public.two_step_login_has(_uid)");
    expect(ok).toContain("public.two_step_session_live(_uid, public.jwt_session_id())");
    expect(later).toContain("f.user_id = _uid AND f.status = 'verified'");
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

  it("keeps the list of logins with two-step for the server only", () => {
    for (const f of [sql, readFileSync("supabase/migrations/20270512090000_two_step_sms_passkeys.sql", "utf8")]) {
      expect(f).toContain("REVOKE ALL ON FUNCTION public.mfa_enforced_logins() FROM PUBLIC, anon, authenticated;");
      expect(f).toContain("GRANT EXECUTE ON FUNCTION public.mfa_enforced_logins() TO service_role;");
    }
  });

  it("defines is_business_owner before has_permission uses it, and gives up on a busy lock", () => {
    expect(sql.indexOf("FUNCTION public.is_business_owner(")).toBeLessThan(sql.indexOf("FUNCTION public.has_permission("));
    expect(sql).toContain("SET lock_timeout = '5s';");
    expect(sql.trim().endsWith("RESET lock_timeout;")).toBe(true);
  });
});
