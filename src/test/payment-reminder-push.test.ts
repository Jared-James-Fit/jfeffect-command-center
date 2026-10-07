import { describe, it, expect, vi } from "vitest";
import { pushNewPaymentReminders } from "@/lib/payment-reminder-push.server";

function fakeAdmin(msgs: any[], opts: { clientUserId?: string | null; coachName?: string | null } = {}) {
  const calls: Array<{ table: string; filters: Array<[string, any]> }> = [];
  const admin = {
    from: (table: string) => {
      const ctx = { table, filters: [] as Array<[string, any]> };
      calls.push(ctx);
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => { ctx.filters.push([k, v]); return b; },
        is: (k: string, v: any) => { ctx.filters.push([k, v]); return b; },
        gte: (k: string, v: any) => { ctx.filters.push([k, v]); return b; },
        limit: async () => ({ data: msgs }),
        maybeSingle: async () => {
          if (table === "clients") return { data: opts.clientUserId === undefined ? { user_id: "client-user" } : opts.clientUserId ? { user_id: opts.clientUserId } : null };
          if (table === "coaches") return { data: opts.coachName ? { full_name: opts.coachName } : null };
          return { data: null };
        },
      };
      return b;
    },
  };
  return { admin, calls };
}

const MSG = {
  id: "m1", client_id: "c1", sender_id: "coach-user",
  attachments: [{ kind: "payment_request", purchase_id: "p1", payment_url: "https://jfeffect.com/pay/AbCde234Wxyz" }],
};

describe("pushNewPaymentReminders", () => {
  it("pushes each automated payment reminder with lockscreen-safe copy", async () => {
    const { admin } = fakeAdmin([MSG], { coachName: "Jared James" });
    const send = vi.fn(async () => ({ sent: 1, removed: 0, skipped: null }));
    const res = await pushNewPaymentReminders(admin, { sendWebPushToUser: send });

    expect(res).toEqual({ pushed: 1, skipped: 0 });
    const [, userId, payload, options] = send.mock.calls[0];
    expect(userId).toBe("client-user");
    expect(payload.title).toBe("Coach Jared");
    expect(payload.body).toBe("Sent you a payment request.");
    // Never the message text or the link.
    expect(JSON.stringify(payload)).not.toMatch(/jfeffect\.com\/pay|Quick reminder|AbCde234Wxyz/);
    // Same dedupe key shape as a normal message push, so re-scans never double notify.
    expect(options.eventKey).toBe("message:m1:client-user");
    expect(options.category).toBe("messages");
  });

  it("only looks at recent automated Payment messages from staff", async () => {
    const { admin, calls } = fakeAdmin([]);
    const now = Date.parse("2026-10-07T18:00:00Z");
    await pushNewPaymentReminders(admin, { sendWebPushToUser: vi.fn() as any }, now);
    const q = calls.find((c) => c.table === "messages")!;
    expect(q.filters).toEqual(expect.arrayContaining([
      ["is_automated", true], ["message_type", "Payment"], ["sender_role", "admin"],
      ["is_internal_note", false], ["deleted_at", null],
      ["created_at", "2026-10-07T16:00:00.000Z"],
    ]));
  });

  it("counts already-notified reminders as skipped and skips clients without an app login", async () => {
    const dup = fakeAdmin([MSG]);
    const sendDup = vi.fn(async () => ({ sent: 0, removed: 0, skipped: "duplicate" }));
    expect(await pushNewPaymentReminders(dup.admin, { sendWebPushToUser: sendDup })).toEqual({ pushed: 0, skipped: 1 });

    const noLogin = fakeAdmin([MSG], { clientUserId: null });
    const send = vi.fn();
    expect(await pushNewPaymentReminders(noLogin.admin, { sendWebPushToUser: send as any })).toEqual({ pushed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });
});
