import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FREE_ACCESS_KEYS,
  accessForShell,
  creditStateForShell,
  digitalPaidAllowed,
  isNativeAppRequest,
  planOpenToFree,
  shellRefusesCreditSpend,
} from "@/lib/native-purchases";

// App Store 3.1.1, option B (docs/APPLE_IAP_DECISION.md): in the iPhone app nothing digital bought
// outside the app is unlocked. Self-serve members get the free experience; coaching clients
// (person-to-person, 3.1.3(d)/(e)) and staff keep everything; the web is unchanged.

const req = vi.hoisted(() => ({ headers: null as Headers | null }));
const db = vi.hoisted(() => ({
  roles: [] as Array<{ role: string }>,
  client: null as { service_tier: string } | null,
  state: null as any,
  useReply: null as any,
  calls: [] as string[],
  settled: [] as any[],
}));

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => (req.headers ? { headers: req.headers } : undefined) }));
vi.mock("@/lib/ai/model-client.server", () => ({ estimateCost: () => 0 }));
vi.mock("@/lib/ai-consent/consent.server", () => ({ requireOwnAiConsent: async () => {} }));
vi.mock("@/integrations/supabase/client.server", () => {
  const from = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: table === "clients" ? db.client : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "user_roles" ? db.roles : [], error: null }).then(res, rej),
    };
    return b;
  };
  const rpc = async (name: string, args: any) => {
    db.calls.push(name);
    if (name === "ai_credit_state") return { data: db.state, error: null };
    if (name === "ai_credits_use") return { data: db.useReply, error: null };
    if (name === "ai_credits_settle") {
      db.settled.push(args);
      return { data: db.state, error: null };
    }
    return { data: null, error: null };
  };
  return { supabaseAdmin: { from, rpc } };
});

const { digitalPaidAllowedFor, nativeAppRequest } = await import("@/lib/native-purchases.server");
const { spendAiCredits, withAiCredits } = await import("@/lib/ai-credits/meter.server");

const WEB_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const APP_UA = `${WEB_UA} JFEffectApp/1900`;
const web = () => (req.headers = new Headers({ "user-agent": WEB_UA }));
const app = () => (req.headers = new Headers({ "user-agent": APP_UA }));
const selfServe = () => {
  db.roles = [{ role: "member" }];
  db.client = { service_tier: "self_serve" };
};
const coaching = () => {
  db.roles = [{ role: "client" }];
  db.client = { service_tier: "coaching" };
};

const credits = (o: Partial<Record<string, any>> = {}) => ({
  tier: "member",
  unlimited: false,
  allowance: 30,
  used: 30,
  allowance_left: 0,
  extra: 300,
  left: 300,
  period_start: "2026-11-01",
  resets_on: "2026-12-01",
  costs: { meal_estimate: 1, program_import: 10 },
  ...o,
});

beforeEach(() => {
  req.headers = null;
  db.roles = [];
  db.client = null;
  db.state = null;
  db.useReply = null;
  db.calls = [];
  db.settled = [];
});

describe("option B: the rule", () => {
  it("knows a request from the app by its user-agent stamp or its header", () => {
    expect(isNativeAppRequest({ userAgent: APP_UA })).toBe(true);
    expect(isNativeAppRequest({ userAgent: WEB_UA, nativeHeader: "1" })).toBe(true);
    expect(isNativeAppRequest({ userAgent: WEB_UA })).toBe(false);
    expect(isNativeAppRequest({})).toBe(false);
  });

  it("paid digital features: always on the web; in the app only for coaching clients and staff", () => {
    for (const tier of ["coaching", "self_serve", null] as const) {
      expect(digitalPaidAllowed({ native: false, staff: false, tier })).toBe(true);
      expect(digitalPaidAllowed({ native: true, staff: true, tier })).toBe(true);
    }
    expect(digitalPaidAllowed({ native: true, staff: false, tier: "coaching" })).toBe(true);
    expect(digitalPaidAllowed({ native: true, staff: false, tier: "self_serve" })).toBe(false);
    // not known yet: the free experience, so a paid row never flashes
    expect(digitalPaidAllowed({ native: true, staff: false, tier: null })).toBe(false);
  });

  it("a member's access in the app is the free account's keys, whatever else they hold", () => {
    const rows = [...FREE_ACCESS_KEYS, "jf_premium", "premium_member", "powerlifting_plans"].map((k) => ({ access_level_key: k }));
    expect(accessForShell(rows, true)).toHaveLength(rows.length);
    expect(accessForShell(rows, false).map((r) => r.access_level_key)).toEqual([...FREE_ACCESS_KEYS]);
  });

  it("a library plan is open to a free account only by a free key or to every active member", () => {
    expect(planOpenToFree({ required_access_level: "app_membership", audience_mode: "access_level" })).toBe(true);
    expect(planOpenToFree({ required_access_level: null })).toBe(true);
    expect(planOpenToFree({ required_access_level: "powerlifting_plans", audience_mode: "all_active" })).toBe(true);
    expect(planOpenToFree({ required_access_level: "powerlifting_plans", audience_mode: "access_level" })).toBe(false);
    expect(planOpenToFree({ required_access_level: "jf_premium" })).toBe(false);
  });

  it("credits in the app are the month's free ones only, with nothing about buying", () => {
    const s = { ...credits({ allowance_left: 12, left: 312 }), history: [{ kind: "purchase" }], purchases: [{}] };
    expect(creditStateForShell(s, true)).toBe(s);
    const shown = creditStateForShell(s, false);
    expect(shown).toMatchObject({ extra: 0, left: 12, allowance_left: 12, history: [], purchases: [] });
    expect(creditStateForShell(credits({ unlimited: true }), false)).toMatchObject({ extra: 300 });
    expect(creditStateForShell(null, false)).toBeNull();
    expect(shellRefusesCreditSpend(credits({ allowance_left: 0 }), 1, false)).toBe(true);
    expect(shellRefusesCreditSpend(credits({ allowance_left: 5 }), 10, false)).toBe(true);
    expect(shellRefusesCreditSpend(credits({ allowance_left: 10 }), 10, false)).toBe(false);
    expect(shellRefusesCreditSpend(credits({ allowance_left: 0 }), 1, true)).toBe(false);
  });
});

describe("option B on the server", () => {
  it("no request (a job, a webhook) and web requests are unchanged", async () => {
    selfServe();
    expect(nativeAppRequest()).toBe(false);
    expect(await digitalPaidAllowedFor("u1")).toBe(true);
    web();
    expect(nativeAppRequest()).toBe(false);
    expect(await digitalPaidAllowedFor("u1")).toBe(true);
  });

  it("from the app: a self-serve member (free or paid on the web) is refused, coaching and staff aren't", async () => {
    app();
    selfServe();
    expect(await digitalPaidAllowedFor("u1")).toBe(false);
    coaching();
    expect(await digitalPaidAllowedFor("u1")).toBe(true);
    db.roles = [{ role: "coach" }];
    db.client = null;
    expect(await digitalPaidAllowedFor("u1")).toBe(true);
    db.roles = [];
    db.client = null;
    expect(await digitalPaidAllowedFor("u1")).toBe(false);
    // builds before the user-agent stamp: the header the app's code adds
    req.headers = new Headers({ "user-agent": WEB_UA, "x-jf-native-app": "1" });
    selfServe();
    expect(await digitalPaidAllowedFor("u1")).toBe(false);
  });

  it("a member in the app can't spend bought credits: refused when the free ones are gone, nothing taken", async () => {
    app();
    selfServe();
    db.state = credits({ allowance_left: 0, extra: 300, left: 300 });
    const r = await spendAiCredits("u1", "meal_estimate", null);
    expect(r.data).toMatchObject({ ok: false, reason: "out_of_credits", state: { extra: 0, left: 0 } });
    expect(db.calls).not.toContain("ai_credits_use");
  });

  it("the same member on the web spends them as before", async () => {
    web();
    selfServe();
    db.useReply = { ok: true, use_id: "use1", state: credits({ extra: 299, left: 299 }) };
    const r = await spendAiCredits("u1", "meal_estimate", null);
    expect(r.data).toMatchObject({ ok: true, use_id: "use1", state: { extra: 299 } });
  });

  it("a member in the app spends free credits, and the reply shows only those", async () => {
    app();
    selfServe();
    db.state = credits({ allowance_left: 5, extra: 300, left: 305 });
    db.useReply = { ok: true, use_id: "use1", state: credits({ allowance_left: 4, extra: 300, left: 304 }) };
    const r = await spendAiCredits("u1", "meal_estimate", null);
    expect(r.data).toMatchObject({ ok: true, use_id: "use1", state: { extra: 0, left: 4 } });
    expect(db.settled).toEqual([]);
  });

  it("a use that dipped into bought credits anyway (two at once) is given back and refused", async () => {
    app();
    selfServe();
    db.state = credits({ allowance_left: 1, extra: 300, left: 301 });
    db.useReply = { ok: true, use_id: "use1", state: credits({ allowance_left: 0, extra: 299, left: 299 }) };
    const r = await spendAiCredits("u1", "meal_estimate", null);
    expect(r.data).toMatchObject({ ok: false, reason: "out_of_credits" });
    expect(db.settled).toEqual([expect.objectContaining({ _use_id: "use1", _ok: false })]);
  });

  it("a coaching client in the app keeps every credit they have", async () => {
    app();
    coaching();
    db.useReply = { ok: true, use_id: "use1", state: credits({ tier: "coaching", allowance_left: 0, extra: 99, left: 99 }) };
    const r = await withAiCredits("u1", "meal_estimate", async () => ({ value: 42 }));
    expect(r).toMatchObject({ ok: true, value: 42 });
    expect(db.calls).toContain("ai_credits_use");
  });

  it("a member in the app out of free credits never reaches the model", async () => {
    app();
    selfServe();
    db.state = credits({ allowance_left: 0 });
    const run = vi.fn(async () => ({ value: 1 }));
    const r = await withAiCredits("u1", "meal_estimate", run);
    expect(r).toMatchObject({ ok: false, reason: "out_of_credits", credits: { extra: 0, left: 0 } });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("option B is enforced where paid digital features are served", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("Premium, member access keys, library plans and credit reads ask the one rule", () => {
    expect(read("src/lib/premium/premium.functions.ts").match(/premiumAllowedHere\(userId\)/g)).toHaveLength(2);
    expect(read("src/components/premium/premium-ui.tsx")).toContain("useDigitalPaidAllowed()");
    expect(read("src/lib/members.functions.ts")).toContain("accessForShell(");
    expect(read("src/lib/membership-library.functions.ts").match(/keysHere\(userId, access\)/g)).toHaveLength(2);
    expect(read("src/lib/member-plan-start.functions.ts")).toContain("planOpenToFree(p)");
    expect(read("src/lib/ai-credits.functions.ts")).toContain("creditStateForShell(");
    expect(read("src/start.ts")).toContain("nativeAppMark");
  });

  it("every AI credit spend goes through spendAiCredits (no direct ai_credits_use)", () => {
    for (const p of ["src/lib/program-import/import.functions.ts", "src/lib/nutrition-import/import.functions.ts"]) {
      const s = read(p);
      expect(s, p).not.toMatch(/rpc\("ai_credits_use"/);
      expect(s, p).toContain("spendAiCredits(");
    }
  });
});
