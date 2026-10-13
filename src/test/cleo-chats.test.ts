/**
 * Cleo's chats: separate conversations with a History, a fresh chat after a
 * 6-hour gap, a year of keeping, and "New chat" that never deletes anything.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_GAP_MS, chatTitle, groupChats, isCurrentChat } from "@/lib/cleo-chats";

describe("chat titles", () => {
  it("names a chat after its first question, without the greeting", () => {
    expect(chatTitle("Hey Cleo, who missed workouts this week?")).toBe("Who missed workouts this week?");
    expect(chatTitle("cleo add calf raises to Monday")).toBe("Add calf raises to Monday");
    expect(chatTitle("   ")).toBe("New chat");
  });

  it("cuts long questions at a word", () => {
    const t = chatTitle("Can you build Marc a 6 week block focused on his bench lockout and his squat depth please");
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/\s…$/);
  });
});

describe("which chat is current", () => {
  it("keeps going within 6 hours, starts fresh after", () => {
    const now = Date.parse("2026-10-13T18:00:00Z");
    expect(isCurrentChat(new Date(now - CHAT_GAP_MS + 60_000).toISOString(), now)).toBe(true);
    expect(isCurrentChat(new Date(now - CHAT_GAP_MS - 60_000).toISOString(), now)).toBe(false);
  });
});

describe("History groups", () => {
  it("Today, Yesterday, the last week and month, then by month", () => {
    const now = new Date("2026-10-13T18:00:00Z");
    const at = (iso: string) => ({ last_message_at: iso });
    const groups = groupChats(
      [at("2026-10-13T15:00:00Z"), at("2026-10-12T15:00:00Z"), at("2026-10-09T15:00:00Z"), at("2026-09-25T15:00:00Z"), at("2026-07-02T15:00:00Z")],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "July 2026"]);
  });
});

// ---------------------------------------------------------------------------
// The server side, against a tiny in-memory stand-in for the query builder.

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "delete" = "select";
      let patch: Row | Row[] = {};
      let order: { k: string; asc: boolean } | null = null;
      let limit = Infinity;
      const rows = () => (tables[table] ??= []);
      const run = () => {
        if (op === "insert") {
          const list = (Array.isArray(patch) ? patch : [patch]).map((r) => ({ id: `id-${Math.random().toString(36).slice(2, 9)}`, created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), ...r }));
          rows().push(...list);
          return list;
        }
        let hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          tables[table] = rows().filter((r) => !hit.includes(r));
          return hit;
        }
        if (order) hit = [...hit].sort((a, b) => (a[order!.k] < b[order!.k] ? -1 : 1) * (order!.asc ? 1 : -1));
        return hit.slice(0, limit).map((r) => structuredClone(r));
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
        not: (k: string, _op: string, v: any) => (filters.push((r) => (r[k] ?? null) !== v), q),
        in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), q),
        ilike: (k: string, p: string) => (filters.push((r) => String(r[k] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())), q),
        order: (k: string, o?: { ascending?: boolean }) => ((order = { k, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limit = n), q),
        insert: (p: Row | Row[]) => ((op = "insert"), (patch = p), q),
        delete: () => ((op = "delete"), q),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
  };
}
const db = fakeDb();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  tables = {
    summer_chats: [
      { id: "old", user_id: "u1", title: "Marc's block", preview: "Built it.", created_at: ago(30), last_message_at: ago(28) },
      { id: "other", user_id: "u2", title: "Not mine", preview: null, created_at: ago(1), last_message_at: ago(1) },
    ],
    summer_messages: [
      { id: "m1", user_id: "u1", chat_id: "old", role: "user", content: "Build Marc a bench block", created_at: ago(29) },
      { id: "m2", user_id: "u1", chat_id: "old", role: "assistant", content: "Built it.", created_at: ago(28) },
    ],
  };
});

describe("Cleo chats on the server", () => {
  it("opens fresh after a 6-hour gap, but the old chat is still in History and can be opened", async () => {
    const c = await import("@/lib/cleo-chats.server");
    expect(await c.openChat(db, "u1")).toEqual({ chat: null, messages: [] });
    const old = await c.openChat(db, "u1", "old");
    expect(old.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect((await c.listChats(db, "u1")).map((x) => x.id)).toEqual(["old"]);
  });

  it("never opens someone else's chat", async () => {
    const c = await import("@/lib/cleo-chats.server");
    await expect(c.openChat(db, "u1", "other")).rejects.toThrow(/gone/);
    // A message aimed at someone else's chat starts a new one of your own instead.
    const id = await c.chatFor(db, "u1", "other", "hi cleo, what's on today?");
    expect(id).not.toBe("other");
    expect(tables.summer_chats.find((x) => x.id === id)).toMatchObject({ user_id: "u1", title: "What's on today?" });
  });

  it("search finds a chat by anything said in it", async () => {
    const c = await import("@/lib/cleo-chats.server");
    expect((await c.listChats(db, "u1", "bench")).map((x) => x.id)).toEqual(["old"]);
    expect(await c.listChats(db, "u1", "deadlift")).toEqual([]);
  });

  it("deletes one chat, or all of yours, and nobody else's", async () => {
    const c = await import("@/lib/cleo-chats.server");
    await c.deleteChats(db, "u1", "old");
    expect(tables.summer_chats.map((x) => x.id)).toEqual(["other"]);
    await c.deleteChats(db, "u1", null);
    expect(tables.summer_chats.map((x) => x.id)).toEqual(["other"]);
    expect(tables.summer_messages).toHaveLength(0);
  });
});

describe("wiring", () => {
  const chat = readFileSync("src/components/admin/books/summer-chat.tsx", "utf8");
  const server = readFileSync("src/lib/summer.server.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261115090000_cleo_chats.sql", "utf8");

  it("New chat keeps the old one (nothing is deleted) and History opens any chat", () => {
    expect(chat).toContain('setView({ kind: "new" })');
    expect(chat).not.toContain("clearSummer");
    expect(chat).toContain("<CleoChatHistory");
  });

  it("Cleo only reads the chat she's in, and every message is saved into a chat", () => {
    expect(server).toContain('.eq("chat_id", input.chatId)');
    expect(server).toMatch(/chat_id: chatId, role: "user"/);
  });

  it("keeps a year, cleared daily", () => {
    expect(sql).toContain("last_message_at < now() - interval '365 days'");
    expect(sql).toContain("cron.schedule('cleo-chat-retention'");
  });
});
