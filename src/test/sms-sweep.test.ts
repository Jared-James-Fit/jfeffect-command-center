import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SmsRequest, SmsResult } from "@/lib/sms-gateway.server";

const SETTINGS = {
  enabled: true, from_phone: "+18145550100", brand_name: "Jared James Coaching", rate_limit_per_hour: 3,
  reminder_steps: [
    { delay_minutes: 1440, enabled: true, template: "Hi {first_name}, step one from {brand}." },
    { delay_minutes: 2880, enabled: true, template: "Hi {first_name}, step two from {brand}." },
  ],
};

type Msg = { id: string; client_id: string; created_at: string; is_automated?: boolean; message_type?: string | null };
const H = 3600_000;

function makeDb(opts: { messages: Msg[]; clients: Record<string, any>; smsLog?: any[]; settings?: any }) {
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
        in: () => b,
        order: () => b,
        limit: async () => {
          if (table === "messages") { state.messagesFilters = f; return { data: opts.messages, error: null }; }
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          if (table === "sms_settings") return { data: opts.settings ?? SETTINGS };
          if (table === "clients") return { data: opts.clients[f.find(([k]) => k === "id")![1]] ?? null };
          return { data: null };
        },
        insert: async (row: any) => { state.inserts.push({ table, row }); if (table === "sms_log") state.smsLog.push(row); return { error: null }; },
        then: (res: any) => {
          if (table === "sms_log" && head) {
            const cid = f.find(([k]) => k === "client_id")?.[1];
            const kind = f.find(([k]) => k === "kind")?.[1];
            const n = state.smsLog.filter((r) => r.client_id === cid && (!kind || r.kind === kind) && (r.status === "sent" || r.blocked_reason === "push_delivered")).length;
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

const CLIENT = (over: any = {}) => ({ id: "c1", user_id: "u1", phone: "2045551234", sms_opt_out: false, first_name: "Jarrett", full_name: "Jarrett S", timezone: "America/Winnipeg", ...over });
let sendSms: ReturnType<typeof vi.fn>;
let sendPush: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T15:30:00Z")); // 10:30 in Winnipeg: inside the window
  sendSms = vi.fn(async (_db: any, req: SmsRequest): Promise<SmsResult> => ({ status: "sent", sid: "SMx", id: `log-${req.key}`, segments: 1 }));
  sendPush = vi.fn(async () => ({ sent: 0, skipped: "no_subs" }));
});
afterEach(() => { vi.useRealTimers(); });

async function run(db: any) {
  const { runReminderSweep } = await import("@/lib/sms-unread-reminders.server");
  return runReminderSweep(db, { sendSms: sendSms as any, sendPush: sendPush as any });
}
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();

describe("unread-message nudge guard rails", () => {
  it("only looks back about 72 hours, never 30 days, and skips payment requests and deleted messages", async () => {
    const { db, state } = makeDb({ messages: [], clients: {} });
    await run(db);
    const f = Object.fromEntries(state.messagesFilters);
    expect(new Date(f.created_at).getTime()).toBe(Date.now() - 72 * H);
    expect(f.or).toBe("message_type.is.null,message_type.neq.Payment");
    expect(f.deleted_at).toBeNull();
  });

  it("nudges ONE time per client even with several unread messages, anchored on the oldest", async () => {
    const { db } = makeDb({
      messages: [
        { id: "m-new", client_id: "c1", created_at: ago(30) },
        { id: "m-old", client_id: "c1", created_at: ago(50) },
      ],
      clients: { c1: CLIENT() },
    });
    const res = await run(db);
    expect(res).toMatchObject({ processed: 1, texted: 1, pushed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][1]).toMatchObject({
      category: "reminder", messageId: "m-old", reminderStep: 0, clientId: "c1", key: "unread:m-old:0",
    });
  });

  it("pushes first: a delivered push means no text, and the step is recorded as done", async () => {
    sendPush.mockResolvedValueOnce({ sent: 1, skipped: null });
    const { db, state } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT() } });
    const res = await run(db);
    expect(res).toMatchObject({ processed: 1, pushed: 1, texted: 0 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendPush.mock.calls[0][1]).toBe("u1");
    expect(sendPush.mock.calls[0][3]).toMatchObject({ category: "messages", eventKey: "unread:m1:0" });
    const row = state.inserts.find((i) => i.table === "sms_log")!.row;
    expect(row).toMatchObject({ message_id: "m1", reminder_step: 0, status: "skipped", blocked_reason: "push_delivered" });
  });

  it("texts only for the coach's own words: an automated prompt the push can't reach is settled, not texted", async () => {
    const { db, state } = makeDb({
      messages: [{ id: "m1", client_id: "c1", created_at: ago(30), is_automated: true, message_type: "Check-In" }],
      clients: { c1: CLIENT() },
    });
    const res = await run(db);
    expect(res).toMatchObject({ processed: 0, texted: 0 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(state.inserts.find((i) => i.table === "sms_log")!.row).toMatchObject({ blocked_reason: "automated_no_push" });
  });

  it("does not nudge outside 9am-8pm client time (and retries on a later run)", async () => {
    vi.setSystemTime(new Date("2026-10-08T03:30:00Z")); // 10:30pm Winnipeg
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT() } });
    expect(await run(db)).toMatchObject({ processed: 0 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("holds a client to one nudge per 24 hours, push or text", async () => {
    const { db } = makeDb({
      messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }],
      clients: { c1: CLIENT() },
      smsLog: [{ client_id: "c1", kind: "reminder", status: "skipped", blocked_reason: "push_delivered", message_id: "older", reminder_step: 0 }],
    });
    expect(await run(db)).toMatchObject({ processed: 0 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("leaves opt-out and missing phones to the sender, which settles them", async () => {
    sendSms.mockResolvedValueOnce({ status: "skipped", reason: "opted_out", segments: 1 });
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT({ sms_opt_out: true }) } });
    expect(await run(db)).toMatchObject({ processed: 0, texted: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a message that is not yet 24 hours old", async () => {
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(5) }], clients: { c1: CLIENT() } });
    expect(await run(db)).toMatchObject({ processed: 0 });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("with texts switched off still pushes (free), and the sender settles the text", async () => {
    sendSms.mockResolvedValueOnce({ status: "skipped", reason: "sms_disabled", segments: 1 });
    const { db } = makeDb({ messages: [{ id: "m1", client_id: "c1", created_at: ago(30) }], clients: { c1: CLIENT() }, settings: { ...SETTINGS, enabled: false } });
    await run(db);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
