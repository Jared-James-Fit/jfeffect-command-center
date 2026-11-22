/**
 * Cleo's cards run as the person who asked, never as whoever approved
 * (20270507093000_cleo_actions_run_as_requester.sql, cleo-actions.server.ts).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLEO_ACTION_KINDS, CLEO_ACTION_RULES, availableKinds, routeFor, type CleoActionKind } from "@/lib/cleo-actions";
import { CLEO_MONEY_TABLES, visibleCatalog } from "@/lib/cleo-data-access";

const coach = { isAdmin: false, isCoach: true, permissions: [] as string[] };
const finance = { isAdmin: false, permissions: ["admin.view", "payments.record", "payments.request", "tasks.manage", "discounts.manage"] };
const admin = { isAdmin: true, permissions: [] as string[] };

describe("who may ask for what", () => {
  it("a coach's client work waits for the owner; the owner's own kinds and money never reach a coach", () => {
    for (const k of ["send_message", "schedule_message", "add_client_note", "mark_check_ins_reviewed", "build_program", "edit_program_day", "publish_program", "correct_logged_exercise", "set_nutrition_targets"] as const) {
      expect(routeFor(k, coach), k).toBe("ask_owner");
    }
    for (const k of ["record_payment", "send_payment_link", "assign_program_template", "add_workout", "remove_workout", "move_workout", "book_appointment", "restore_program_version"] as const) {
      expect(routeFor(k, coach), k).toBe("not_allowed");
    }
    expect(routeFor("create_task", coach)).toBe("run");
    expect(routeFor("complete_task", coach)).toBe("run");
  });

  it("money is never approvable, and only the admin or a money permission runs it", () => {
    for (const k of CLEO_ACTION_KINDS) {
      const need = CLEO_ACTION_RULES[k].need;
      if (need === "payments.record" || need === "payments.request") {
        expect(CLEO_ACTION_RULES[k].approvable, k).toBe(false);
        expect(routeFor(k, finance), k).toBe("run");
        expect(routeFor(k, coach), k).toBe("not_allowed");
        expect(routeFor(k, admin), k).toBe("run");
      }
    }
    // A person who is a coach AND holds the finance role carries the finance role's permissions.
    expect(routeFor("record_payment", { isAdmin: false, isCoach: true, permissions: ["payments.record"] })).toBe("run");
  });

  it("only client work is ever approvable", () => {
    for (const k of CLEO_ACTION_KINDS) {
      if (CLEO_ACTION_RULES[k].approvable) expect(CLEO_ACTION_RULES[k].need, k).toBe("client");
    }
  });

  it("Cleo only offers a person the kinds their role can ask for", () => {
    const offered = availableKinds(coach);
    expect(offered).not.toContain("record_payment");
    expect(offered).not.toContain("send_payment_link");
    expect(offered).not.toContain("restore_program_version");
    expect(offered).toContain("send_message");
    expect(availableKinds(admin)).toEqual(CLEO_ACTION_KINDS);
    expect(availableKinds(finance).sort()).toEqual(["complete_task", "create_task", "record_payment", "send_payment_link"]);
    expect(availableKinds({ isAdmin: false, permissions: [] })).toEqual([]);
  });

  it("a coach's Cleo never lists or reads clients' money", () => {
    const raw = ["purchase_records", "payment_share_links", "session_ledger_events", "clients", "pl_blocks"].map((t) => ({ t, c: [["id", "uuid"]] as Array<[string, string]> }));
    const coachTables = visibleCatalog(raw, { books: false, money: false }).map((t) => t.t);
    expect(coachTables).toEqual(["clients", "pl_blocks"]);
    expect(visibleCatalog(raw, { books: false }).map((t) => t.t)).toContain("purchase_records");
    expect(CLEO_MONEY_TABLES.has("purchase_records")).toBe(true);
    const tools = readFileSync("src/lib/cleo-tools.server.ts", "utf8");
    expect(tools).toContain("if (!moneyAccess) delete (tools as Partial<typeof tools>).purchases;");
    expect(readFileSync("src/lib/summer.server.ts", "utf8")).toContain("money: owner || finance || caller.isAdmin");
  });
});

/** The text of one `case "<kind>":` block inside a function, up to the next case. */
function caseBlock(src: string, fn: string, kind: string): string {
  const start = src.indexOf(fn);
  expect(start, fn).toBeGreaterThan(-1);
  const body = src.slice(start);
  const at = body.indexOf(`case "${kind}":`);
  expect(at, `${fn} ${kind}`).toBeGreaterThan(-1);
  const rest = body.slice(at + kind.length + 7);
  const next = rest.search(/\n    case "[a-z_]+":/);
  return rest.slice(0, next < 0 ? undefined : next);
}

describe("an approvable card never goes through a request-bound server function", () => {
  // A createServerFn call (`fn({ data: … })`) reads the session of whoever's request it's in:
  // on an approval that's the owner. Approvable kinds write only through the actor's client.
  const actions = readFileSync("src/lib/cleo-actions.server.ts", "utf8");
  const program = readFileSync("src/lib/cleo-program.server.ts", "utf8");
  for (const kind of CLEO_ACTION_KINDS.filter((k) => CLEO_ACTION_RULES[k].approvable)) {
    it(kind, () => {
      const isProgram = /"(build_program|edit_program_day|publish_program|correct_logged_exercise|set_nutrition_targets)"/.test(`"${kind}"`);
      const block = isProgram
        ? caseBlock(program, "export async function executeProgramAction", kind)
        : caseBlock(actions, "async function execute(", kind);
      expect(block).not.toMatch(/\w+\(\{\s*data:/);
    });
  }

  it("approval runs as the requester, and the database holds it to them", () => {
    expect(actions).toContain("runClaimed(await requesterActor(claimed), claimed)");
    expect(actions).toContain('if (actor.userId !== row.requested_by) throw new Error("A card only ever runs as the person who asked for it.");');
    const sql = readFileSync("supabase/migrations/20270507093000_cleo_actions_run_as_requester.sql", "utf8");
    expect(sql).toContain("CHECK (executed_as IS NULL OR executed_as = requested_by)");
  });
});

// ── approveAction end to end, against an in-memory database ────────────────

type Row = Record<string, any>;
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ANA = "00000000-0000-4000-8000-0000000000c1";
const MARC = "00000000-0000-4000-8000-00000000c1e1";
const NICO = "00000000-0000-4000-8000-00000000c1e2";

let tables: Record<string, Row[]>;
let rpc: Record<string, (args: any) => any>;
const writes: Array<{ via: string; table: string; op: string; row?: Row }> = [];

function fake(via: string) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: any = null;
    let returning = false;
    const q: any = {
      select: () => { if (op !== "select") returning = true; return q; },
      insert: (rows: any) => { op = "insert"; payload = rows; return q; },
      update: (patch: any) => { op = "update"; payload = patch; return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      order: () => q,
      limit: () => q,
      run() {
        const list = (tables[table] ??= []);
        if (op === "insert") {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
          for (const r of rows) { list.push(r); writes.push({ via, table, op, row: r }); }
          return { data: rows, error: null };
        }
        const hit = list.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of hit) { Object.assign(r, payload); writes.push({ via, table, op, row: r }); }
          return { data: returning ? hit : null, error: null };
        }
        if (op === "delete") {
          tables[table] = list.filter((r) => !hit.includes(r));
          writes.push({ via, table, op });
          return { data: null, error: null };
        }
        return { data: hit, error: null };
      },
      maybeSingle: async () => { const r = q.run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      single: async () => { const r = q.run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }; },
      then: (ok: any, bad: any) => Promise.resolve(q.run()).then(ok, bad),
    };
    return q;
  };
  return {
    from,
    rpc: async (name: string, args: any) => (rpc[name] ? { data: rpc[name](args), error: null } : { data: null, error: { code: "PGRST202", message: "missing" } }),
  };
}

const service = fake("service");
const pushed: Row[] = [];
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: service }));
vi.mock("@/lib/push/message-push.server", () => ({ pushNewMessage: async (_db: any, msg: Row) => { pushed.push(msg); return { results: [] }; } }));
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: async () => ({ sent: 0 }) }));

describe("approving a coach's card", () => {
  beforeEach(() => {
    writes.length = 0;
    pushed.length = 0;
    tables = {
      user_roles: [{ user_id: OWNER, role: "admin" }, { user_id: ANA, role: "coach" }],
      role_permissions: [],
      business_owners: [{ user_id: OWNER }],
      profiles: [{ id: OWNER, full_name: "Jared Owner" }, { id: ANA, full_name: "Ana Coach" }],
      clients: [{ id: MARC, assigned: ANA }, { id: NICO, assigned: null }],
      messages: [],
      conversation_state: [],
      cleo_actions: [],
    };
    rpc = {
      is_business_owner: ({ _uid }) => _uid === OWNER,
      cleo_action_target_allowed: ({ _requester, _client }) =>
        tables.user_roles.some((r) => r.user_id === _requester && r.role === "admin") ||
        (tables.user_roles.some((r) => r.user_id === _requester && r.role === "coach") && tables.clients.some((c) => c.id === _client && c.assigned === _requester)),
    };
  });

  function card(kind: CleoActionKind, params: Row, requested_by = ANA): string {
    const id = crypto.randomUUID();
    tables.cleo_actions.push({ id, kind, params, requested_by, status: "awaiting_approval", summary: "x", permission: CLEO_ACTION_RULES[kind].need, created_at: new Date().toISOString() });
    return id;
  }

  const ownerActor = () => {
    const own = fake("owner");
    return { supabase: own, db: own, userId: OWNER };
  };

  it("sends the message as the coach, not the owner, and records who approved", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("send_message", { client_id: MARC, body: "Nice work today." });
    const out = await approveAction(ownerActor() as any, id);
    expect(out.status).toBe("done");
    expect(tables.messages).toHaveLength(1);
    expect(tables.messages[0]).toMatchObject({ client_id: MARC, sender_id: ANA, sender_role: "coach" });
    expect(pushed[0]).toMatchObject({ sender_id: ANA });
    expect(writes.filter((w) => w.via === "owner")).toEqual([]);
    const row = tables.cleo_actions.find((r) => r.id === id)!;
    expect(row).toMatchObject({ status: "done", decided_by: OWNER, executed_as: ANA });
    expect(row.decided_at).toBeTruthy();
  });

  it("refuses when the client isn't the coach's (any more)", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("send_message", { client_id: NICO, body: "Hi" });
    const out = await approveAction(ownerActor() as any, id);
    expect(out).toMatchObject({ status: "failed", error: expect.stringMatching(/not this client's coach/) });
    expect(tables.messages).toHaveLength(0);
  });

  it("refuses when the coach lost the coach role before the owner approved", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("add_client_note", { client_id: MARC, title: "t", body: "b" });
    tables.user_roles = tables.user_roles.filter((r) => r.user_id !== ANA);
    const out = await approveAction(ownerActor() as any, id);
    expect(out).toMatchObject({ status: "failed", error: expect.stringMatching(/role can't do this/) });
    expect(tables.client_file_notes ?? []).toHaveLength(0);
  });

  it("never runs a kind the owner keeps for himself, even if an old card is waiting", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("record_payment", { purchase_id: MARC, amount: 100, method: "cash" });
    const out = await approveAction(ownerActor() as any, id);
    expect(out).toMatchObject({ status: "failed", error: expect.stringMatching(/Only the owner/) });
    expect(writes.filter((w) => w.table !== "cleo_actions")).toEqual([]);
  });

  it("writes a coach note as the coach", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("add_client_note", { client_id: MARC, title: "Knee", body: "Sore after squats" });
    const out = await approveAction(ownerActor() as any, id);
    expect(out.status).toBe("done");
    expect(tables.client_file_notes[0]).toMatchObject({ client_id: MARC, author_id: ANA });
  });

  it("only the business owner approves", async () => {
    const { approveAction } = await import("@/lib/cleo-actions.server");
    const id = card("send_message", { client_id: MARC, body: "x" });
    const ana = fake("ana");
    await expect(approveAction({ supabase: ana, db: ana, userId: ANA } as any, id)).rejects.toThrow(/business owner/);
    expect(tables.messages).toHaveLength(0);
  });
});
