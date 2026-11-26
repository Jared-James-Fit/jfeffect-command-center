/**
 * The goal ledger end to end against an in-memory database
 * (scripts/replay/memory-sb.ts): a meeting's analysis and the coach's notes →
 * proposed goals (units read from their training, nothing invented, no
 * duplicates) → a read against the meet forecast → the coach approves → one
 * consolidated update waits out the review window → it goes only when the
 * client is offline and outside quiet hours, once, and drops what's no longer
 * current. The strength line and the meet forecast are stubbed (their engines
 * are tested on their own); the ledger's rules and writes are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memorySb } from "../../scripts/replay/memory-sb";

vi.mock("@/lib/competition/load.server", () => ({
  loadLiftEvidence: async () => ({
    squat: { lift: "squat", nowKg: 100, state: "measured", basis: "92.5 kg × 1 @ 7.5", basisDay: "2026-11-23", hardSessions6w: 4, trendPerWeek: 0.004, direction: "up" },
    bench: { lift: "bench", nowKg: 50, state: "measured", basis: null, basisDay: "2026-11-25", hardSessions6w: 4, trendPerWeek: 0.002, direction: "up" },
    deadlift: { lift: "deadlift", nowKg: 122, state: "measured", basis: null, basisDay: "2026-11-23", hardSessions6w: 3, trendPerWeek: 0.003, direction: "up" },
  }),
  loadCompetitionContext: async () => ({ ctx: { competition: { rules: { incrementKg: 2.5 } } } }),
}));
vi.mock("@/lib/competition/brief", () => ({
  buildBrief: () => ({
    forecast: {
      lifts: {
        squat: { range: { conservative: 100, expected: 105, high: 107.5 } },
        bench: { range: { conservative: 50, expected: 52.5, high: 55 } },
        deadlift: { range: { conservative: 125, expected: 130, high: 135 } },
      },
      total: { conservative: 275, expected: 287.5, high: 297.5 },
      confidence: "medium",
    },
    watch: [],
  }),
}));
vi.mock("@/lib/pain/load", () => ({ loadPainEntries: async () => new Map() }));
vi.mock("@/lib/pain/history", () => ({ buildPainHistory: () => ({ flagged: [] }) }));
const pushed: any[] = [];
vi.mock("@/lib/push/message-push.server", () => ({ pushNewMessage: async (_a: any, m: any) => void pushed.push(m) }));
let quietNow = false;
vi.mock("@/lib/push/push.server", () => ({
  localHour: () => 12,
  quietEndsAt: () => new Date(Date.now() + 3 * 3600_000),
}));

const CLIENT = "client-1";
const COACH_USER = "coach-user-1";
const COMP = "comp-1";
const SESSION = "session-1";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let tables: Record<string, any[]>;
let db: any;

function makeDb() {
  const base = memorySb(tables);
  return {
    ...base,
    // the database's own picks of what hasn't been read (goal_intel_meetings_to_scan / _checkins_to_scan)
    rpc: async (fn: string) => {
      if (fn === "goal_intel_meetings_to_scan")
        return {
          data: tables.coaching_sessions
            .filter((s) => s.analysis_status === "ready" && !tables.client_goal_sources.some((x) => x.source_kind === "meeting" && x.source_id === s.id && x.scanned_at >= s.updated_at))
            .map((s) => ({ id: s.id, updated_at: s.updated_at })),
          error: null,
        };
      if (fn === "goal_intel_checkins_to_scan") return { data: [], error: null };
      return { data: null, error: null };
    },
    from: (t: string) => {
      const q: any = base.from(t);
      // as Supabase does: what a read hands back is a copy, never the stored row itself
      const then = q.then.bind(q);
      q.then = (ok: any, bad: any) => then((r: any) => (ok ? ok({ ...r, data: r.data == null ? r.data : JSON.parse(JSON.stringify(r.data)) }) : r), bad);
      // jsonb containment as Postgres does it (the outbox finds a message it already sent by its outbox id)
      q.contains = (c: string, v: any) => {
        const want = typeof v === "string" ? JSON.parse(v) : v;
        (q as any).filters.push((r: any) => Array.isArray(want) && want.every((w: any) => (Array.isArray(r[c]) ? r[c] : []).some((a: any) => Object.entries(w).every(([k, x]) => a?.[k] === x))));
        return q;
      };
      if (t !== "client_goals") return q;
      const insert = q.insert.bind(q);
      q.insert = (row: any) => {
        // as the database does: one open goal per identity, and the column defaults
        if (tables.client_goals.some((g) => g.client_id === row.client_id && g.dedupe_key === row.dedupe_key && ["proposed", "active"].includes(g.status))) {
          return { select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } }) }) };
        }
        return insert({ version: 1, recommendation_status: "none", client_facing: true, tentative: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row });
      };
      return q;
    },
  };
}

beforeEach(() => {
  pushed.length = 0;
  quietNow = false;
  tables = {
    clients: [{ id: CLIENT, user_id: "client-user-1", first_name: "Ana", preferred_name: null, full_name: "Ana Example", preferred_weight_unit: "lb", timezone: "America/Winnipeg", sex: "F", intake_training_experience: "3 years", last_active_at: iso(2 * 3600_000), assigned_coach_id: "coach-row-1", service_tier: "coaching", archived: false }],
    coaches: [{ id: "coach-row-1", user_id: COACH_USER }],
    competitions: [{ id: COMP, client_id: CLIENT, name: "Winter Open", meet_date: "2026-12-05", status: "upcoming", live_at: null, results: null }],
    coaching_sessions: [
      {
        id: SESSION,
        client_id: CLIENT,
        competition_id: COMP,
        event: { kind: "competition", title: "Winter Open", date: "2026-12-05" },
        analysis_status: "ready",
        updated_at: iso(60_000),
        scheduled_at: null,
        created_at: iso(3600_000),
        live: { notes: "Ana is thinking for thirds:\n\nsquat 220 - 225\n\nbench 110-115\n\ndeadlift 264 - 280\n\nWant to hit top end don't care about going 9/9 " },
        analysis: {
          items: [
            { kind: "goal", text: "Ana is thinking her squat third attempt will be around 220 to 225.", quote: "basically for squats, I think I'm gonna hit 222 25", speaker: "athlete", due: "2026-12-05", basis: "confirmed" },
            { kind: "goal", text: "Ana is thinking her bench third attempt will be around 110 to 115.", quote: "bench. I think I'm gonna hit like 110, maybe 115", speaker: "athlete", due: "2026-12-05", basis: "tentative" },
            { kind: "goal", text: "Ana is thinking her deadlift third attempt will be around 264 to 280.", quote: "deadlift like anywhere from like 264 to like 280", speaker: "athlete", due: "2026-12-05", basis: "confirmed" },
            { kind: "goal", text: "Ana wants to push the top end at the meet rather than make 9/9 the main goal.", quote: "I want to hit top end. I don't care nine for nine", speaker: "athlete", due: "2026-12-05", basis: "confirmed" },
            { kind: "concern", text: "Incomplete workout logs", quote: "x", speaker: "coach", due: null, basis: "confirmed" },
          ],
          intelligence: [
            { kind: "goal", text: "Ana still wants to get stronger and feels drawn back toward strength.", quote: "now I like crave being strong again", permanence: "lasting" },
            { kind: "goal", text: "Ana wants to keep growing muscle while also getting stronger.", quote: "I still wanna like grow and get stronger", permanence: "lasting" },
            { kind: "preference", text: "Ana prefers morning or afternoon training.", quote: "I hate training in the evening", permanence: "lasting" },
          ],
        },
      },
    ],
    client_goals: [],
    client_goal_events: [],
    client_goal_sources: [],
    client_update_outbox: [],
    messages: [],
    app_sessions: [],
    push_notification_preferences: [],
    app_settings: [{ key: "goal_updates", value: JSON.stringify({ review_minutes: 30, auto_send: true }) }],
    pl_scheduled_workouts: [],
    pl_day_completions: [],
    progress_bodyweight: [],
    progress_metrics: [],
    client_goals_setup: [],
    business_owners: [],
  };
  db = makeDb();
});

const goals = () => tables.client_goals.filter((g) => g.status === "proposed" || g.status === "active");
const lift = (l: string) => tables.client_goals.find((g) => g.kind === "lift" && g.lift === l && ["proposed", "active"].includes(g.status));

describe("goals from a meeting", () => {
  it("reads every target said, once, with the unit from their training, all proposed", async () => {
    const { extractFromMeeting } = await import("@/lib/goal-intel/goals.server");
    const r = await extractFromMeeting(db, SESSION);
    expect(r.created).toBe(6);
    expect(goals().every((g) => g.status === "proposed")).toBe(true);
    const sq = lift("squat");
    expect(sq).toMatchObject({ client_value: 220, client_value_max: 225, client_unit: "lb", client_unit_source: "inferred", competition_id: COMP, deadline: "2026-12-05", title: "Squat third attempt · Winter Open", source_kind: "meeting", source_speaker: "athlete" });
    expect(sq.source_quote).toBe("basically for squats, I think I'm gonna hit 222 25");
    expect(sq.source_context).toMatch(/lb fits their training numbers/);
    expect(lift("bench")).toMatchObject({ client_value: 110, client_value_max: 115, tentative: true });
    expect(lift("deadlift")).toMatchObject({ client_value: 264, client_value_max: 280 });
    // the coach's notes said the same numbers: no second goal
    expect(tables.client_goals.filter((g) => g.kind === "lift")).toHaveLength(3);
    expect(tables.client_goals.find((g) => g.kind === "preference")).toMatchObject({ competition_id: COMP, client_facing: false });
    expect(tables.client_goals.filter((g) => g.kind === "physique")).toHaveLength(1);
    expect(tables.client_goals.filter((g) => g.kind === "performance")).toHaveLength(1);
    // the morning-training preference isn't a goal
    expect(tables.client_goals.some((g) => /morning/.test(g.client_text ?? ""))).toBe(false);
    // read again: nothing new
    const again = await extractFromMeeting(db, SESSION);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: true });
    // her name never becomes part of a goal's identity
    expect(tables.client_goals.every((g) => !/ana/.test(g.dedupe_key))).toBe(true);
  });

  it("reads each proposed goal against the meet forecast and recommends the top end she asked for", async () => {
    const { extractFromMeeting, assessClient } = await import("@/lib/goal-intel/goals.server");
    await extractFromMeeting(db, SESSION);
    await assessClient(db, CLIENT, { force: true });
    const sq = lift("squat");
    expect(sq.feasibility.projection).toMatchObject({ expectedKg: 105, source: "meet_forecast" });
    expect(sq.feasibility.score).toBeGreaterThanOrEqual(80);
    expect(sq.feasibility.recommended).toBe("high");
    expect(sq.feasibility.action.kind).toBe("approve");
    // her deadlift range tops out between the conservative and moderate scenarios: supported, room above
    expect(lift("deadlift").feasibility.score).toBeGreaterThanOrEqual(80);
    expect(tables.client_goals.find((g) => g.kind === "physique").feasibility.headline).toMatch(/Not scored/);
  });
});

describe("approving and telling the client", () => {
  async function approved() {
    const { extractFromMeeting, assessClient, decideGoal } = await import("@/lib/goal-intel/goals.server");
    await extractFromMeeting(db, SESSION);
    await assessClient(db, CLIENT, { force: true });
    await decideGoal(db, lift("squat").id, { action: "approve" }, { userId: COACH_USER, kind: "coach" });
    await decideGoal(db, lift("bench").id, { action: "approve", value: 115, unit: "lb" }, { userId: COACH_USER, kind: "coach" });
    return import("@/lib/goal-intel/goals.server");
  }

  it("approving makes the target, and related changes join one waiting update", async () => {
    await approved();
    expect(lift("squat")).toMatchObject({ status: "active", approved_value: 225, approved_unit: "lb", approved_by: COACH_USER, client_unit_source: "coach" });
    expect(lift("squat").approved_read).toMatchObject({ expectedKg: 105 });
    expect(tables.client_update_outbox).toHaveLength(1);
    const o = tables.client_update_outbox[0];
    expect(o.status).toBe("pending");
    expect(o.body).toBe("Hey Ana, quick update on your targets for Winter Open (Dec 5):\n• Squat: 225 lb\n• Bench: 115 lb\n\nYour training stays the same. Keep logging every set with its RPE so the attempts are called off real numbers.");
    expect(Date.parse(o.send_after) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(tables.client_goal_events.some((e) => e.action === "approved" && e.actor === "coach")).toBe(true);
  });

  it("waits out the window, waits while they're in the app or quiet, then sends once", async () => {
    const { deliverOutbox } = await approved();
    const o = tables.client_update_outbox[0];
    expect(await deliverOutbox(db, o.id)).toBe("pending");
    expect(o.wait_reason).toBe("window");
    o.send_after = iso(60_000);
    // presence unknown (no heartbeat on record): it waits, never treated as offline
    expect(await deliverOutbox(db, o.id)).toBe("pending");
    expect(o.wait_reason).toBe("presence_unknown");
    // in the app right now
    tables.app_sessions.push({ user_id: "client-user-1", last_seen_at: iso(30_000) });
    expect(await deliverOutbox(db, o.id)).toBe("pending");
    expect(o.wait_reason).toBe("online");
    // offline, but their quiet hours
    tables.app_sessions[0].last_seen_at = iso(40 * 60_000);
    tables.clients[0].last_active_at = iso(41 * 60_000);
    tables.push_notification_preferences.push({ user_id: "client-user-1", quiet_hours_enabled: true, quiet_start: 11, quiet_end: 13, timezone: "America/Winnipeg" });
    expect(await deliverOutbox(db, o.id)).toBe("pending");
    expect(o.wait_reason).toBe("quiet");
    // offline and not quiet: sent, once
    tables.push_notification_preferences[0].quiet_hours_enabled = false;
    expect(await deliverOutbox(db, o.id)).toBe("sent");
    expect(tables.messages).toHaveLength(1);
    expect(tables.messages[0]).toMatchObject({ client_id: CLIENT, sender_id: COACH_USER, is_automated: true, message_type: "Goals", attachments: [{ kind: "goal_update", outbox_id: o.id, automatic: true }] });
    expect(pushed).toHaveLength(1);
    expect(o.status).toBe("sent");
    expect(await deliverOutbox(db, o.id)).toBe("sent");
    expect(tables.messages).toHaveLength(1);
    expect(tables.client_goal_events.filter((e) => e.action === "client_told")).toHaveLength(2);
    void quietNow;
  });

  it("drops a change the coach took back, and sends nothing when nothing's left", async () => {
    const { decideGoal, deliverOutbox } = await approved();
    const o = tables.client_update_outbox[0];
    await decideGoal(db, lift("bench").id, { action: "dismiss" }, { userId: COACH_USER, kind: "coach" });
    o.send_after = iso(60_000);
    tables.app_sessions.push({ user_id: "client-user-1", last_seen_at: iso(40 * 60_000) });
    tables.clients[0].last_active_at = iso(41 * 60_000);
    expect(await deliverOutbox(db, o.id)).toBe("sent");
    expect(tables.messages[0].body).toContain("Squat: 225 lb");
    expect(tables.messages[0].body).not.toContain("Bench");
  });

  it("the coach's own words are kept: a newer change after an edit holds it for them", async () => {
    const { outboxAction, decideGoal } = await approved();
    const o = tables.client_update_outbox[0];
    await outboxAction(db, o.id, { action: "edit", body: "Ana, new thirds: squat 225, bench 115. Same training." }, { userId: COACH_USER, kind: "coach" });
    expect(o.body).toBe("Ana, new thirds: squat 225, bench 115. Same training.");
    await decideGoal(db, lift("deadlift").id, { action: "approve" }, { userId: COACH_USER, kind: "coach" });
    expect(o.status).toBe("held");
    expect(o.hold_reason).toBe("changed_after_edit");
    expect(o.body).toBe("Ana, new thirds: squat 225, bench 115. Same training.");
  });

  it("send now is the coach's call: no window, no presence check, still only what's current", async () => {
    const { outboxAction } = await approved();
    const o = tables.client_update_outbox[0];
    const r = await outboxAction(db, o.id, { action: "send_now" }, { userId: COACH_USER, kind: "coach" });
    expect(r.status).toBe("sent");
    // a prepared update, never a reply that closes their check-ins: the attachment says the coach sent it
    expect(tables.messages[0]).toMatchObject({ is_automated: true, attachments: [{ kind: "goal_update", automatic: false }] });
    expect(o.sent_by).toBe(COACH_USER);
  });

  it("a recommendation to change the programming only hands its words over; nothing writes a program", async () => {
    const { decideRecommendation } = await approved();
    const sq = lift("squat");
    sq.recommendation = { kind: "adjust_program", line: "Adjust programming", suggestedKg: null, approach: null, benefit: null, key: "adjust_program::" };
    sq.recommendation_status = "open";
    const writesBefore = (db.writes as any[]).filter((w) => w.table.startsWith("pl_")).length;
    const out = await decideRecommendation(db, sq.id, { action: "approve" }, { userId: COACH_USER, kind: "coach" });
    expect(out.handoff).toMatch(/approved target is 225 lb/);
    expect(out.handoff).toMatch(/smallest change/);
    expect((db.writes as any[]).filter((w) => w.table.startsWith("pl_")).length).toBe(writesBefore);
    expect(lift("squat").recommendation_status).toBe("approved");
  });
});

describe("goal settings in app_settings", () => {
  it("reads the text column's JSON, an object, or nothing", async () => {
    const { settingJson } = await import("@/lib/goal-intel/goals.server");
    // production stores app_settings.value as text holding JSON
    expect(settingJson('{"review_minutes":45,"auto_send":false}')).toEqual({ review_minutes: 45, auto_send: false });
    expect(settingJson({ messages_at: "2026-11-26T00:00:00Z" })).toEqual({ messages_at: "2026-11-26T00:00:00Z" });
    expect(settingJson(null)).toEqual({});
    expect(settingJson("not json")).toEqual({});
    expect(settingJson("[1,2]")).toEqual({});
  });

  it("the review window and auto-send read from the stored text", async () => {
    const { readUpdateSettings } = await import("@/lib/goal-intel/goals.server");
    const db = memorySb({ app_settings: [{ key: "goal_updates", value: '{"review_minutes":3,"auto_send":false}' }] } as any);
    // clamped to the 5-minute floor; off means the coach sends it
    expect(await readUpdateSettings(db as any)).toEqual({ reviewMinutes: 5, autoSend: false });
  });
});

/* The review of Nov 26 2026: the outbox and the ledger's writes, end to end. */
describe("review fixes: the waiting update", () => {
  async function approvedOffline() {
    const g = await import("@/lib/goal-intel/goals.server");
    await g.extractFromMeeting(db, SESSION);
    await g.assessClient(db, CLIENT, { force: true });
    await g.decideGoal(db, lift("squat").id, { action: "approve" }, { userId: COACH_USER, kind: "coach" });
    tables.app_sessions.push({ user_id: "client-user-1", last_seen_at: iso(40 * 60_000) });
    tables.clients[0].last_active_at = iso(41 * 60_000);
    return g;
  }

  it("the coach's Hold survives a newer approval, and the held update never goes by itself", async () => {
    const { outboxAction, decideGoal, deliverOutbox } = await approvedOffline();
    const o = tables.client_update_outbox[0];
    await outboxAction(db, o.id, { action: "hold" }, { userId: COACH_USER, kind: "coach" });
    await decideGoal(db, lift("bench").id, { action: "approve", value: 115, unit: "lb" }, { userId: COACH_USER, kind: "coach" });
    expect(o).toMatchObject({ status: "held", hold_reason: "coach" });
    expect(o.body).toContain("Bench: 115 lb");
    o.send_after = iso(60_000);
    expect(await deliverOutbox(db, o.id)).toBe("held");
    expect(tables.messages).toHaveLength(0);
  });

  it("a send left half done never blocks the next approval, and is picked up again without sending twice", async () => {
    const { decideGoal, recoverStaleSending } = await approvedOffline();
    const o = tables.client_update_outbox[0];
    // the request was cut off right after claiming it
    Object.assign(o, { status: "sending", claimed_at: iso(20 * 60_000), updated_at: iso(20 * 60_000) });
    await decideGoal(db, lift("bench").id, { action: "approve", value: 115, unit: "lb" }, { userId: COACH_USER, kind: "coach" });
    const open = tables.client_update_outbox.filter((x) => x.status === "pending");
    expect(open).toHaveLength(1);
    // nothing went: the stuck one joins the newer update
    expect(await recoverStaleSending(db)).toBe(1);
    expect(o.status).toBe("cancelled");
    expect(open[0].changes.map((c: any) => c.lift).sort()).toEqual(["bench", "squat"]);
    expect(open[0].body).toContain("Squat: 225 lb");
  });

  it("a send whose message went but whose record didn't is marked sent, never sent again", async () => {
    const { recoverStaleSending } = await approvedOffline();
    const o = tables.client_update_outbox[0];
    Object.assign(o, { status: "sending", claimed_at: iso(20 * 60_000) });
    tables.messages.push({ id: "m-sent", client_id: CLIENT, attachments: [{ kind: "goal_update", outbox_id: o.id, automatic: true }] });
    await recoverStaleSending(db);
    expect(o).toMatchObject({ status: "sent", message_id: "m-sent" });
    expect(tables.messages).toHaveLength(1);
  });

  it("waits are never counted as failures; repeated send failures hand it to the coach", async () => {
    const { deliverOutbox } = await approvedOffline();
    const o = tables.client_update_outbox[0];
    o.send_after = iso(60_000);
    const failing = {
      ...db,
      from: (t: string) => {
        const q: any = db.from(t);
        if (t === "messages") q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "timeout" } }) }) });
        return q;
      },
    };
    for (let i = 0; i < 3; i++) {
      expect(await deliverOutbox(failing, o.id)).toBe("failed");
      if (o.status === "pending") o.next_attempt_at = null;
    }
    expect(o).toMatchObject({ status: "held", hold_reason: "send_failed", send_failures: 3 });
    expect(o.status_line).toMatch(/Send it yourself/);
  });

  it("the client saying a new number never cancels the approved update waiting for them", async () => {
    const { upsertCandidate, deliverOutbox } = await approvedOffline();
    const o = tables.client_update_outbox[0];
    const sq = lift("squat");
    const client = tables.clients[0];
    await upsertCandidate(db, client, { kind: "lift", lift: "squat", values: [230], unit: "lb", timing: "third", text: "squat third 230 lb", quote: "goal squat third 230 lb", tentative: false }, { sourceKind: "message", sourceId: "msg-new", sourceAt: new Date().toISOString(), speaker: "athlete", context: null, competitionId: COMP, eventTitle: "Winter Open", deadline: "2026-12-05" }, null);
    expect(lift("squat").client_value).toBe(230);
    expect(lift("squat").id).toBe(sq.id);
    o.send_after = iso(60_000);
    expect(await deliverOutbox(db, o.id)).toBe("sent");
    expect(tables.messages[0].body).toContain("Squat: 225 lb");
  });

  it("turning 'tell them' off and on is never news, and an approval the card didn't see is refused", async () => {
    const { decideGoal } = await approvedOffline();
    const before = tables.client_update_outbox.length;
    const ev = tables.client_goal_events.filter((e) => e.action === "client_update_queued").length;
    await decideGoal(db, lift("squat").id, { action: "client_facing", clientFacing: false }, { userId: COACH_USER, kind: "coach" });
    await decideGoal(db, lift("squat").id, { action: "client_facing", clientFacing: true }, { userId: COACH_USER, kind: "coach" });
    expect(tables.client_update_outbox).toHaveLength(before);
    expect(tables.client_goal_events.filter((e) => e.action === "client_update_queued").length).toBe(ev);
    const b = lift("bench");
    await expect(decideGoal(db, b.id, { action: "approve" }, { userId: COACH_USER, kind: "coach" }, { expectVersion: b.version + 5 })).rejects.toThrow(/changed since you opened it/);
  });
});

describe("review fixes: what's read for goals", () => {
  it("a goal in the analysis's words is kept as a goal but never sent to the client as a message", async () => {
    const { extractFromMeeting, decideGoal } = await import("@/lib/goal-intel/goals.server");
    await extractFromMeeting(db, SESSION);
    const phys = tables.client_goals.find((g) => g.kind === "physique");
    expect(phys.client_facing).toBe(false);
    await decideGoal(db, phys.id, { action: "approve" }, { userId: COACH_USER, kind: "coach" });
    expect(tables.client_update_outbox).toHaveLength(0);
  });

  it("a dismissed goal never comes back from the same meeting, even when its words are read again", async () => {
    const { extractFromMeeting, decideGoal } = await import("@/lib/goal-intel/goals.server");
    await extractFromMeeting(db, SESSION);
    await decideGoal(db, lift("squat").id, { action: "dismiss" }, { userId: COACH_USER, kind: "coach" });
    // the meeting is opened and touched: nothing to read
    tables.coaching_sessions[0].updated_at = new Date().toISOString();
    expect(await extractFromMeeting(db, SESSION)).toMatchObject({ unchanged: true });
    // its words change (a re-read): still not proposed again
    tables.coaching_sessions[0].analysis.items[1].text = "Ana is thinking her bench third attempt will be around 112 to 115.";
    await extractFromMeeting(db, SESSION);
    expect(lift("squat")).toBeUndefined();
  });

  it("a coach's note never rewrites the client's own number, and an older source never replaces a newer one", async () => {
    const { upsertCandidate, extractFromMeeting } = await import("@/lib/goal-intel/goals.server");
    await extractFromMeeting(db, SESSION);
    const client = tables.clients[0];
    const meta = { sourceKind: "meeting" as const, competitionId: COMP, eventTitle: "Winter Open", deadline: "2026-12-05", context: null };
    const cand = (v: number) => ({ kind: "lift" as const, lift: "squat" as const, values: [v], unit: "lb" as const, timing: "third" as const, text: `squat ${v}`, quote: `squat ${v}`, tentative: false });
    expect(await upsertCandidate(db, client, cand(240), { ...meta, sourceId: "s-notes", sourceAt: new Date().toISOString(), speaker: "coach" }, null)).toBe("same");
    expect(lift("squat").client_value).toBe(220);
    expect(await upsertCandidate(db, client, cand(200), { ...meta, sourceId: "s-old", sourceAt: iso(400 * 86_400_000), speaker: "athlete" }, null)).toBe("same");
    expect(lift("squat").client_value).toBe(220);
  });

  it("a message the app made for them (a workout note, a pain card) is never read as a goal", async () => {
    const { isCardMessage } = await import("@/lib/goal-intel/goals.server");
    expect(isCardMessage({ body: "📝 Competition Bench: hit 100 for a triple", attachments: [{ kind: "workout_note" }] })).toBe(true);
    expect(isCardMessage({ body: "Goal is to bench 100 kg at nationals", attachments: [] })).toBe(false);
  });
});
