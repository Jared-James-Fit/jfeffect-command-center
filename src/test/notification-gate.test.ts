import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireAutomationTrigger } from "@/lib/sms-trigger.server";

/**
 * Builds an in-memory supabaseAdmin mock that lets each test set:
 *  - notification mode + allowlist
 *  - app_members row for the target memberId
 * Tracks every insert so assertions can verify which sms_log/jf_notification_attempts rows were written.
 */
function buildSupabase(opts: {
  mode: "dry_run" | "allowlist" | "live";
  allowlistPhones?: string[];
  memberPhone?: string | null;
  optOut?: boolean;
}) {
  const inserts: Array<{ table: string; row: any }> = [];
  const safetyValue = {
    mode: opts.mode,
    allowlist_phones: opts.allowlistPhones ?? [],
    allowlist_emails: [],
  };

  const sb: any = {
    from(table: string) {
      const builder: any = {
        _table: table,
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => {
          if (table === "sms_settings") return { data: { singleton: true, enabled: true, from_phone: "+15550000000", brand_name: "JFE" }, error: null };
          if (table === "app_settings") return { data: { value: safetyValue }, error: null };
          if (table === "app_members") return { data: { id: "mem-1", full_name: "Test Member", email: "test@example.com", phone: opts.memberPhone ?? null, sms_opt_out: !!opts.optOut }, error: null };
          return { data: null, error: null };
        },
        insert(row: any) {
          inserts.push({ table, row });
          return {
            select() {
              return { maybeSingle: async () => ({ data: { id: `${table}-row-id` }, error: null }) };
            },
          };
        },
      };
      if (table === "sms_automations") {
        // .eq().eq() chain ending in awaitable
        return {
          select() { return this; },
          eq() { return this; },
          then(res: any) { res({ data: [{ id: "auto-1", body: "Hi {first_name}, your subscription update." }], error: null }); return Promise.resolve({ data: [{ id: "auto-1", body: "Hi {first_name}, your subscription update." }], error: null }); },
        } as any;
      }
      return builder;
    },
  };
  return { sb, inserts };
}

const TRIGGERS = [
  "subscription_purchased",
  "subscription_payment_failed",
  "subscription_payment_recovered",
  "subscription_cancelled",
  "subscription_ended",
  "subscription_restarted",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Membership notification safety gate", () => {
  for (const trigger of TRIGGERS) {
    it(`dry_run never calls Twilio for ${trigger}`, async () => {
      const { sb, inserts } = buildSupabase({ mode: "dry_run", memberPhone: "+15551234567" });
      const out = await fireAutomationTrigger(sb, { trigger, memberId: "mem-1" });
      expect(out.fired ?? 0).toBe(0);
      // sms_log entry recorded as skipped/dry_run_mode
      const log = inserts.find((i) => i.table === "sms_log");
      expect(log?.row?.status).toBe("skipped");
      expect(log?.row?.error).toBe("dry_run_mode");
      // jf_notification_attempts entry recorded with decision=dry_run
      const attempt = inserts.find((i) => i.table === "jf_notification_attempts");
      expect(attempt?.row?.decision).toBe("dry_run");
      expect(attempt?.row?.reason).toBe("safety_mode_dry_run");
    });
  }

  it("allowlist permits an approved phone (would attempt real send in production)", async () => {
    const { sb, inserts } = buildSupabase({
      mode: "allowlist",
      memberPhone: "+15551234567",
      allowlistPhones: ["+15551234567"],
    });
    // Twilio will try to fetch; ensure the network guard catches it (= no real send)
    await fireAutomationTrigger(sb, { trigger: "subscription_purchased", memberId: "mem-1" });
    // The send threw because fetch is blocked → attempt is recorded as failed (not "sent").
    const attempt = inserts.find((i) => i.table === "jf_notification_attempts");
    expect(["failed", "sent"]).toContain(attempt?.row?.decision);
    // Critically: the gate let it through to the send path (it was NOT suppressed).
    expect(attempt?.row?.decision).not.toBe("suppressed");
    expect(attempt?.row?.decision).not.toBe("dry_run");
  });

  it("allowlist suppresses a non-approved phone and records reason", async () => {
    const { sb, inserts } = buildSupabase({
      mode: "allowlist",
      memberPhone: "+15559999999",
      allowlistPhones: ["+15551234567"],
    });
    await fireAutomationTrigger(sb, { trigger: "subscription_purchased", memberId: "mem-1" });
    const attempt = inserts.find((i) => i.table === "jf_notification_attempts");
    expect(attempt?.row?.decision).toBe("suppressed");
    expect(attempt?.row?.reason).toBe("not_on_allowlist");
    // sms_log skipped with the same reason
    const log = inserts.find((i) => i.table === "sms_log");
    expect(log?.row?.status).toBe("skipped");
    expect(log?.row?.error).toBe("not_on_allowlist");
  });

  it("live mode requires explicit configuration; still records every attempt", async () => {
    const { sb, inserts } = buildSupabase({
      mode: "live",
      memberPhone: "+15551234567",
    });
    await fireAutomationTrigger(sb, { trigger: "subscription_cancelled", memberId: "mem-1" });
    const attempt = inserts.find((i) => i.table === "jf_notification_attempts");
    // Send is blocked by the test network guard → attempt recorded as failed.
    expect(["failed", "sent"]).toContain(attempt?.row?.decision);
    // Live mode does not allow dry_run / suppressed shortcuts when the recipient is valid.
    expect(attempt?.row?.decision).not.toBe("dry_run");
    expect(attempt?.row?.decision).not.toBe("suppressed");
  });

  it("opted-out member never sends regardless of mode", async () => {
    const { sb, inserts } = buildSupabase({ mode: "live", memberPhone: "+15551234567", optOut: true });
    await fireAutomationTrigger(sb, { trigger: "subscription_purchased", memberId: "mem-1" });
    const log = inserts.find((i) => i.table === "sms_log");
    expect(log?.row?.status).toBe("skipped");
    expect(log?.row?.error).toBe("opted_out");
  });

  it("non-membership triggers (e.g. account_created) bypass the gate entirely", async () => {
    const { sb, inserts } = buildSupabase({ mode: "dry_run", memberPhone: "+15551234567" });
    await fireAutomationTrigger(sb, { trigger: "account_created", memberId: "mem-1" });
    // No jf_notification_attempts row — only membership triggers populate that audit table.
    const attempt = inserts.find((i) => i.table === "jf_notification_attempts");
    expect(attempt).toBeUndefined();
  });
});