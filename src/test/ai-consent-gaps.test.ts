/**
 * Nov 25 2026: the AI paths merged after the consent check (Support Cleo, Autopilot Re-create) and every other
 * server path that sends a person's data to a model ask first (src/lib/ai-consent). Refused, or unreadable:
 * no model is called.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ asked: 0, allowUser: true, allowClient: true }));
vi.mock("@/lib/ai/route-call.server", () => ({
  askRoute: async () => {
    h.asked++;
    return { text: JSON.stringify({ answer: "Open Settings.", escalate: false, confident: true, category: "unsure", summary: "", tried: "", next_action: "" }), model: "m", usage: { input: 1, output: 1 } };
  },
}));
vi.mock("@/lib/coach-voice.functions", () => ({ voicePromptForClient: async () => "" }));
vi.mock("@/lib/push/app-events.server", () => ({ notifyAppEvent: async () => undefined }));
vi.mock("@/lib/ai-consent/consent.server", () => {
  class AiConsentError extends Error {
    readonly aiConsent = true;
  }
  return {
    AiConsentError,
    userAllowsAi: async () => h.allowUser,
    clientAllowsAi: async () => ({ ok: h.allowClient, name: "Sam" }),
    requireClientAiConsent: async () => {
      if (!h.allowClient) throw new AiConsentError("no");
    },
  };
});

import { runCleoSupportTurn } from "@/lib/support-cleo/cleo-support.server";
import { recreateReply } from "@/lib/autopilot/reply.server";

type Row = Record<string, any>;
/** A tiny in-memory database: select/eq/neq/order/limit/insert/update on named tables. */
function fakeDb(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; op: string; row: Row }> = [];
  const from = (table: string) => {
    let rows = tables[table] ?? (tables[table] = []);
    let op = "select";
    let patch: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of hit) (Object.assign(r, patch), log.push({ table, op, row: patch }));
      return hit;
    };
    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      insert: (r: Row) => {
        rows.push(r);
        log.push({ table, op: "insert", row: r });
        return { select: () => ({ single: async () => ({ data: r, error: null }) }), then: (f: any) => f({ error: null }) };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (f: any, g: any) => Promise.resolve({ data: run(), error: null }).then(f, g),
    };
    return b;
  };
  return { from, tables, log };
}

beforeEach(() => {
  h.asked = 0;
  h.allowUser = true;
  h.allowClient = true;
});

describe("Support Cleo asks before the model reads a member's message", () => {
  const db = () =>
    fakeDb({
      member_support_threads: [{ id: "t1", member_id: "m1", client_id: null, handler: "cleo", status: "open", cleo_turns: 0, unread_for_team: 0 }],
      member_support_messages: [{ thread_id: "t1", sender_role: "member", body: "How do I change units?", created_at: "2026-11-25T10:00:00Z" }],
      app_members: [{ id: "m1", user_id: "u1" }],
    });

  it("no consent: no AI call, the chat goes to the team with a plain note the member can read", async () => {
    h.allowUser = false;
    const d = db();
    const r = await runCleoSupportTurn(d, "t1", "u1");
    expect(r.outcome).toBe("escalated");
    expect(h.asked).toBe(0);
    expect(d.tables.member_support_threads[0]).toMatchObject({ handler: "human" });
    expect(d.tables.member_support_threads[0].escalation.category).toBe("no_ai_consent");
    const note = d.tables.member_support_messages.at(-1)!;
    expect(note.body).toMatch(/a person on the JF Effect team will answer this/);
  });

  it("no login to ask about (no actor, no member login): fails closed the same way", async () => {
    const d = db();
    d.tables.app_members[0].user_id = null;
    const r = await runCleoSupportTurn(d, "t1", null);
    expect(r.outcome).toBe("escalated");
    expect(h.asked).toBe(0);
  });

  it("with consent Cleo answers as before", async () => {
    const d = db();
    const r = await runCleoSupportTurn(d, "t1", "u1");
    expect(r.outcome).toBe("answered");
    expect(h.asked).toBe(1);
  });
});

describe("Autopilot Re-create asks before the model reads the client's answers", () => {
  const db = () =>
    fakeDb({
      messenger_checkins: [{ id: "c1", client_id: "cl1", task_type: "weekly", status: "completed", answers: { help: "" }, ai_analysis: { suggested_response: "Good week." } }],
      autopilot_decisions: [],
    });

  it("no consent: nothing is written, nobody is messaged, and the card says why", async () => {
    h.allowClient = false;
    const d = db();
    await expect(recreateReply(d, { checkinId: "c1", style: "redo", userId: "coach" })).rejects.toMatchObject({ aiConsent: true });
    expect(h.asked).toBe(0);
    expect(d.tables.messenger_checkins[0].ai_error).toMatch(/hasn't allowed their data to be sent to AI services/);
    expect(d.tables.messenger_checkins[0].ai_analysis.suggested_response).toBe("Good week.");
    expect(d.log.some((l) => l.table === "member_support_messages" || l.table === "messages")).toBe(false);
  });
});

describe("every server path that sends a person's data to a model asks first", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  const gated = [
    "src/lib/support-cleo/cleo-support.server.ts",
    "src/lib/autopilot/reply.server.ts",
    "src/lib/member-support.functions.ts",
    "src/lib/coaching-leads.server.ts",
    "src/lib/coach-voice.functions.ts",
    "src/lib/client-context/context.functions.ts",
    "src/lib/nutrition-roadmap/roadmap.server.ts",
    "src/lib/competition/worker.server.ts",
    "src/lib/training-roadmap.server.ts",
    "src/lib/coaching-sessions/worker.server.ts",
  ];
  it.each(gated)("%s checks consent", (f) => {
    expect(read(f)).toMatch(/ai-consent\/consent\.server/);
  });
});
