/**
 * Cleo's conversations (Nov 24 2026): permanent, restored for where the coach
 * is, organised by activity (Pinned, Today … by month), searchable and
 * filterable, archived after a quiet stretch (never deleted), and answers
 * written in the background so nothing is lost when the coach moves on.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_LABEL,
  chatTitle,
  chatWhen,
  cleanAiTitle,
  cleoPlaceFromLocation,
  groupArchive,
  groupChats,
  guessCategory,
} from "@/lib/cleo-chats";

const MARC = "11111111-1111-4111-8111-111111111111";
const DEVIN = "22222222-2222-4222-8222-222222222222";
const BLOCK = "33333333-3333-4333-8333-333333333333";

describe("conversation names", () => {
  it("names a conversation after its first question, without the greeting", () => {
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

  it("takes Cleo's short title, cleaned, and refuses an empty or generic one", () => {
    expect(cleanAiTitle('"Marc\'s bench lockout block."')).toBe("Marc's bench lockout block");
    expect(cleanAiTitle("Title: devin cardio swap")).toBe("Devin cardio swap");
    expect(cleanAiTitle("")).toBeNull();
    expect(cleanAiTitle("New chat")).toBeNull();
    expect(cleanAiTitle("a".repeat(90))!.length).toBeLessThanOrEqual(60);
  });
});

describe("what a conversation is about", () => {
  it("reads the words first, then the section it started in", () => {
    expect(guessCategory("Bump Marc's calories on rest days")).toBe("nutrition");
    expect(guessCategory("Swap his treadmill walk for the bike")).toBe("cardio");
    expect(guessCategory("Any pain flags this week?")).toBe("recovery");
    expect(guessCategory("Which check-ins are waiting on me?")).toBe("checkins");
    expect(guessCategory("Build him a 6 week peaking block")).toBe("program");
    expect(guessCategory("What's on my plate?", "analytics")).toBe("analytics");
    expect(guessCategory("What's on my plate?")).toBe("general");
    expect(CATEGORY_LABEL.checkins).toBe("Weekly check-ins");
  });
});

describe("where the coach is", () => {
  it("a client's page, tab by tab", () => {
    expect(cleoPlaceFromLocation(`/admin/clients/${MARC}`, { tab: "nutrition" })).toEqual({ clientId: MARC, blockId: null, section: "nutrition" });
    expect(cleoPlaceFromLocation(`/admin/clients/${MARC}`, { tab: "cardio" }).section).toBe("cardio");
    const contexts = { competition: "competition", meetings: "meetings", documents: "forms", sessions: "sessions", purchases: "billing", info: "details", "goals-setup": "goals", coaching: "coaching", notes: "notes", files: "documents", account: "account" };
    for (const [tab, section] of Object.entries(contexts)) {
      expect(cleoPlaceFromLocation(`/admin/clients/${MARC}`, { tab }).section).toBe(section);
      expect(cleoPlaceFromLocation("/admin/clients", { clientId: MARC, clientTab: tab }).section).toBe(section);
    }
    expect(cleoPlaceFromLocation(`/admin/clients/${MARC}`, { tab: "training" }).section).toBe("workouts");
    expect(cleoPlaceFromLocation(`/admin/clients/${MARC}`, {}).section).toBe("client");
    expect(cleoPlaceFromLocation(`/admin/clients/${MARC}/progress`, {}).section).toBe("analytics");
  });

  it("the Clients list's overlay and quick view, Program Intelligence, analytics, the builder, Messages", () => {
    expect(cleoPlaceFromLocation("/admin/clients", { clientId: MARC, clientTab: "nutrition" })).toEqual({ clientId: MARC, blockId: null, section: "nutrition" });
    expect(cleoPlaceFromLocation("/admin/clients", { peek: DEVIN })).toEqual({ clientId: DEVIN, blockId: null, section: "workouts" });
    expect(cleoPlaceFromLocation(`/admin/client-programs/${MARC}/intelligence`, {}).section).toBe("intelligence");
    expect(cleoPlaceFromLocation(`/admin/client-programs/${MARC}/analytics`, {}).section).toBe("analytics");
    expect(cleoPlaceFromLocation(`/admin/blocks/${BLOCK}`, {})).toEqual({ clientId: null, blockId: BLOCK, section: "builder" });
    expect(cleoPlaceFromLocation("/admin/communication", `?tab=messages&client=${DEVIN}`)).toEqual({ clientId: DEVIN, blockId: null, section: "messages" });
  });

  it("anywhere else is the general conversation; a malformed id is nobody", () => {
    expect(cleoPlaceFromLocation("/admin/dashboard", {})).toEqual({ clientId: null, blockId: null, section: null });
    expect(cleoPlaceFromLocation("/admin/clients", { clientId: "not-a-uuid" }).clientId).toBeNull();
  });
});

describe("History groups", () => {
  it("Pinned first, then Today, Yesterday, the last week and month, then by month; newest activity first", () => {
    const now = new Date("2026-10-13T18:00:00Z");
    const at = (id: string, iso: string, pinned = false) => ({ id, last_message_at: iso, pinned_at: pinned ? iso : null });
    const groups = groupChats(
      [
        at("a", "2026-10-13T15:00:00Z"),
        at("b", "2026-10-12T15:00:00Z"),
        at("p", "2026-08-01T15:00:00Z", true),
        at("c", "2026-10-09T15:00:00Z"),
        at("d", "2026-09-25T15:00:00Z"),
        at("e", "2026-07-02T15:00:00Z"),
        at("a2", "2026-10-13T17:00:00Z"),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "July 2026"]);
    expect(groups[1].chats.map((c) => c.id)).toEqual(["a2", "a"]);
  });

  it("groups by the person's own day (a late-evening chat in Winnipeg is that day, not tomorrow)", () => {
    const now = new Date("2026-10-14T04:30:00Z"); // 11:30 PM Oct 13 in Winnipeg
    const late = { last_message_at: "2026-10-14T04:00:00Z", pinned_at: null };
    expect(groupChats([late], now, "America/Winnipeg")[0].label).toBe("Today");
    expect(chatWhen(late.last_message_at, now, "America/Winnipeg")).toMatch(/11:00/);
  });

  it("the archive is by year, month and day, most recently active first", () => {
    const years = groupArchive([
      { id: "x", last_message_at: "2025-12-03T15:00:00Z" },
      { id: "y", last_message_at: "2026-02-10T15:00:00Z" },
      { id: "z", last_message_at: "2026-02-10T18:00:00Z" },
      { id: "w", last_message_at: "2026-01-04T15:00:00Z" },
    ]);
    expect(years.map((y) => y.year)).toEqual(["2026", "2025"]);
    expect(years[0].months.map((m) => m.label)).toEqual(["February", "January"]);
    expect(years[0].months[0].days[0].chats.map((c) => c.id)).toEqual(["z", "y"]);
  });
});

// ---------------------------------------------------------------------------
// The server side, against a small in-memory stand-in for the query builder.

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let rpcCalls: Array<{ fn: string; args: any }> = [];
let seq = 0;
const at = (ms: number) => new Date(Date.parse("2026-11-24T12:00:00Z") + ms).toISOString();

function fakeDb() {
  return {
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return { data: true, error: null };
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "delete" | "update" = "select";
      let patch: Row | Row[] = {};
      let order: { k: string; asc: boolean } | null = null;
      let limit = Infinity;
      const rows = () => (tables[table] ??= []);
      const val = (r: Row, k: string) => (k.includes("->>") ? r[k.split("->>")[0]]?.[k.split("->>")[1]] : r[k]);
      const run = () => {
        if (op === "insert") {
          const list = (Array.isArray(patch) ? patch : [patch]).map((r) => {
            const created = r.created_at ?? at(seq++ * 1000);
            const row: Row = { id: `id-${++seq}`, status: "done", superseded_at: null, archived_at: null, pinned_at: null, client_id: null, ...r, created_at: created, updated_at: created };
            if (table === "summer_chats") row.last_message_at ??= created;
            return row;
          });
          if (table === "summer_messages") {
            for (const r of list) {
              const k = r.role === "user" ? r.turn?.key : null;
              if (k && rows().some((x) => x.role === "user" && x.user_id === r.user_id && x.turn?.key === k)) return { error: { message: "duplicate key value violates unique constraint" } };
            }
          }
          rows().push(...list);
          return list;
        }
        let hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          tables[table] = rows().filter((r) => !hit.includes(r));
          return hit;
        }
        if (op === "update") {
          for (const r of hit) Object.assign(r, patch, { updated_at: new Date().toISOString() });
          return hit.map((r) => structuredClone(r));
        }
        if (order) hit = [...hit].sort((a, b) => (a[order!.k] < b[order!.k] ? -1 : 1) * (order!.asc ? 1 : -1));
        return hit.slice(0, limit).map((r) => structuredClone(r));
      };
      const finish = () => {
        const out = run() as any;
        return out?.error ? { data: null, error: out.error } : { data: out, error: null };
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => (filters.push((r) => val(r, k) === v), q),
        neq: (k: string, v: any) => (filters.push((r) => val(r, k) !== v), q),
        is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
        not: (k: string, _op: string, v: any) => (filters.push((r) => (r[k] ?? null) !== v), q),
        in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), q),
        lt: (k: string, v: any) => (filters.push((r) => r[k] < v), q),
        gt: (k: string, v: any) => (filters.push((r) => r[k] > v), q),
        gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), q),
        filter: (k: string, _op: string, v: any) => (filters.push((r) => val(r, k) === v), q),
        or: () => q,
        ilike: (k: string, p: string) => (filters.push((r) => String(r[k] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())), q),
        order: (k: string, o?: { ascending?: boolean }) => ((order = { k, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limit = n), q),
        insert: (p: Row | Row[]) => ((op = "insert"), (patch = p), q),
        update: (p: Row) => ((op = "update"), (patch = p), q),
        delete: () => ((op = "delete"), q),
        maybeSingle: async () => {
          const r = finish();
          return r.error ? r : { data: r.data[0] ?? null, error: null };
        },
        single: async () => {
          const r = finish();
          return r.error ? r : { data: r.data[0] ?? null, error: null };
        },
        then: (res: any, rej: any) => Promise.resolve(finish()).then(res, rej),
      };
      return q;
    },
  };
}
const db = fakeDb();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));

beforeEach(() => {
  seq = 100;
  rpcCalls = [];
  tables = {
    clients: [
      { id: MARC, full_name: "Marc Asugui" },
      { id: DEVIN, full_name: "Devin Buth" },
    ],
    summer_chats: [
      { id: "general-old", user_id: "u1", title: "What's on today?", preview: "Two check-ins.", client_id: null, category: "general", created_at: at(-90 * 86_400_000), last_message_at: at(-86_400_000), archived_at: null, pinned_at: null },
      { id: "marc-1", user_id: "u1", title: "Marc's bench block", preview: "Built it.", client_id: MARC, category: "program", created_at: at(-5 * 86_400_000), last_message_at: at(-3600_000), archived_at: null, pinned_at: null },
      { id: "marc-archived", user_id: "u1", title: "Marc's cut", preview: "Done.", client_id: MARC, category: "nutrition", created_at: at(-80 * 86_400_000), last_message_at: at(-60 * 86_400_000), archived_at: at(-20 * 86_400_000), archived_by: "auto", pinned_at: null },
      { id: "theirs", user_id: "u2", title: "Not mine", preview: null, client_id: MARC, category: "general", created_at: at(-3600_000), last_message_at: at(-60_000), archived_at: null, pinned_at: null },
    ],
    summer_messages: [
      { id: "m1", user_id: "u1", chat_id: "marc-1", role: "user", content: "Build Marc a bench block at RPE 7", created_at: at(-7200_000), status: "done", superseded_at: null },
      { id: "m2", user_id: "u1", chat_id: "marc-1", role: "assistant", content: "Built it.", created_at: at(-3600_000), status: "done", superseded_at: null, reply_to: "m1" },
      { id: "m3", user_id: "u1", chat_id: "marc-archived", role: "user", content: "Drop his deadlift volume", created_at: at(-60 * 86_400_000), status: "done", superseded_at: null },
    ],
    cleo_actions: [],
  };
});

describe("conversations on the server", () => {
  it("opens the client's most recent active conversation, never an archived one or anyone else's", async () => {
    const c = await import("@/lib/cleo-chats.server");
    const marc = await c.openChat(db, "u1", null, MARC);
    expect(marc.chat?.id).toBe("marc-1");
    expect(marc.client).toEqual({ id: MARC, name: "Marc Asugui" });
    expect(marc.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    // nobody: the general one; Devin (none yet): an empty conversation that knows who it's about
    expect((await c.openChat(db, "u1", null, null)).chat?.id).toBe("general-old");
    const devin = await c.openChat(db, "u1", null, DEVIN);
    expect(devin.chat).toBeNull();
    expect(devin.client?.name).toBe("Devin Buth");
    await expect(c.openChat(db, "u1", "theirs")).rejects.toThrow(/gone/);
  });

  it("an archived conversation still opens by id, readable in full", async () => {
    const c = await import("@/lib/cleo-chats.server");
    const old = await c.openChat(db, "u1", "marc-archived");
    expect(old.messages.map((m) => m.id)).toEqual(["m3"]);
  });

  it("lists active or archived, filtered by client and topic, searched by anything said", async () => {
    const c = await import("@/lib/cleo-chats.server");
    expect((await c.listChats(db, "u1")).map((x) => x.id)).toEqual(["marc-1", "general-old"]);
    expect((await c.listChats(db, "u1", { archived: true })).map((x) => x.id)).toEqual(["marc-archived"]);
    expect((await c.listChats(db, "u1", { clientId: MARC })).map((x) => x.id)).toEqual(["marc-1"]);
    expect((await c.listChats(db, "u1", { general: true })).map((x) => x.id)).toEqual(["general-old"]);
    expect((await c.listChats(db, "u1", { category: "program" })).map((x) => x.id)).toEqual(["marc-1"]);
    expect((await c.listChats(db, "u1", { q: "RPE 7" })).map((x) => x.id)).toEqual(["marc-1"]);
    expect((await c.listChats(db, "u1", { q: "deadlift", archived: true })).map((x) => x.id)).toEqual(["marc-archived"]);
    expect((await c.listChats(db, "u1"))[0].client_name).toBe("Marc Asugui");
  });

  it("pins, renames, archives and brings back; archiving unpins", async () => {
    const c = await import("@/lib/cleo-chats.server");
    await c.updateChat(db, "u1", "marc-1", { pinned: true });
    expect(tables.summer_chats.find((x) => x.id === "marc-1")!.pinned_at).toBeTruthy();
    await c.updateChat(db, "u1", "marc-1", { title: "  Bench lockout block " });
    expect(tables.summer_chats.find((x) => x.id === "marc-1")).toMatchObject({ title: "Bench lockout block", title_source: "person" });
    await c.updateChat(db, "u1", "marc-1", { archived: true });
    expect(tables.summer_chats.find((x) => x.id === "marc-1")).toMatchObject({ archived_by: "person", pinned_at: null });
    await c.updateChat(db, "u1", "marc-1", { archived: false });
    expect(tables.summer_chats.find((x) => x.id === "marc-1")!.archived_at).toBeNull();
    await expect(c.updateChat(db, "u1", "theirs", { pinned: true })).rejects.toThrow(/gone/);
  });

  it("a new conversation is named, sorted into a topic and tied to its client", async () => {
    const c = await import("@/lib/cleo-chats.server");
    const id = await c.chatFor(db, "u1", null, "hey cleo, bump his rest-day calories", { clientId: DEVIN, section: "nutrition" });
    expect(tables.summer_chats.find((x) => x.id === id)).toMatchObject({ client_id: DEVIN, category: "nutrition", title: "Bump his rest-day calories" });
  });

  it("deletes only when asked, and only your own", async () => {
    const c = await import("@/lib/cleo-chats.server");
    await c.deleteChats(db, "u1", "marc-1");
    expect(tables.summer_chats.map((x) => x.id)).not.toContain("marc-1");
    expect(tables.summer_chats.map((x) => x.id)).toContain("theirs");
  });
});

describe("answers in the background", () => {
  const ctx = () => ({ supabase: db, userId: "u1", db, coach: false, viewOnly: false });

  it("saves the question and a pending answer at once, then hands it to the worker with the session", async () => {
    const t = await import("@/lib/cleo-turns.server");
    const res = await t.startTurn(ctx(), { key: "k-1-abcdef", message: "How is Marc's bench?", chatId: "marc-1" }, "tok");
    expect(res.user?.content).toBe("How is Marc's bench?");
    expect(res.assistant).toMatchObject({ role: "assistant", status: "pending", reply_to: res.user!.id });
    expect(res.dispatched).toBe(true);
    expect(rpcCalls).toEqual([{ fn: "cleo_turn_dispatch", args: { _message_id: res.assistant.id, _token: "tok" } }]);
  });

  it("the same send twice is one question (a double tap, a retry after a dropped connection)", async () => {
    const t = await import("@/lib/cleo-turns.server");
    const a = await t.startTurn(ctx(), { key: "k-same-123", message: "Who missed workouts?", chatId: "general-old" }, "tok");
    tables.summer_messages.find((m) => m.id === a.assistant.id)!.status = "done";
    const b = await t.startTurn(ctx(), { key: "k-same-123", message: "Who missed workouts?", chatId: "general-old" }, "tok");
    expect(b.duplicate).toBe(true);
    expect(b.user?.id).toBe(a.user?.id);
    expect(tables.summer_messages.filter((m) => m.content === "Who missed workouts?")).toHaveLength(1);
  });

  it("one answer at a time in a conversation", async () => {
    const t = await import("@/lib/cleo-turns.server");
    await t.startTurn(ctx(), { key: "k-first-123", message: "First", chatId: "marc-1" }, "tok");
    await expect(t.startTurn(ctx(), { key: "k-second-12", message: "Second", chatId: "marc-1" }, "tok")).rejects.toThrow(/still answering/);
  });

  it("a new conversation about a client starts with its client and topic", async () => {
    const t = await import("@/lib/cleo-turns.server");
    const res = await t.startTurn(ctx(), { key: "k-new-12345", message: "Swap his walk for the bike", clientId: DEVIN, section: "cardio" }, "tok");
    expect(tables.summer_chats.find((c) => c.id === res.chatId)).toMatchObject({ client_id: DEVIN, category: "cardio" });
  });

  it("edit & resend and regenerate keep what they replace (out of view), never delete it", async () => {
    const t = await import("@/lib/cleo-turns.server");
    const edited = await t.startTurn(ctx(), { key: "k-edit-1234", message: "Build Marc a bench block at RPE 8", edit: "m1" }, "tok");
    expect(tables.summer_messages.find((m) => m.id === "m1")!.superseded_at).toBeTruthy();
    expect(tables.summer_messages.find((m) => m.id === "m2")!.superseded_at).toBeTruthy();
    expect(edited.chatId).toBe("marc-1");
    tables.summer_messages.find((m) => m.id === edited.assistant.id)!.status = "done";
    const again = await t.startTurn(ctx(), { key: "k-regen-123", message: "", regenerate: edited.assistant.id }, "tok");
    expect(again.user).toBeNull();
    expect(again.assistant.reply_to).toBe(edited.user!.id);
    expect(tables.summer_messages.find((m) => m.id === edited.assistant.id)!.superseded_at).toBeTruthy();
    expect(tables.summer_messages.find((m) => m.id === edited.user!.id)!.superseded_at).toBeNull();
    expect(tables.summer_messages.length).toBeGreaterThanOrEqual(6);
  });

  it("Stop marks it stopped at once; the poll hands over one that was never picked up, and fails one cut off", async () => {
    const t = await import("@/lib/cleo-turns.server");
    const res = await t.startTurn(ctx(), { key: "k-stop-1234", message: "Long one", chatId: "general-old" }, "tok");
    expect((await t.stopTurn(db, "u1", res.assistant.id))?.status).toBe("stopped");
    expect(await t.stopTurn(db, "u1", res.assistant.id)).toBeNull();

    const waiting = await t.startTurn(ctx(), { key: "k-wait-1234", message: "Waiting", chatId: "marc-1" }, "tok");
    const row = tables.summer_messages.find((m) => m.id === waiting.assistant.id)!;
    row.updated_at = new Date(Date.now() - 40_000).toISOString();
    row.created_at = new Date(Date.now() - 40_000).toISOString();
    rpcCalls = [];
    await t.pollTurns(db, "u1", [row.id], "fresh-token");
    expect(rpcCalls).toEqual([{ fn: "cleo_turn_dispatch", args: { _message_id: row.id, _token: "fresh-token" } }]);

    row.status = "running";
    row.updated_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const [polled] = await t.pollTurns(db, "u1", [row.id], "fresh-token");
    expect(polled.status).toBe("failed");
  });
});

describe("wiring", () => {
  const sql = readFileSync("supabase/migrations/20270524090000_cleo_conversations.sql", "utf8");
  const server = readFileSync("src/lib/summer.server.ts", "utf8");
  const turns = readFileSync("src/lib/cleo-turns.server.ts", "utf8");
  const hook = readFileSync("src/routes/api/public/hooks/cleo-turn.ts", "utf8");

  it("archiving never deletes: the year-long retention job is retired", () => {
    expect(sql).toContain("perform cron.unschedule(jobid) from cron.job where jobname = 'cleo-chat-retention';");
    expect(sql).toMatch(/create or replace function public\.prune_cleo_chats\(\)[\s\S]*?return 0;/);
    expect(sql).not.toMatch(/delete from public\.summer_chats/);
  });

  it("auto-archives quiet conversations, except pinned, still answering or with a card waiting", () => {
    expect(sql).toContain("and c.pinned_at is null");
    expect(sql).toContain("m.status in ('pending', 'running')");
    expect(sql).toContain("a.status in ('awaiting_approval', 'running')");
    expect(sql).toContain("cron.schedule('cleo-chat-archive'");
    // a question sent in an archived conversation brings it back
    expect(sql).toMatch(/new\.role = 'user' then[\s\S]*?archived_at = null/);
  });

  it("the worker answers as the asker (their token), never as the service role, and checks two-step", () => {
    expect(sql).toContain("revoke all on function public.cleo_turn_dispatch(uuid, text) from public, anon, authenticated;");
    expect(hook).toContain("authorizeHookRequest(request)");
    expect(turns).toContain("const own = clientForToken(token);");
    expect(turns).toContain("await checkStaffMfa(`Bearer ${token}`);");
    expect(turns).toContain("row.user_id !== userId");
    expect(turns).toContain('cleo = await assertCleo({ supabase: own, userId, claims: claims!.claims } as any);');
  });

  it("every conversation function checks Cleo access first", () => {
    const fns = readFileSync("src/lib/cleo-conversations.functions.ts", "utf8");
    const blocks = fns.split("export const ").slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(11);
    for (const b of blocks) expect(b, b.slice(0, 40)).toMatch(/await assertCleo\(context as any\)/);
  });

  it("a client's conversation never sets up a change for another client", () => {
    expect(server).toContain("if (target && target !== opts.scopeClient.id)");
  });

  it("Cleo's own calls are on the OpenAI key, never Lovable credits", () => {
    expect(readFileSync("src/lib/cleo-model.server.ts", "utf8")).toContain('resolveRoute("assistant", override as any, { openaiOnly: true })');
    expect(turns.match(/openaiOnly: true/g)?.length).toBe(2);
    expect(server).not.toContain("export async function transcribeAudio");
    const fns = readFileSync("src/lib/cleo-conversations.functions.ts", "utf8");
    expect(fns).toContain('openAiTranscriber(key, "gpt-4o-mini-transcribe", hint)');
    expect(fns).not.toContain("LOVABLE_API_KEY");
    // Cleo's voice: OpenAI first; the gateway only with no OpenAI key at all
    expect(server).toContain("const lovable = openai ? null : process.env.LOVABLE_API_KEY;");
  });
});
