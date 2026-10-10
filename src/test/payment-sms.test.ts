import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildPaymentSmsBody, runPaymentSmsSweep } from "@/lib/payment-sms.server";

type Row = { o_purchase_id: string; o_client_id: string; o_first_name: string | null; o_phone: string | null; o_offer: string };

function fake(opts: {
  settings?: any;
  due?: Row[];
  claim?: boolean;
  sentLastHour?: number;
}) {
  const log: any[] = [];
  const rpcCalls: Array<[string, any]> = [];
  const client = {
    rpc: async (name: string, args?: any) => {
      rpcCalls.push([name, args]);
      if (name === "payment_sms_due") return { data: opts.due ?? [], error: null };
      if (name === "claim_payment_sms") return { data: opts.claim ?? true, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        maybeSingle: async () => ({ data: table === "sms_settings" ? opts.settings ?? null : null }),
        insert: async (row: any) => { log.push({ table, row }); return { error: null }; },
        then: (res: any) => Promise.resolve({ count: opts.sentLastHour ?? 0 }).then(res),
      };
      return b;
    },
  };
  return { client, log, rpcCalls };
}

const SETTINGS = { enabled: true, from_phone: "+18145550100", brand_name: "Jared James Coaching", rate_limit_per_hour: 3 };
const ROW: Row = { o_purchase_id: "p1", o_client_id: "c1", o_first_name: "Jarrett", o_phone: "2045551234", o_offer: "Online Coaching" };

const smsSenderImpl = async (_toPhone: string, _fromPhone: string, _body: string) => ({ sid: "SM123" });
let sendSms = vi.fn(smsSenderImpl);
const normalizePhone = (raw: string | null | undefined) => (raw ? "+1" + String(raw).replace(/\D/g, "") : null);

beforeEach(() => {
  sendSms = vi.fn(smsSenderImpl);
});

describe("payment setup SMS copy", () => {
  it("points at the app messages, never includes the payment link, and offers STOP", () => {
    const body = buildPaymentSmsBody({ firstName: "Jarrett", brand: "Jared James Coaching" });
    expect(body).toBe(
      "Hi Jarrett, it's Jared James Coaching. I sent you a message in the app about setting up your payment. Open your messages when you get a minute. Reply STOP to opt out.",
    );
    expect(body).not.toMatch(/https?:\/\//);
    expect(body.length).toBeLessThanOrEqual(200);
  });

  it("falls back gracefully when the name or brand is missing", () => {
    expect(buildPaymentSmsBody({})).toMatch(/^Hi there, it's your coach\./);
  });
});

describe("runPaymentSmsSweep", () => {
  it("sends one text per due sale, claims it first, and logs it", async () => {
    const f = fake({ settings: SETTINGS, due: [ROW] });
    const res = await runPaymentSmsSweep(f.client, { sendSms, normalizePhone });
    expect(res).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sendSms).toHaveBeenCalledWith("+12045551234", "+18145550100", expect.stringContaining("Hi Jarrett"));
    const order = f.rpcCalls.map(([n]) => n);
    expect(order.indexOf("claim_payment_sms")).toBeLessThan(order.length);
    expect(f.log[0].row).toMatchObject({
      client_id: "c1", kind: "automation", automation_trigger: "payment_setup_reminder", status: "sent", twilio_sid: "SM123",
    });
  });

  it("does nothing when SMS is disabled or has no from number", async () => {
    const off = fake({ settings: { ...SETTINGS, enabled: false }, due: [ROW] });
    expect(await runPaymentSmsSweep(off.client, { sendSms, normalizePhone })).toMatchObject({ sent: 0 });
    const noFrom = fake({ settings: { ...SETTINGS, from_phone: null }, due: [ROW] });
    expect(await runPaymentSmsSweep(noFrom.client, { sendSms, normalizePhone })).toMatchObject({ sent: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("never texts when another run already claimed the sale", async () => {
    const f = fake({ settings: SETTINGS, due: [ROW], claim: false });
    const res = await runPaymentSmsSweep(f.client, { sendSms, normalizePhone });
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("gives the sale its slot back when Twilio fails, and logs the failure", async () => {
    sendSms.mockRejectedValueOnce(new Error("Twilio 400"));
    const f = fake({ settings: SETTINGS, due: [ROW] });
    const res = await runPaymentSmsSweep(f.client, { sendSms, normalizePhone });
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(f.rpcCalls.some(([n, a]) => n === "release_payment_sms" && a.p_purchase_id === "p1")).toBe(true);
    expect(f.log[0].row).toMatchObject({ status: "failed", error: "Twilio 400" });
  });

  it("skips a client with no usable phone and respects the hourly cap", async () => {
    const noPhone = fake({ settings: SETTINGS, due: [{ ...ROW, o_phone: null }] });
    expect(await runPaymentSmsSweep(noPhone.client, { sendSms, normalizePhone })).toMatchObject({ skipped: 1, sent: 0 });
    const capped = fake({ settings: SETTINGS, due: [ROW], sentLastHour: 3 });
    expect(await runPaymentSmsSweep(capped.client, { sendSms, normalizePhone })).toMatchObject({ skipped: 1, sent: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("wiring contracts", () => {
  const sweepSrc = readFileSync("src/lib/sms.functions.ts", "utf8");
  const hookSrc = readFileSync("src/routes/api/public/hooks/payment-reminder-sms.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261007120000_payment_setup_reminders.sql", "utf8");

  it("the generic unread-message text skips payment messages (they have their own timed text)", () => {
    expect(sweepSrc).toContain('.or("message_type.is.null,message_type.neq.Payment")');
  });

  it("the hook rejects requests without the vault-held secret", () => {
    expect(hookSrc).toContain('rpc("payment_reminder_hook_secret")');
    expect(hookSrc).toContain("timingSafeEqualStr(provided, expected)");
    expect(hookSrc).toContain("status: 401");
  });

  it("the migration never contains a literal secret and keeps the sends in the lunch/after-work windows", () => {
    expect(sql).not.toMatch(/x-reminder-secret['"]\s*,\s*'[0-9a-f]{20,}/i);
    expect(sql).toContain("v_minute >= 690 and v_minute < 810");
    expect(sql).toContain("v_minute >= 1050 and v_minute < 1170");
    expect(sql).toContain("max_reminders constant integer := 3");
  });
});
