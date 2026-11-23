/**
 * A lost phone with two-step sign-in (mfa-recovery.functions.ts, mfa-rules.ts):
 * there are no recovery codes (Nov 23 2026), only another way on another
 * device, the same number on a new phone, or the owner's reset on Team.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFA_EXEMPT_FNS, mfaExemptFn } from "@/lib/mfa-rules";

describe("no recovery codes", () => {
  it("the app neither makes nor takes one", () => {
    expect(existsSync("src/lib/mfa-recovery.ts")).toBe(false);
    expect(existsSync("src/components/two-step/recovery-codes.tsx")).toBe(false);
    const fns = readFileSync("src/lib/mfa-recovery.functions.ts", "utf8");
    expect(fns).not.toContain("makeRecoveryCodes");
    expect(fns).not.toContain("redeemRecoveryCode");
    for (const f of [
      "src/components/two-step/staff-mfa-gate.tsx",
      "src/components/two-step/two-step-card.tsx",
      "src/lib/two-step.ts",
      "src/lib/two-step.server.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(
        /Use a recovery code|Save your recovery codes|recoveryLeft|RecoveryCodesPanel/,
      );
    }
  });

  it("the database keeps none and has nothing to make, use or count them", () => {
    const sql = readFileSync("supabase/migrations/20270513100000_no_recovery_codes.sql", "utf8");
    expect(sql).toContain("DELETE FROM public.staff_mfa_recovery_codes;");
    for (const fn of [
      "staff_mfa_recovery_replace(uuid, text[])",
      "staff_mfa_recovery_use(uuid, text)",
      "staff_mfa_recovery_left()",
    ]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${fn};`);
    }
    expect(sql).not.toMatch(/DROP[^;]*staff_mfa_reset_record/);
  });
});

describe("the server calls made before a session is confirmed", () => {
  it("are the ones that confirm it, nothing else", () => {
    expect([...MFA_EXEMPT_FNS].sort()).toEqual(
      [
        "confirmWithTrustedDevice",
        "finishTwoStepPasskey",
        "getTwoStepStatus",
        "sendTwoStepCode",
        "startTwoStepPasskey",
        "verifyTwoStepCode",
      ].sort(),
    );
    for (const n of [
      "redeemRecoveryCode",
      "makeRecoveryCodes",
      "resetTeammateTwoStep",
      "removeTwoStepMethod",
      "trustThisDevice",
      "listTeam",
      "",
      null,
      undefined,
    ]) {
      expect(mfaExemptFn(n as any)).toBe(false);
    }
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain("if (!mfaExemptFn(serverFnMeta?.name))");
  });

  it("resets a teammate only as the owner, from a confirmed session, never their own", () => {
    const fns = readFileSync("src/lib/mfa-recovery.functions.ts", "utf8");
    const reset = fns.slice(fns.indexOf("export const resetTeammateTwoStep"));
    expect(reset).toContain('.eq("role", "admin")');
    expect(reset).toContain("sessionConfirmed(db, context.userId");
    expect(reset).toContain("data.userId === context.userId");
    expect(reset).toContain('r.role !== "client"');
    expect(reset).toContain('"staff_mfa_reset_record"');
  });
});

describe("the database half (20270424093000_staff_mfa_recovery.sql)", () => {
  const sql = readFileSync("supabase/migrations/20270424093000_staff_mfa_recovery.sql", "utf8");

  it("keeps the record away from every signed-in and anonymous user", () => {
    for (const t of ["staff_mfa_recovery_codes", "staff_mfa_events"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.staff_mfa_reset_record(uuid, uuid) FROM PUBLIC, anon, authenticated;",
    );
  });
});
