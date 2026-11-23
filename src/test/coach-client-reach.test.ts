/**
 * Server functions that act as the server reach only the caller's own clients
 * (staff-client-access.server.ts): appointments, account lifecycle, schedule
 * undo, My Voice's client settings, the booking clash check and Google event
 * assignment. A coach who isn't assigned is refused (and nothing is written as
 * the server); the assigned coach and the admin go through.
 *
 * The handlers run for real against an in-memory database: the caller's own
 * client sees what RLS would show them, the service role sees everything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: null as any }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b: any = {
      middleware: () => b,
      inputValidator: (v: (d: unknown) => unknown) => ((validate = v), b),
      handler: (h: (o: { data: any; context: any }) => unknown) => (o: { data?: unknown; context: any }) =>
        h({ data: validate(o.data), context: o.context }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return state.admin;
  },
}));
vi.mock("@/lib/google-cal.server", () => ({
  gcalCreateEvent: async () => null,
  gcalUpdateEvent: async () => null,
  gcalDeleteEvent: async () => null,
}));
vi.mock("@/lib/pt-session-gcal.server", () => ({
  listGoogleBusy: async () => ({ items: [], checked: true }),
}));

import {
  cancelAppointment,
  createAppointment,
  markAppointmentStatus,
  rescheduleAppointment,
  updateAppointment,
} from "@/lib/appointments.functions";
import { resolveLifecycle } from "@/lib/lifecycle.server";
import { getAccountReview } from "@/lib/lifecycle.functions";
import { undoScheduleChange } from "@/lib/schedule-manager.functions";
import { getCoachVoiceFn, saveClientVoiceFn, saveCoachVoiceFn, tryCoachVoiceFn } from "@/lib/coach-voice.functions";
import { DEFAULT_VOICE } from "@/lib/coach-voice";
import { checkSessionConflicts } from "@/lib/schedule.functions";
import { assignGoogleEventToClient } from "@/lib/google-cal.functions";

// ── an in-memory database ──────────────────────────────────────────────────

type Row = Record<string, any>;
type World = Record<string, Row[]>;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

/** What RLS shows this login (null = the service role, everything). */
function visible(w: World, table: string, row: Row, uid: string | null): boolean {
  if (uid === null) return true;
  if ((w.user_roles ?? []).some((r) => r.user_id === uid && r.role === "admin")) return true;
  // coached_client_ids(): the coach record with this login, Active and not archived.
  const active = (w.coaches ?? []).filter((c) => c.user_id === uid && c.status === "Active" && !c.archived).map((c) => c.id);
  const coached = new Set((w.clients ?? []).filter((c) => active.includes(c.assigned_coach_id)).map((c) => c.id));
  const own = new Set((w.clients ?? []).filter((c) => c.user_id === uid).map((c) => c.id));
  const mine = (clientId: string) => coached.has(clientId) || own.has(clientId);
  const blockClient = (blockId: string) => (w.pl_blocks ?? []).find((b) => b.id === blockId)?.client_id;
  const weekClient = (weekId: string) => blockClient((w.pl_weeks ?? []).find((x) => x.id === weekId)?.block_id);
  switch (table) {
    case "clients":
      return mine(row.id);
    case "coaches":
      return true;
    case "user_roles":
      return row.user_id === uid;
    case "appointments": {
      // host_coach_id = current_coach_id(), or the client reading their own.
      const current = (w.coaches ?? []).find((c) => c.user_id === uid && !c.archived)?.id;
      return (!!current && row.host_coach_id === current) || own.has(row.client_id);
    }
    case "purchase_records":
      return mine(row.client_id);
    case "pl_schedule_audit":
      return own.has(row.client_id);
    case "pl_blocks":
      return mine(row.client_id);
    case "pl_weeks":
      return mine(blockClient(row.block_id));
    case "pl_days":
      return mine(weekClient(row.week_id));
    default:
      return false;
  }
}

function db(w: World, uid: string | null) {
  const cmp = (op: string) => (c: string, v: any) => (r: Row) => {
    const x = r[c];
    if (x == null) return false;
    return op === "lt" ? x < v : op === "gt" ? x > v : op === "gte" ? x >= v : x <= v;
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
    let patch: Row = {};
    let rows: Row[] = [];
    const run = () => {
      const all = (w[table] ??= []);
      if (op === "insert" || op === "upsert") {
        const added = rows.map((r) => ({ id: r.id ?? uuid(), ...r }));
        all.push(...added);
        return { data: added.map((r) => ({ ...r })), error: null };
      }
      const hit = all.filter((r) => visible(w, table, r, uid) && filters.every((f) => f(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, patch));
      if (op === "delete") w[table] = all.filter((r) => !hit.includes(r));
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: any) => (filters.push((r) => (r[c] ?? null) !== v), q),
      lt: (c: string, v: any) => (filters.push(cmp("lt")(c, v)), q),
      gt: (c: string, v: any) => (filters.push(cmp("gt")(c, v)), q),
      gte: (c: string, v: any) => (filters.push(cmp("gte")(c, v)), q),
      lte: (c: string, v: any) => (filters.push(cmp("lte")(c, v)), q),
      order: () => q,
      limit: () => q,
      update: (p: Row) => ((op = "update"), (patch = p), q),
      delete: () => ((op = "delete"), q),
      insert: (r: Row | Row[]) => ((op = "insert"), (rows = ([] as Row[]).concat(r)), q),
      upsert: (r: Row | Row[]) => ((op = "upsert"), (rows = ([] as Row[]).concat(r)), q),
      maybeSingle: async () => {
        const r = run();
        return { data: r.data[0] ?? null, error: null };
      },
      single: async () => {
        const r = run();
        return r.data.length ? { data: r.data[0], error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  const rpc = async (fn: string, args: any) => {
    if (fn === "has_role") {
      return { data: (w.user_roles ?? []).some((r) => r.user_id === args._user_id && r.role === args._role), error: null };
    }
    // the business owner is the "owner" login (with its two-step sign-in)
    if (fn === "is_business_owner") return { data: args._uid === "owner", error: null };
    return { data: null, error: null };
  };
  return { from, rpc };
}

// ── the people ─────────────────────────────────────────────────────────────
// Ana coaches Marc; Bo coaches Nico; Sam's coach record was suspended (the
// coach role went with it) but still names Susan; the owner is the admin.

let w: World;
const as = (uid: string) => ({ supabase: db(w, uid), userId: uid });
/** Runs a server function's handler as this login (the mock above hands it the context). */
const call = (fn: unknown, data: unknown, uid: string): Promise<any> => (fn as any)({ data, context: as(uid) });
const MARC = "11111111-1111-4111-8111-111111111111";
const NICO = "22222222-2222-4222-8222-222222222222";
const SUSAN = "33333333-3333-4333-8333-333333333333";
const PKG_MARC = "44444444-4444-4444-8444-444444444444";
const PKG_NICO = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  seq = 0;
  w = {
    user_roles: [
      { user_id: "ana", role: "coach" },
      { user_id: "bo", role: "coach" },
      { user_id: "owner", role: "admin" },
      { user_id: "marc-login", role: "client" },
    ],
    coaches: [
      { id: "coach-ana", user_id: "ana", full_name: "Ana", status: "Active", archived: false },
      { id: "coach-bo", user_id: "bo", full_name: "Bo", status: "Active", archived: false },
      { id: "coach-sam", user_id: "sam", full_name: "Sam", status: "Suspended", archived: false },
      { id: "coach-owner", user_id: "owner", full_name: "Owner", status: "Active", archived: false },
    ],
    clients: [
      { id: MARC, user_id: "marc-login", full_name: "Marc Asugui", assigned_coach_id: "coach-ana", status: "Active", service_tier: "coaching", created_at: "2026-01-01" },
      { id: NICO, user_id: "nico-login", full_name: "Nicolas Galli", assigned_coach_id: "coach-bo", status: "Active", service_tier: "coaching", created_at: "2026-01-01" },
      { id: SUSAN, user_id: "susan-login", full_name: "Susan", assigned_coach_id: "coach-sam", status: "Active", service_tier: "coaching", created_at: "2026-01-01" },
    ],
    purchase_records: [
      { id: PKG_MARC, client_id: MARC, sessions_used: 3 },
      { id: PKG_NICO, client_id: NICO, sessions_used: 5 },
    ],
    profiles: [],
    community_profiles: [],
    appointments: [],
    session_ledger_events: [],
    client_crm_activities: [],
    appointment_reminders: [],
    appointment_audit_log: [],
  };
  state.admin = db(w, null);
});

const appt = (id: string, host: string, clientId: string | null, pkg: string | null = null) =>
  w.appointments.push({
    id,
    host_coach_id: host,
    client_id: clientId,
    session_credit_package_id: pkg,
    credits_used: 1,
    credit_deducted: false,
    status: "Scheduled",
    title: "1:1 Call",
    appointment_type: "Coaching Call",
    starts_at: "2026-12-01T15:00:00.000Z",
    ends_at: "2026-12-01T16:00:00.000Z",
    timezone: "America/Winnipeg",
    sms_reminders_enabled: true,
  });
const pkg = (id: string) => w.purchase_records.find((p) => p.id === id)!;
const apptRow = (id: string) => w.appointments.find((a) => a.id === id)!;
const A = (n: number) => `00000000-0000-4000-9000-00000000000${n}`;

// ── appointments ───────────────────────────────────────────────────────────

describe("appointments reach only the caller's own clients", () => {
  it("a coach can't complete a call they host with another coach's client, and its package is never charged", async () => {
    // A row a coach could write straight through the API (RLS checks only the host).
    appt(A(1), "coach-ana", NICO, PKG_NICO);
    await expect(call(markAppointmentStatus, { id: A(1), status: "Completed" }, "ana")).rejects.toThrow(
      "You can't change this appointment.",
    );
    expect(apptRow(A(1)).status).toBe("Scheduled");
    expect(pkg(PKG_NICO).sessions_used).toBe(5);
    expect(w.session_ledger_events).toHaveLength(0);
    expect(w.client_crm_activities).toHaveLength(0);
  });

  it("the assigned coach completes their own client's call and uses its credit", async () => {
    appt(A(2), "coach-ana", MARC, PKG_MARC);
    await expect(call(markAppointmentStatus, { id: A(2), status: "Completed" }, "ana")).resolves.toEqual({ ok: true });
    expect(apptRow(A(2)).status).toBe("Completed");
    expect(pkg(PKG_MARC).sessions_used).toBe(4);
    expect(w.session_ledger_events).toHaveLength(1);
  });

  it("the admin completes any client's call", async () => {
    appt(A(1), "coach-ana", NICO, PKG_NICO);
    await expect(call(markAppointmentStatus, { id: A(1), status: "Completed" }, "owner")).resolves.toEqual({ ok: true });
    expect(pkg(PKG_NICO).sessions_used).toBe(6);
  });

  it("a package that isn't the appointment's own client's is never charged", async () => {
    appt(A(3), "coach-ana", MARC, PKG_NICO);
    await call(markAppointmentStatus, { id: A(3), status: "Completed" }, "ana");
    expect(pkg(PKG_NICO).sessions_used).toBe(5);
    expect(w.session_ledger_events).toHaveLength(0);
  });

  it("cancel and reschedule refuse another coach's client; the admin still can", async () => {
    appt(A(1), "coach-ana", NICO);
    await expect(call(cancelAppointment, { id: A(1) }, "ana")).rejects.toThrow("You can't change this appointment.");
    const move = { id: A(1), starts_at: "2026-12-02T15:00:00.000Z", ends_at: "2026-12-02T16:00:00.000Z" };
    await expect(call(rescheduleAppointment, move, "ana")).rejects.toThrow("You can't change this appointment.");
    expect(apptRow(A(1)).starts_at).toBe("2026-12-01T15:00:00.000Z");
    expect(w.appointment_reminders).toHaveLength(0);

    // The admin cancels it.
    await expect(call(cancelAppointment, { id: A(1) }, "owner")).resolves.toEqual({ ok: true });
    expect(apptRow(A(1)).status).toBe("Cancelled");
  });

  it("creating or editing one names only a client (and package) the caller reaches", async () => {
    const base = {
      appointment_type: "Coaching Call",
      title: "Check-in",
      starts_at: "2026-12-03T15:00:00.000Z",
      ends_at: "2026-12-03T15:30:00.000Z",
      sms_reminders_enabled: false,
    };
    await expect(call(createAppointment, { ...base, client_id: NICO } as any, "ana")).rejects.toThrow(
      "You can't change this appointment.",
    );
    await expect(
      call(createAppointment, { ...base, client_id: MARC, session_credit_package_id: PKG_NICO } as any, "ana"),
    ).rejects.toThrow("That package isn't this client's.");
    expect(w.appointments).toHaveLength(0);

    const mine: any = await call(createAppointment, { ...base, client_id: MARC, session_credit_package_id: PKG_MARC } as any, "ana");
    expect(mine.client_id).toBe(MARC);
    const owners: any = await call(createAppointment, { ...base, client_id: NICO } as any, "owner");
    expect(owners.client_id).toBe(NICO);

    // Moving her own appointment onto another coach's client is refused.
    await expect(call(updateAppointment, { id: mine.id, client_id: NICO }, "ana")).rejects.toThrow(
      "You can't change this appointment.",
    );
    await expect(call(updateAppointment, { id: mine.id, title: "Renamed" }, "ana")).resolves.toMatchObject({ title: "Renamed" });
    expect(apptRow(mine.id).client_id).toBe(MARC);
  });

  it("a Google event goes onto a client only for their coach or the admin", async () => {
    const ev = { googleEventId: "g1", googleEventTitle: "Call", googleEventStartsAt: "2026-12-01T15:00:00Z", googleEventEndsAt: "2026-12-01T16:00:00Z" };
    await expect(call(assignGoogleEventToClient, { ...ev, clientId: NICO }, "ana")).rejects.toThrow("Client not found.");
    expect(w.appointments).toHaveLength(0);
    await expect(call(assignGoogleEventToClient, { ...ev, clientId: MARC }, "ana")).resolves.toMatchObject({ created: true });
    await expect(
      call(assignGoogleEventToClient, { ...ev, googleEventId: "g2", clientId: NICO }, "owner"),
    ).resolves.toMatchObject({ created: true });
  });
});

// ── the booking clash check ────────────────────────────────────────────────

describe("the clash check names only the caller's own appointments", () => {
  const slot = { timezone: "UTC", slots: [{ key: "s", date: "2026-12-01", start: "15:00", end: "16:00" }] };
  beforeEach(() => {
    appt(A(1), "coach-bo", NICO);
    appt(A(2), "coach-ana", MARC);
    for (const a of w.appointments) a.client = w.clients.find((c) => c.id === a.client_id);
    w.pt_sessions = [];
  });
  const titles = async (uid: string) =>
    ((await call(checkSessionConflicts, slot, uid)) as any).conflicts[0].items.map((i: any) => i.title).sort();

  it("another coach's client reads as busy, never by name", async () => {
    expect(await titles("ana")).toEqual(["Another appointment", "Marc Asugui · 1:1 Call"]);
  });

  it("the admin sees who each one is with", async () => {
    expect(await titles("owner")).toEqual(["Marc Asugui · 1:1 Call", "Nicolas Galli · 1:1 Call"]);
  });
});

// ── account lifecycle ──────────────────────────────────────────────────────

describe("deactivating an account: the person, their coach (through their own login) or the admin", () => {
  const admin = () => state.admin;

  it("the assigned coach and the admin; never another coach", async () => {
    await expect(resolveLifecycle(admin(), "ana", MARC, db(w, "ana") as any)).resolves.toMatchObject({ actor: { role: "coach" } });
    await expect(resolveLifecycle(admin(), "owner", NICO, db(w, "owner") as any)).resolves.toMatchObject({ actor: { role: "admin" } });
    await expect(resolveLifecycle(admin(), "ana", NICO, db(w, "ana") as any)).rejects.toThrow("You can't change this account.");
  });

  it("a suspended coach's old coach record reaches nobody", async () => {
    await expect(resolveLifecycle(admin(), "sam", SUSAN, db(w, "sam") as any)).rejects.toThrow("You can't change this account.");
  });

  it("the person themselves", async () => {
    await expect(resolveLifecycle(admin(), "marc-login", undefined, db(w, "marc-login") as any)).resolves.toMatchObject({
      actor: { who: "self" },
    });
  });

  it("the review refuses before anything is read for another coach's client", async () => {
    await expect(call(getAccountReview, { clientId: NICO, kind: "deactivate" }, "ana")).rejects.toThrow(
      "You can't change this account.",
    );
    await expect(call(getAccountReview, { clientId: SUSAN, kind: "deactivate" }, "sam")).rejects.toThrow(
      "You can't change this account.",
    );
  });
});

// ── schedule undo ──────────────────────────────────────────────────────────

describe("undoing a schedule change puts back only that client's own workouts", () => {
  const BATCH = "00000000-0000-4000-a000-000000000001";
  beforeEach(() => {
    w.pl_blocks = [
      { id: "b-marc", client_id: MARC },
      { id: "b-nico", client_id: NICO },
    ];
    w.pl_weeks = [
      { id: "w-marc", block_id: "b-marc" },
      { id: "w-nico", block_id: "b-nico" },
    ];
    w.pl_days = [
      { id: "d-marc", week_id: "w-marc", scheduled_date: "2026-12-05", schedule_source: "manual" },
      { id: "d-nico", week_id: "w-nico", scheduled_date: "2026-12-06", schedule_source: "manual" },
    ];
    // Marc's own move, plus a row anyone can write through the API (RLS only
    // checks the client) that names Nico's workout.
    w.pl_schedule_audit = [
      { id: "a1", batch_id: BATCH, day_id: "d-marc", client_id: MARC, previous_date: "2026-12-01", new_date: "2026-12-05", previous_source: "auto" },
      { id: "a2", batch_id: BATCH, day_id: "d-nico", client_id: MARC, previous_date: "2027-01-01", new_date: "2026-12-06", previous_source: "auto" },
    ];
  });
  const day = (id: string) => w.pl_days.find((d) => d.id === id)!;

  it("the client: their workout goes back, another client's never moves", async () => {
    const res: any = await call(undoScheduleChange, { batchId: BATCH }, "marc-login");
    expect(res.undone).toBe(1);
    expect(day("d-marc").scheduled_date).toBe("2026-12-01");
    expect(day("d-nico").scheduled_date).toBe("2026-12-06");
  });

  it("the admin: the same, whatever the rows say", async () => {
    const res: any = await call(undoScheduleChange, { batchId: BATCH }, "owner");
    expect(res.undone).toBe(1);
    expect(day("d-nico").scheduled_date).toBe("2026-12-06");
  });

  it("another coach reads nothing to undo", async () => {
    await expect(call(undoScheduleChange, { batchId: BATCH }, "bo")).rejects.toThrow();
    expect(day("d-marc").scheduled_date).toBe("2026-12-05");
  });
});

// ── My Voice ───────────────────────────────────────────────────────────────

describe("My Voice's client settings are the client's coach's or the admin's", () => {
  it("another coach can't change or read a client's voice settings", async () => {
    await expect(call(saveClientVoiceFn, { clientId: MARC, nickname: "Big M" }, "bo")).rejects.toThrow("Client not found.");
    expect(w.clients.find((c) => c.id === MARC)!.voice_nickname).toBeUndefined();
  });

  it("the voice itself is the owner's: no other coach reads, saves or tries it", async () => {
    const profile = DEFAULT_VOICE as any;
    w.coach_voice = [{ id: true, profile: { rules: "the owner's private rules" }, updated_at: "2026-11-20T00:00:00Z" }];
    for (const uid of ["ana", "bo"]) {
      const got: any = await call(getCoachVoiceFn, undefined, uid);
      expect(got.owner).toBe(false);
      expect(got.profile).toBeNull();
      expect(JSON.stringify(got)).not.toContain("private rules");
      await expect(call(saveCoachVoiceFn, { profile }, uid)).rejects.toThrow("Only the owner");
      await expect(call(tryCoachVoiceFn, { profile, scenario: "great_week", clientId: MARC }, uid)).rejects.toThrow("Only the owner");
    }
    const mine: any = await call(getCoachVoiceFn, undefined, "owner");
    expect(mine.owner).toBe(true);
    expect(mine.profile.rules).toBe("the owner's private rules");
  });

  it("the assigned coach and the admin can", async () => {
    await expect(call(saveClientVoiceFn, { clientId: MARC, nickname: "Big M" }, "ana")).resolves.toEqual({ ok: true });
    expect(w.clients.find((c) => c.id === MARC)!.voice_nickname).toBe("Big M");
    await expect(call(saveClientVoiceFn, { clientId: NICO, edgyOk: true }, "owner")).resolves.toEqual({ ok: true });
    expect(w.clients.find((c) => c.id === NICO)!.voice_edgy_ok).toBe(true);
  });

  it("the client list is the caller's own clients (the admin's: everyone)", async () => {
    w.clients.forEach((c) => (c.archived = false));
    w.coach_voice = [];
    const names = async (uid: string) => ((await call(getCoachVoiceFn, undefined, uid)) as any).clients.map((c: any) => c.id).sort();
    expect(await names("ana")).toEqual([MARC]);
    expect(await names("owner")).toEqual([MARC, NICO, SUSAN]);
  });
});
