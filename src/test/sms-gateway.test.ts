import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const pushSpy = vi.fn(async () => ({ sent: 1, removed: 0, skipped: null }));
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: pushSpy }));

import { sendSms, prepareSmsText, requireSent, smsResultMessage } from "@/lib/sms-gateway.server";
import {
  budgetLevel,
  bulkCostLine,
  fitOneSegment,
  kindForCategory,
  normalizePhone,
  redactSecrets,
  smartEncode,
  smsSegments,
} from "@/lib/sms-policy";

type Claim = Record<string, unknown> | null;

function fakeAdmin(claim: Claim, opts: { claimError?: string } = {}) {
  const rpcs: Array<[string, any]> = [];
  const updates: Array<{ table: string; patch: any; eq: [string, any][] }> = [];
  const admin = {
    rpc: async (name: string, args: any) => {
      rpcs.push([name, args]);
      if (name === "sms_claim") return opts.claimError ? { data: null, error: { message: opts.claimError } } : { data: claim, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      const eq: [string, any][] = [];
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => { eq.push([k, v]); return b; },
        update: (patch: any) => { const u = { table, patch, eq }; updates.push(u); return b; },
        then: (res: any) => Promise.resolve({ data: table === "user_roles" ? [{ user_id: "admin-1" }] : [], error: null }).then(res),
      };
      return b;
    },
  };
  return { admin, rpcs, updates };
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.LOVABLE_API_KEY = "test";
  process.env.TWILIO_API_KEY = "test";
  fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ sid: "SM1" }) }));
  vi.stubGlobal("fetch", fetchSpy);
  pushSpy.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const SEND = { decision: "send", id: "log-1", from: "+18145550100", crossed: null };

describe("sendSms: the one way a text goes out", () => {
  it("asks the database first, then sends exactly what it logged, SmartEncoded", async () => {
    const { admin, rpcs } = fakeAdmin(SEND);
    const r = await sendSms(admin, { category: "session", to: "(204) 555-1234", body: "It’s “today” — see you", key: "k1", clientId: "c1" });
    expect(r).toMatchObject({ status: "sent", sid: "SM1", id: "log-1", segments: 1 });
    const claim = rpcs.find(([n]) => n === "sms_claim")![1];
    expect(claim).toMatchObject({ _category: "session", _kind: "session", _to: "+12045551234", _key: "k1", _client_id: "c1", _segments: 1 });
    const form = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
    expect(form.get("To")).toBe("+12045551234");
    expect(form.get("From")).toBe("+18145550100");
    expect(form.get("Body")).toBe(`It's "today" - see you`);
    expect(form.get("SmartEncoded")).toBe("true");
    expect(rpcs.find(([n]) => n === "sms_finish")![1]).toMatchObject({ _id: "log-1", _sid: "SM1", _error: null });
  });

  it("never calls Twilio when the database says no (budget, duplicate, cap, switch, opt-out)", async () => {
    for (const reason of ["budget", "duplicate", "client_daily_cap", "sms_disabled", "opted_out", "hard_cap"]) {
      const { admin } = fakeAdmin({ decision: "blocked", reason, id: "log-x" });
      const r = await sendSms(admin, { category: "reminder", to: "2045551234", body: "hi" });
      expect(r).toMatchObject({ status: "skipped", reason });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed: if the guard can't answer, nothing is sent", async () => {
    const { admin } = fakeAdmin(null, { claimError: "function sms_claim does not exist" });
    const r = await sendSms(admin, { category: "session", to: "2045551234", body: "hi" });
    expect(r.status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records a Twilio refusal (not billed) and marks a STOPped person opted out", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: 21610, message: "Attempt to send to unsubscribed recipient" }) });
    const { admin, rpcs, updates } = fakeAdmin(SEND);
    const r = await sendSms(admin, { category: "reminder", to: "2045551234", body: "hi", clientId: "c1" });
    expect(r).toMatchObject({ status: "failed", code: 21610 });
    expect(rpcs.find(([n]) => n === "sms_finish")![1]).toMatchObject({ _id: "log-1", _sid: null, _error_code: 21610 });
    expect(updates).toContainEqual(expect.objectContaining({ table: "clients", patch: { sms_opt_out: true } }));
  });

  it("a network error is a failed send, never thrown at the caller", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("socket hang up"));
    const { admin } = fakeAdmin(SEND);
    const r = await sendSms(admin, { category: "session", to: "2045551234", body: "hi" });
    expect(r).toMatchObject({ status: "failed", error: "socket hang up" });
  });

  it("security texts keep sign-in links out of the log", async () => {
    const { admin, rpcs } = fakeAdmin(SEND);
    await sendSms(admin, { category: "security", to: "2045551234", body: "Tap to set up: https://jfeffect.com/setup?invite=abc.def" });
    const logged = rpcs.find(([n]) => n === "sms_claim")![1]._body;
    expect(logged).not.toContain("abc.def");
    expect(logged).toContain("[link]");
    // ...while the person still gets the real link.
    expect(new URLSearchParams(fetchSpy.mock.calls[0][1].body).get("Body")).toContain("invite=abc.def");
  });

  it("tells every admin once when a send crosses 80% / 100% of the budget", async () => {
    const { admin } = fakeAdmin({ ...SEND, crossed: 80 });
    await sendSms(admin, { category: "session", to: "2045551234", body: "hi" });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect((pushSpy.mock.calls[0] as any[])[3]).toMatchObject({ eventKey: expect.stringMatching(/^sms_budget:\d{4}-\d{2}:80$/) });
    pushSpy.mockClear();
    const { admin: a50 } = fakeAdmin({ ...SEND, crossed: 50 });
    await sendSms(a50, { category: "session", to: "2045551234", body: "hi" });
    expect(pushSpy).not.toHaveBeenCalled(); // 50% is a warning on the dashboard only
  });

  it("requireSent turns a stopped text into a readable error for the coach", () => {
    expect(() => requireSent({ status: "skipped", reason: "budget", segments: 1 })).toThrow("Monthly budget reached");
    expect(smsResultMessage({ status: "skipped", reason: "opted_out", segments: 1 })).toBe("Opted out of texts");
  });
});

describe("text shaping and money", () => {
  it("normalizes phones and refuses junk", () => {
    expect(normalizePhone("204-555-1234")).toBe("+12045551234");
    expect(normalizePhone("1 (204) 555-1234")).toBe("+12045551234");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("keeps texts in the cheap encoding", () => {
    expect(smartEncode("It’s “ok” — really…")).toBe(`It's "ok" - really...`);
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("💪" + "a".repeat(80))).toBeGreaterThan(1);
  });

  it("adds the slow-link heads-up only to app links", () => {
    expect(prepareSmsText("Open https://jfeffect.com/portal")).toContain("The link can take up to a minute to load.");
    expect(prepareSmsText("Join https://meet.google.com/abc")).not.toContain("minute to load");
    expect(prepareSmsText("Open https://jfeffect.com/portal", false)).not.toContain("minute to load");
  });

  it("redacts sign-in and reset links", () => {
    expect(redactSecrets("Reset: https://jfeffect.com/reset?rt=SECRET now")).toBe("Reset: [link] now");
    expect(redactSecrets("Calendar: jfeffect.com/portal/calendar")).toBe("Calendar: jfeffect.com/portal/calendar");
  });

  it("picks the friendliest wording that fits one segment", () => {
    const long = "x".repeat(170);
    expect(fitOneSegment([long, "short and sweet"])).toBe("short and sweet");
    expect(fitOneSegment([long, "y".repeat(165)])).toBe("y".repeat(165)); // nothing fits: the shortest
  });

  it("reads the budget the way the dashboard shows it", () => {
    expect(budgetLevel(2, 10).level).toBe("ok");
    expect(budgetLevel(5, 10).level).toBe("warn");
    expect(budgetLevel(8, 10).level).toBe("alert");
    expect(budgetLevel(10, 10).level).toBe("stopped");
    expect(budgetLevel(20, 10).level).toBe("hard_stop");
  });

  it("prices a bulk send before it goes", () => {
    expect(bulkCostLine(10, "Hi there", { price_per_segment_usd: 0.0161, usd_to_cad: 1.38 })).toBe("10 SMS segments billed, about $0.22 CAD.");
  });

  it("maps categories onto the log's kinds (the kind check allows each)", () => {
    const sql = readFileSync("supabase/migrations/20270314090000_sms_cost_guard.sql", "utf8");
    for (const c of ["security", "session", "manual", "test", "reminder", "payment", "automation", "staff_alert", "bulk"] as const) {
      expect(sql).toContain(`'${kindForCategory(c)}'`);
    }
  });
});

describe("database guard contract", () => {
  const sql = readFileSync("supabase/migrations/20270314090000_sms_cost_guard.sql", "utf8");

  it("serializes every claim and makes one key send once", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('public.sms_claim'))");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS sms_log_idempotency_key_uniq");
    expect(sql).toMatch(/idempotency_key = CASE WHEN _sid IS NOT NULL THEN idempotency_key END/);
  });

  it("stops nonessential texts at the budget, everything but security at 2x, and caps security per number", () => {
    expect(sql).toContain("v_essential boolean := _category IN ('security', 'session', 'manual', 'test')");
    expect(sql).toMatch(/v_spent \+ v_cost > v_budget \* 2 THEN\s+v_reason := 'hard_cap'/);
    expect(sql).toMatch(/NOT v_essential AND v_spent \+ v_cost > v_budget THEN\s+v_reason := 'budget'/);
    expect(sql).toContain("v_reason := 'security_daily_cap'");
  });

  it("only the server can claim or finish a send; the dashboard is admin-only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sms_claim\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sms_finish\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain("RAISE EXCEPTION 'Admin only'");
  });
});
