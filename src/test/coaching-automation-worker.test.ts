/**
 * The worker end to end against an in-memory database (scripts/replay/memory-sb.ts):
 * claim → read the records → decide → draft → route → send, for workout reviews,
 * weekly check-ins and missed sessions. Model calls and pushes are stubbed; the
 * routing rules, the checks and the writes are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memorySb } from "../../scripts/replay/memory-sb";

const calls: { system: string; prompt: string }[] = [];
/** Runs while the model is "writing" (to change the world under the worker). */
let duringDraft: (() => void) | null = null;
let modelReply = "nice work today. that deadlift moved well, keep the same setup next week";
const pushes: string[] = [];
let modes: Record<string, string[]> = {};
let dated: any[] = [];

vi.mock("@/lib/ai/route-call.server", () => ({
  askRoute: async (_route: string, req: { system: string; prompt: string }) => {
    calls.push({ system: req.system, prompt: req.prompt });
    duringDraft?.();
    return { text: JSON.stringify({ message: modelReply }), model: "test-model" };
  },
}));
vi.mock("@/lib/cleo-capabilities.server", () => ({ userHasFeature: async () => true }));
vi.mock("@/lib/coach-voice.functions", () => ({ voicePromptForClient: async () => "HOW IT SOUNDS: Jared's voice" }));
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: async (_a: any, _u: string, p: { title: string }) => void pushes.push(p.title) }));
vi.mock("@/lib/push/message-push.server", () => ({ pushNewMessage: async () => undefined }));
vi.mock("@/lib/cleo-schedule.server", () => ({ loadDatedWorkouts: async () => dated }));

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const COACH_ROW = "c0a0";
const MARC = "c1e01";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const dayIn = (tz: string, offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));

let tables: Record<string, any[]>;
let db: any;

function makeDb() {
  const base = memorySb(tables);
  return {
    ...base,
    // as the database does: a new item gets created_at, and its dedupe key is unique
    from: (t: string) => {
      const q: any = base.from(t);
      if (t !== "coach_automation_items") return q;
      const insert = q.insert.bind(q);
      q.insert = (row: any) => {
        if (tables.coach_automation_items.some((i) => i.dedupe_key === row.dedupe_key)) {
          return { select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } }) }) };
        }
        return insert({ created_at: new Date().toISOString(), ...row });
      };
      return q;
    },
    rpc: async (fn: string, args: any) => {
      if (fn === "coach_automation_claim") {
        const it = tables.coach_automation_items.find((i) => i.status === "queued" && (!args._id || i.id === args._id));
        if (!it) return { data: [], error: null };
        Object.assign(it, { status: "working", locked_at: new Date().toISOString(), attempts: (it.attempts ?? 0) + 1 });
        return { data: [{ ...it }], error: null };
      }
      if (fn === "coach_automation_mode_for") {
        const list = modes[args._category] ?? ["approval"];
        return { data: list.length > 1 ? list.shift() : list[0], error: null };
      }
      if (fn === "community_workout_stats_cached") {
        return {
          data: {
            workout_name: "Deadlift Strength + Posterior Chain",
            workout_title: "Block 1 · Week 2",
            prs: [{ exercise_name: "Conventional Deadlift", load_kg: 142.8816, reps: 5, unit: "lb" }],
            top_lift: { exercise_name: "Conventional Deadlift", load_kg: 142.8816, reps: 5, unit: "lb" },
            working_sets: 13,
            duration_min: 68,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
}

function queue(category: string, sourceId: string, extra: Record<string, unknown> = {}) {
  const item: Record<string, any> = { id: `item-${category}-${sourceId}`, coach_user_id: OWNER, client_id: MARC, category, dedupe_key: `${category}:${sourceId}`, source_kind: "x", source_id: sourceId, parent_id: null, regions: [], status: "queued", mode: null, risk: null, risk_reasons: [], attempts: 0, context: null, draft: null, message_id: null, sent_at: null, locked_at: null, decided_by: null, due_at: iso(60_000), ...extra };
  tables.coach_automation_items.push(item);
  return item;
}

beforeEach(() => {
  calls.length = 0;
  pushes.length = 0;
  modes = {};
  dated = [];
  duringDraft = null;
  modelReply = "nice work today. that deadlift moved well, keep the same setup next week";
  tables = {
    clients: [{ id: MARC, user_id: "u-marc", full_name: "Marc Asugui", preferred_name: null, timezone: "America/Winnipeg", service_tier: "coaching", archived: false, assigned_coach_id: COACH_ROW, status: "Active" }],
    coaches: [{ id: COACH_ROW, user_id: OWNER, status: "Active", archived: false }],
    pl_workout_feedback: [],
    pl_days: [{ id: "day1", title: "Day 2", subtitle: "Deadlift Strength + Posterior Chain" }],
    pl_day_completions: [{ id: "comp1", day_id: "day1", client_id: MARC, scheduled_workout_id: null, completed_at: iso(10 * 60_000) }],
    pl_exercise_rows: [{ id: "row1", day_id: "day1", sets: 3, reps_text: "5", rpe: "7", rir: null, measurement_type: null, tracking_type: null, exercise_name_override: null, cardio_target_id: null, exercises: { name: "Conventional Deadlift" } }],
    pl_row_results: [1, 2, 3].map((n) => ({ row_id: "row1", client_id: MARC, set_index: n, actual_reps: 5, actual_rpe: 7, actual_rpe_num: 7, completed_at: iso(20 * 60_000), is_working_set: true, scheduled_workout_id: null })),
    pain_reports: [],
    messages: [],
    messenger_checkins: [],
    coach_automation_items: [],
    coach_automation_events: [],
  };
  db = makeDb();
});

async function tick() {
  const { runAutomationTick } = await import("@/lib/recovery-automation/run.server");
  return runAutomationTick(db, { budgetMs: 5_000 });
}

describe("workout reviews", () => {
  const review = (note: string | null, rating = 4) =>
    tables.pl_workout_feedback.push({ id: "fb1", client_id: MARC, completion_id: "comp1", day_id: "day1", overall_rating: rating, session_rpe: 8, pain: false, client_note: note, created_at: iso(5 * 60_000), review_updated_by: "u-marc" });

  it("a routine one goes by itself when he chose that, from what the records say", async () => {
    review("felt strong today, top set flew");
    modes.workout_reply = ["automatic"];
    const item = queue("workout_reply", "fb1");
    const r = await tick();
    expect(r.processed[0].outcome).toBe("sent");
    expect(item.status).toBe("sent");
    const msg = tables.messages[0];
    expect(msg).toMatchObject({ client_id: MARC, sender_id: OWNER, is_automated: true, message_type: "Training", body: modelReply });
    expect(msg.attachments[0]).toMatchObject({ kind: "recovery_auto", item_id: item.id, category: "workout_reply", automatic: true });
    expect(calls[0].system).toContain("SENT AUTOMATICALLY");
    expect(calls[0].prompt).toContain("New all-time records today: Conventional Deadlift 315 lb × 5");
    expect(calls[0].prompt).toContain("Against the plan: done as planned");
    expect(calls[0].prompt).toContain('What they wrote: "felt strong today, top set flew"');
    expect(pushes).toEqual([]);
  });

  it("a question waits for him, without a second push (the review already pushed)", async () => {
    review("should I add weight to the deadlift next week?");
    modes.workout_reply = ["automatic"];
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.risk).toBe("review");
    expect(item.risk_reasons).toContain("question");
    expect(tables.messages).toEqual([]);
    expect(pushes).toEqual([]);
    expect(calls[0].system).not.toContain("SENT AUTOMATICALLY");
  });

  it("words that may need medical help are urgent and push him", async () => {
    review("got dizzy after the last set and nearly passed out");
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.risk).toBe("urgent");
    expect(item.status).toBe("awaiting_approval");
    expect(pushes).toEqual(["Marc needs you"]);
  });

  it("a review whose pain gets its own reply, one he already answered, or one with nothing to say gets none", async () => {
    review("knee felt off");
    tables.pain_reports.push({ id: "p1", feedback_id: "fb1", client_id: MARC });
    const a = queue("workout_reply", "fb1");
    await tick();
    expect(a.status).toBe("cancelled");

    tables.pain_reports.length = 0;
    tables.messages.push({ id: "m1", client_id: MARC, sender_role: "admin", is_automated: false, is_internal_note: false, deleted_at: null, created_at: iso(60_000) });
    const b = queue("workout_reply", "fb1", { id: "item-b" });
    await tick();
    expect(b.status).toBe("cancelled");
    expect(b.why).toMatch(/written to them/);

    tables.messages.length = 0;
    tables.pl_workout_feedback[0].client_note = "good";
    const c = queue("workout_reply", "fb1", { id: "item-c" });
    await tick();
    expect(c.status).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("a review a coach wrote for them in View as client is never answered", async () => {
    review("logged from his paper sheet");
    tables.pl_workout_feedback[0].review_updated_by = OWNER;
    modes.workout_reply = ["automatic"];
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("a note with nothing to answer is marked, so the database can look again if they add to it", async () => {
    review("good");
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item).toMatchObject({ status: "cancelled", context: { not_useful: true } });
  });

  it("read again at the last moment: if he writes to them while it's being written, it waits for him", async () => {
    review("felt strong today, top set flew");
    modes.workout_reply = ["automatic"];
    duringDraft = () => tables.messages.push({ id: "m9", client_id: MARC, sender_role: "admin", is_automated: false, is_internal_note: false, deleted_at: null, created_at: new Date().toISOString() });
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.why).toMatch(/written to them yourself/);
    expect(tables.messages.filter((m) => m.sender_id === OWNER)).toEqual([]);
  });

  it("a failed read fails the item (tried again later), never reads as nothing there", async () => {
    review("felt strong today, top set flew");
    modes.workout_reply = ["automatic"];
    const realFrom = db.from;
    db.from = (t: string) => {
      const q = realFrom(t);
      if (t !== "pain_reports") return q;
      return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "timeout" } }) }) }) };
    };
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("failed");
    expect(tables.messages).toEqual([]);
  });

  it("switched off while it was being written: nothing goes", async () => {
    review("felt strong today, top set flew");
    modes.workout_reply = ["automatic", "off"];
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("cancelled");
    expect(tables.messages).toEqual([]);
  });
});

describe("weekly check-ins", () => {
  const checkin = (analysis: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    tables.messenger_checkins.push({ id: "ci1", client_id: MARC, status: "completed", ai_status: "ready", ai_analysis: { urgency: "normal", red_flags: [], summary: "solid week", wins: ["4 of 4 workouts"], suggested_response: "good week man. 4 for 4, keep the steps up and we push bench a little.", ...analysis }, answers: {}, submitted_at: iso(30 * 60_000), reviewed_at: null, superseded_at: null, ...extra });

  it("his own voice: the recap's reply as it is, waiting for him, no extra model call", async () => {
    checkin({});
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.draft).toBe("good week man. 4 for 4, keep the steps up and we push bench a little.");
    expect(calls).toEqual([]);
  });

  it("going by itself, a reply that claims he looked at something is rewritten first", async () => {
    checkin({ suggested_response: "just saw your check-in, 4 for 4. keep the steps up." });
    modes.checkin_reply = ["automatic"];
    modelReply = "4 for 4 this week, keep the steps up and we'll push bench a little";
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("START FROM:");
    expect(item.status).toBe("sent");
    expect(tables.messages[0]).toMatchObject({ body: modelReply, is_automated: true, message_type: "General" });
  });

  it("a request for help waits for him", async () => {
    checkin({}, { answers: { help: "struggling with protein on weekends" } });
    modes.checkin_reply = ["automatic"];
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.risk_reasons).toContain("help");
  });

  it("replied to by hand while the reply was being written: nothing goes", async () => {
    checkin({ suggested_response: "just saw your check-in, 4 for 4. keep the steps up." });
    modes.checkin_reply = ["automatic"];
    duringDraft = () => (tables.messenger_checkins[0].reviewed_at = new Date().toISOString());
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("cancelled");
    expect(tables.messages).toEqual([]);
  });

  it("an approval is read again too: one he already answered never goes", async () => {
    checkin({});
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    tables.messenger_checkins[0].reviewed_at = new Date().toISOString();
    const { stillGoes } = await import("@/lib/recovery-automation/run.server");
    expect(await stillGoes(db, item as any)).toEqual({ cancel: "You replied to the check-in yourself" });
  });

  it("a check-in more than three days old gets none", async () => {
    checkin({}, { submitted_at: iso(4 * 86_400_000) });
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("cancelled");
  });

  it("one he already replied to, or a newer check-in replaced, gets none", async () => {
    checkin({}, { reviewed_at: iso(1000) });
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(item.status).toBe("cancelled");
  });
});

describe("missed sessions", () => {
  // nothing trained or logged since yesterday unless a test says so
  beforeEach(() => {
    tables.pl_row_results = [];
    tables.pl_day_completions = [];
  });
  const yesterday = () => dayIn("America/Winnipeg", -1);
  const missedWorkout = (overrides: Record<string, unknown> = {}) => ({ clientId: MARC, dayId: "day9", entryId: null, date: yesterday(), time: null, title: "Upper A", focus: null, optional: false, visible: true, done: false, rating: null, ...overrides });

  it("the daily scan queues one check-in for a planned workout with nothing logged, once", async () => {
    dated = [missedWorkout()];
    tables.pl_day_completions = [];
    const { scanMissedSessions } = await import("@/lib/recovery-automation/run.server");
    expect(await scanMissedSessions(db)).toEqual({ looked: 1, queued: 1 });
    expect(await scanMissedSessions(db)).toEqual({ looked: 1, queued: 0 });
    const item = tables.coach_automation_items[0];
    expect(item).toMatchObject({ category: "missed_session", source_id: "day9", dedupe_key: `missed_session:${MARC}:${yesterday()}` });
    modelReply = "hey, no stress about upper yesterday. want to fit it in later this week or did something come up?";
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.risk).toBe("routine");
    expect(calls[0].prompt).toContain("Planned workout with nothing logged: Upper A");
    expect(pushes).toEqual([]);
  });

  it("nothing for an optional one, one they started, one they've trained since, or a paused client", async () => {
    const { scanMissedSessions } = await import("@/lib/recovery-automation/run.server");
    tables.pl_day_completions = [];
    dated = [missedWorkout({ optional: true })];
    expect((await scanMissedSessions(db)).queued).toBe(0);
    dated = [missedWorkout()];
    tables.pl_day_completions = [{ id: "c9", day_id: "day9", client_id: MARC, completed_at: null }];
    expect((await scanMissedSessions(db)).queued).toBe(0);
    tables.pl_day_completions = [{ id: "c8", day_id: "day8", client_id: MARC, completed_at: new Date().toISOString() }];
    expect((await scanMissedSessions(db)).queued).toBe(0);
    tables.pl_day_completions = [];
    tables.clients[0].status = "Paused";
    expect((await scanMissedSessions(db)).queued).toBe(0);
  });

  it("sets logged without a completion row (cardio on its own, a coach logging for them) aren't a miss", async () => {
    dated = [missedWorkout()];
    tables.pl_day_completions = [];
    tables.pl_exercise_rows.push({ id: "row9", day_id: "day9" });
    tables.pl_row_results.push({ row_id: "row9", client_id: MARC, set_index: 1, completed_at: iso(30 * 3_600_000) });
    const { scanMissedSessions } = await import("@/lib/recovery-automation/run.server");
    expect((await scanMissedSessions(db)).queued).toBe(0);
  });

  it("logged later, before he approves: not sent", async () => {
    dated = [missedWorkout()];
    tables.pl_day_completions = [];
    const { scanMissedSessions, stillGoes } = await import("@/lib/recovery-automation/run.server");
    await scanMissedSessions(db);
    const item = tables.coach_automation_items[0];
    await tick();
    expect(item.status).toBe("awaiting_approval");
    tables.pl_row_results.push({ row_id: "row1", client_id: MARC, set_index: 9, completed_at: new Date().toISOString() });
    expect(await stillGoes(db, item as any)).toEqual({ cancel: "They've trained since" });
  });

  it("a second miss in two weeks is a pattern: it waits for him even when routine ones send themselves", async () => {
    dated = [missedWorkout({ date: dayIn("America/Winnipeg", -5), dayId: "day5" }), missedWorkout()];
    tables.pl_day_completions = [];
    modes.missed_session = ["automatic"];
    const { scanMissedSessions } = await import("@/lib/recovery-automation/run.server");
    await scanMissedSessions(db);
    const item = tables.coach_automation_items[0];
    await tick();
    expect(item.risk).toBe("review");
    expect(item.status).toBe("awaiting_approval");
    expect(tables.messages).toEqual([]);
  });
});
