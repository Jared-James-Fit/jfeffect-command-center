import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.LOVABLE_API_KEY = "test";
process.env.TWILIO_API_KEY = "test";

const SETTINGS = {
  enabled: true, from_phone: "+18145550100", brand_name: "Jared James Coaching", rate_limit_per_hour: 3,
  reminder_steps: [
    { delay_minutes: 1440, enabled: true, template: "Hi {first_name}, step one from {brand}." },
    { delay_minutes: 2880, enabled: true, template: "Hi {first_name}, step two from {brand}." },
  ],
};

type Msg = { id: string; client_id: string; created_at: string };
const H = 3600_000;

function makeDb(opts: { messages: Msg[]; clients: Record<string, any>; smsLog?: any[] }) {
  const state = { messagesFilters: [] as Array<[string, any]>, inserts: [] as any[], smsLog: [...(opts.smsLog ?? [])] };
  const db = {
    from(table: string) {
      const f: Array<[string, any]> = [];
      let head = false;
      const b: any = {
        select: (_c?: string, o?: any) => { head = !!o?.head; return b; },
        eq: (k: string, v: any) => { f.push([k, v]); return b; },
        is: (k: string, v: any) => { f.push([k, v]); return b; },
        or: (v: string) => { f.push(["or", v]); return b; },
        gte: (k: string, v: any) => { f.push([k, v]); return b; },
        order: () => b,
        limit: async () => {
          if (table === "messages") { state.messagesFilters = f; return { data: opts.messages, error: null }; }
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          if (table === "sms_settings") return { data: SETTINGS };
          if (table === "clients") return { data: opts.clients[f.find(([k]) => k === "id")![1]] ?? null };
          return { data: null };
        },
        insert: async (row: any) => { state.inserts.push({ table, row }); if (table === "sms_log") state.smsLog.push(row); return { error: null }; },
        then: (res: any) => {
          if (table === "sms_log" && head) {
            const cid = f.find(([k]) => k === "client_id")?.[1];
            const status = f.find(([k]) => k === "status")?.[1];
            const kind = f.find(([k]) => k === "kind")?.[1];
            const n = state.smsLog.filter((r) => r.client_id === cid && (!status || r.status === status) && (!kind || r.kind === kind)).length;
            return Promise.resolve({ count: n }).then(res);
          }
          if (table === "sms_log") {
            const mid = f.find(([k]) => k === "message_id")?.[1];
            return Promise.resolve({ data: state.smsLog.filter((r) => r.message_id === mid) }).then(res);
          }
          return Promise.resolve({ data: [] }).then(res);
        },
      };
      return b;
    },
  };
  return { db, state };
}

const CLIENT = (over: any = {}) => ({ id: "c1", phone: "2045551234", sms_opt_out: false, first_name: "Jarrett", full_name: "Jarrett S", timezone: "America/Winnipeg", ...over });
let twilio: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T15:30:00Z")); // 10:30 in Winnipeg: inside the window
  twilio = vi.fn(async () => ({ ok: true, json: async () => ({ sid: "SMx" }) }));
  vi.stubGlobal("fetch", twilio);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function run(db: any) {
  const { runReminderSweep } = await import("@/lib/sms.functions");
  return runReminderSweep(db);
}
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();

describe("runReminderSweep guard rails", () => {
  it("only looks back about 72 hours, never 30 days, and skips payment requests and deleted messages", async () => {
    const { db, state } = makeDb({ messages: [], clients: {} });
    await run(db);
    const f = Object.fromEntries(state.messagesFilters);
    expect(new Date(f.created_at).getTime()).toBe(Date.now() - 72 * H);
    expect(f.or).toBe("message_type.is.null,message_type.neq.Payment");
    expect(f.deleted_at).toBeNull();
  });

  it("sends ONE text per client even with several unread messages, anchored on the oldest", async () => {
    const { db, state } = makeDb({
      messages: [
        { id: "m-new", client_id: "c1", created_at: ago(30) },
        { id: "m-old", client_id: "c1", created_at: ago(50) },
      ],
      clients: { c1: CLIENT() },
    });
    const res = await run(db);
    expect(res).toEqual({ processed: 1 });
    expect(twilio).toHaveBeenCalledTimes(1);
    const sent = state.inserts.find((i) => i.table === "sms_log")!.row;
    expect(sent).toMatchObject({ message_id: "m-old", status: "sent", kind: "reminder", reminder_step: 0 });
  });

  it("does not text outside 9am-8pm client time (and retries on a later run)", async () => {
    vi.setSystemTime(new Date("2026-10-08T03:30:00Z")); // 10:30pm Winnipeg
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT() } });
    expect(await run(db)).toEqual({ processed: 0 });
    expect(twilio).not.toHaveBeenCalled();
  });

  it("holds a client to one reminder text per 24 hours", async () => {
    const { db } = makeDb({
      messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }],
      clients: { c1: CLIENT() },
      smsLog: [{ client_id: "c1", kind: "reminder", status: "sent", message_id: "older", reminder_step: 0 }],
    });
    expect(await run(db)).toEqual({ processed: 0 });
    expect(twilio).not.toHaveBeenCalled();
  });

  it("respects opt-out and missing phone, logging them as skipped", async () => {
    const optOut = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT({ sms_opt_out: true }) } });
    expect(await run(optOut.db)).toEqual({ processed: 0 });
    expect(optOut.state.inserts[0].row).toMatchObject({ status: "skipped", error: "client_opted_out" });
    const noPhone = makeDb({ messages: [{ id: "m2", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT({ phone: "" }) } });
    expect(await run(noPhone.db)).toEqual({ processed: 0 });
    expect(noPhone.state.inserts[0].row).toMatchObject({ status: "skipped", error: "no_phone" });
    expect(twilio).not.toHaveBeenCalled();
  });

  it("does nothing for a message that is not yet 24 hours old", async () => {
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(5) }], clients: { c1: CLIENT() } });
    expect(await run(db)).toEqual({ processed: 0 });
  });
});
