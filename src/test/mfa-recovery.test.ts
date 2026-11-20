import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECOVERY_ALPHABET,
  RECOVERY_CODE_COUNT,
  normalizeRecoveryCode,
  recoveryCodeFrom,
  recoveryCodeHash,
  recoveryCodesFile,
} from "@/lib/mfa-recovery";
import { MFA_EXEMPT_FNS, mfaExemptFn } from "@/lib/mfa-rules";

const bytes = (...n: number[]) => Uint8Array.from(n);

describe("recovery codes", () => {
  it("are ten letters and numbers in two halves, from an alphabet with no look-alikes", () => {
    const code = recoveryCodeFrom(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    for (const ch of "01ilo") expect(RECOVERY_ALPHABET).not.toContain(ch);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(() => recoveryCodeFrom(bytes(1, 2, 3))).toThrow();
  });

  it("read back whatever way they're typed or pasted", () => {
    const code = recoveryCodeFrom(bytes(9, 8, 7, 6, 5, 4, 3, 2, 1, 0));
    const stored = code.replace("-", "");
    expect(normalizeRecoveryCode(code)).toBe(stored);
    expect(normalizeRecoveryCode(code.toUpperCase())).toBe(stored);
    expect(normalizeRecoveryCode(` ${code.slice(0, 5)} ${code.slice(6)} `)).toBe(stored);
    expect(normalizeRecoveryCode(stored)).toBe(stored);
  });

  it("refuse anything that can't be one rather than guess", () => {
    for (const bad of ["", null, undefined, "abcde", "abcde-fghjkm", "abcde-fghj0", "o1ili-abcde", "abcde-fgh!k"]) {
      expect(normalizeRecoveryCode(bad as any), String(bad)).toBeNull();
    }
  });

  it("are kept only as a SHA-256 hash, one per code", async () => {
    const a = await recoveryCodeHash("abcdefghjk");
    const b = await recoveryCodeHash("abcdefghjm");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(await recoveryCodeHash("abcdefghjk")).toBe(a);
  });

  it("save as a plain file that says who they're for and how to use them", () => {
    const codes = ["k7m2p-q9tx4", "a2b3c-d4e5f"];
    const file = recoveryCodesFile(codes, "owner@jfeffect.com", new Date("2026-11-20T12:00:00Z"));
    expect(file).toContain("owner@jfeffect.com");
    expect(file).toContain("2026-11-20");
    for (const c of codes) expect(file).toContain(c);
    expect(file).toMatch(/Each works once/);
    expect(file).toMatch(/somewhere other than your phone/);
  });
});

describe("the one server call made before the code", () => {
  it("is using a recovery code, and nothing else", () => {
    expect([...MFA_EXEMPT_FNS]).toEqual(["redeemRecoveryCode"]);
    expect(mfaExemptFn("redeemRecoveryCode")).toBe(true);
    for (const n of ["makeRecoveryCodes", "resetTeammateTwoStep", "listTeam", "", null, undefined]) {
      expect(mfaExemptFn(n as any)).toBe(false);
    }
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain("if (!mfaExemptFn(serverFnMeta?.name))");
  });

  it("makes codes only for a session that has had its code, and resets a teammate only as the owner", () => {
    const fns = readFileSync("src/lib/mfa-recovery.functions.ts", "utf8");
    const make = fns.slice(fns.indexOf("export const makeRecoveryCodes"), fns.indexOf("export type RedeemResult"));
    expect(make).toContain("if (!hadItsCode(context))");
    expect(make).toContain('f.status === "verified"');
    const reset = fns.slice(fns.indexOf("export const resetTeammateTwoStep"));
    expect(reset).toContain('.eq("role", "admin")');
    expect(reset).toContain("if (!hadItsCode(context))");
    expect(reset).toContain("data.userId === context.userId");
    expect(reset).toContain('r.role !== "client"');
    // Using a code turns the old authenticator off only after the database says it's right.
    const redeem = fns.slice(fns.indexOf("export const redeemRecoveryCode"), fns.indexOf("export const resetTeammateTwoStep"));
    expect(redeem.indexOf('verdict !== "ok"')).toBeLessThan(redeem.indexOf("removeAuthenticators(db, context.userId)"));
  });
});

describe("the database half (20270424093000_staff_mfa_recovery.sql)", () => {
  const sql = readFileSync("supabase/migrations/20270424093000_staff_mfa_recovery.sql", "utf8");

  it("keeps codes and events away from every signed-in and anonymous user", () => {
    for (const t of ["staff_mfa_recovery_codes", "staff_mfa_events"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/);
    for (const fn of ["staff_mfa_recovery_replace(uuid, text[])", "staff_mfa_recovery_use(uuid, text)", "staff_mfa_reset_record(uuid, uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("counts wrong tries one at a time and waits after 5 in an hour", () => {
    const use = sql.slice(sql.indexOf("FUNCTION public.staff_mfa_recovery_use("));
    expect(use).toContain("pg_advisory_xact_lock");
    expect(use).toContain(">= 5 THEN");
    expect(use).toContain("RETURN 'wait'");
  });

  it("tells a person only how many they have left, and only their own", () => {
    const left = sql.slice(sql.indexOf("FUNCTION public.staff_mfa_recovery_left("), sql.indexOf("$function$;", sql.indexOf("FUNCTION public.staff_mfa_recovery_left(")));
    expect(left).toContain("user_id = auth.uid()");
    expect(left).toContain("count(*)");
  });
});
