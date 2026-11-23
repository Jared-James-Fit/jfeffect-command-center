/**
 * The worker end to end against an in-memory database (scripts/replay/memory-sb.ts):
 * claim → read the records → decide → draft → route → send, for workout reviews,
 * weekly check-ins, missed sessions, set videos and progress check-ins. Model calls and pushes are stubbed; the
 * routing rules, the checks and the writes are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memorySb } from "../../scripts/replay/memory-sb";

const calls: { system: string; prompt: string }[] = [];
/** Runs while the model is "writing" (to change the world under the worker). */
let duringDraft: (() => void) | null = null;
let modelReply = "nice work today. that deadlift moved well, keep the same setup next week";
/** When set, the model "fails" with it (an outage, credits run out). */
let modelError: Error | null = null;
const pushes: string[] = [];
let modes: Record<string, string[]> = {};
let dated: any[] = [];
/** The workout's stats (community_workout_stats_cached): a block best by default, never a PR. */
let stats: any;
const defaultStats = (scope = "block") => ({
  workout_name: "Deadlift Strength + Posterior Chain",
  workout_title: "Block 1 · Week 2",
  prs: [{ exercise_name: "Conventional Deadlift", load_kg: 142.8816, reps: 5, unit: "lb", scope }],
  top_lift: { exercise_name: "Conventional Deadlift", load_kg: 142.8816, reps: 5, unit: "lb" },
  working_sets: 13,
  duration_min: 68,
});

vi.mock("@/lib/ai/route-call.server", () => ({
  askRoute: async (_route: string, req: { system: string; prompt: string }) => {
    calls.push({ system: req.system, prompt: req.prompt });
    if (modelError) throw modelError;
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
      if (fn === "community_workout_stats_cached") return { data: stats, error: null };
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
  stats = defaultStats();
  duringDraft = null;
  modelError = null;
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
    pl_set_videos: [],
    pl_set_video_analyses: [],
    progress_submissions: [],
    progress_media: [],
    progress_bodyweight: [],
    client_health_items: [],
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
    stats = defaultStats("atpr");
    modes.workout_reply = ["automatic"];
    const item = queue("workout_reply", "fb1");
    const r = await tick();
    expect(r.processed[0].outcome).toBe("sent");
    expect(item.status).toBe("sent");
    const msg = tables.messages[0];
    expect(msg).toMatchObject({ client_id: MARC, sender_id: OWNER, is_automated: true, message_type: "Training", body: modelReply });
    expect(msg.attachments[0]).toMatchObject({ kind: "recovery_auto", item_id: item.id, category: "workout_reply", automatic: true });
    expect(calls[0].system).toContain("SENT AUTOMATICALLY");
    expect(calls[0].prompt).toContain("Headline PR today (an all-time best for 5 reps on a main lift): Conventional Deadlift 315 lb × 5");
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

  it("a block best is never called a PR", async () => {
    review("felt strong today, top set flew");
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(calls[0].prompt).not.toMatch(/PR|all-time/);
  });

  it("a headline PR is worth a reply when they wrote nothing; an accessory's record isn't", async () => {
    review(null, 5);
    stats = defaultStats("atpr");
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item).toMatchObject({ status: "awaiting_approval", risk: "routine" });
    expect(calls[0].prompt).toContain("Headline PR today");
    expect(calls[0].prompt).not.toContain("What they wrote");
    expect(calls[0].system).toContain("when they wrote nothing, it's about the headline PR");

    calls.length = 0;
    stats = { ...defaultStats(), prs: [{ exercise_name: "Cable Lateral Raise", load_kg: 9, reps: 8, unit: "lb", scope: "atpr" }] };
    const other = queue("workout_reply", "fb1", { id: "item-acc" });
    await tick();
    expect(other).toMatchObject({ status: "cancelled", context: { not_useful: true } });
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

  it("a stand-in recap (the recap model didn't answer) is never his draft: a real one is written from their answers", async () => {
    // as Fionna's on Nov 23 2026: the template with her goal pasted into it
    checkin({
      summary: "Client check-in received. Review the answers below before replying.",
      wins: [],
      focus: ["Low energy"],
      goals: ["I hope to just get what I need to get done next week"],
      suggested_response: "good update. main focus this week is I hope to just get what I need to get done next week. keep me posted if anything changes and we\u2019ll adjust fast.",
    });
    modelReply = "sounds like a heavy week. lets keep it simple: get the sessions in and we'll go from there";
    const item = queue("checkin_reply", "ci1");
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).not.toContain("START FROM");
    expect(calls[0].prompt).not.toContain("Client check-in received");
    expect(calls[0].prompt).toContain("Goals for the week: I hope to just get what I need to get done next week");
    expect(item).toMatchObject({ status: "awaiting_approval", draft: modelReply });
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

describe("set videos", () => {
  const day = () => dayIn("America/Winnipeg");
  const video = (id: string, body: string, opts: Record<string, any> = {}) => {
    tables.messages.push({ id: `m-${id}`, client_id: MARC, sender_id: "u-marc", sender_role: "client", body, is_automated: false, is_internal_note: false, deleted_at: null, created_at: iso(opts.ago ?? 40 * 60_000) });
    tables.pl_set_videos.push({ id, client_id: MARC, message_id: `m-${id}`, origin: "set", exercise_name: "Competition Squat", label: "x", set_index: 1, warmup_id: null, deleted_at: null, created_at: iso(opts.ago ?? 40 * 60_000), ...opts.row });
  };

  it("one draft for the day's videos, from their numbers and bar speed, never sent by itself", async () => {
    video("v1", "Competition Squat · Top set · 140 kg × 3 @ RPE 7");
    video("v2", "Competition Squat · Backoff · 125 kg × 5 @ RPE 7");
    tables.pl_set_video_analyses.push({ set_video_id: "v1", reps: 3, set_mcv: 0.412, velocity_accepted: true, velocity_loss_pct: 14, status: "done" });
    // even a stored "automatic" (the database steps it down; here the worker is the last line)
    modes.video_reply = ["automatic"];
    modelReply = "got the videos. top set 140 x 3 @ 7 at 0.41 m/s and the backoffs held 125 for 5";
    const item = queue("video_reply", "v1", { context: { day: day() } });
    await tick();
    expect(item).toMatchObject({ status: "awaiting_approval", risk: "review", risk_reasons: ["needs_eyes_video"] });
    expect(item.context.video_ids).toEqual(["v1", "v2"]);
    expect(calls[0].prompt).toContain("Competition Squat · Top set · 140 kg × 3 @ RPE 7 · bar speed 0.41 m/s average over 3 reps, 14% slower by the last rep");
    expect(calls[0].prompt).toContain("Competition Squat · Backoff · 125 kg × 5 @ RPE 7");
    expect(calls[0].system).toContain("Never say how anything looked");
    expect(calls[0].system).not.toContain("SENT AUTOMATICALLY");
    expect(tables.messages.filter((m) => m.sender_id === OWNER)).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("a draft that says how it looked is written again, and flagged if it still does", async () => {
    video("v1", "Competition Squat · Top set · 140 kg × 3 @ RPE 7");
    modelReply = "squats looked clean today, depth was there";
    const item = queue("video_reply", "v1", { context: { day: day() } });
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("words it must never use");
    expect(item.status).toBe("awaiting_approval");
    expect(item.why).toMatch(/needs a look before it goes \(looked clean/);
  });

  it("nothing when the videos were removed, he's answered them, or only a coach sent one", async () => {
    video("v1", "Competition Squat · Top set", { row: { deleted_at: iso(60_000) } });
    const a = queue("video_reply", "v1", { context: { day: day() } });
    await tick();
    expect(a.status).toBe("cancelled");

    tables.pl_set_videos[0].deleted_at = null;
    tables.messages.push({ id: "reply", client_id: MARC, sender_id: OWNER, sender_role: "admin", is_automated: false, is_internal_note: false, deleted_at: null, created_at: iso(60_000) });
    const b = queue("video_reply", "v1", { id: "item-b", context: { day: day() } });
    await tick();
    expect(b.status).toBe("cancelled");
    expect(b.why).toMatch(/replied to them since/);

    tables.messages = tables.messages.filter((m) => m.id !== "reply");
    tables.messages[0].sender_role = "admin";
    tables.messages[0].sender_id = OWNER;
    const c = queue("video_reply", "v1", { id: "item-c", context: { day: day() } });
    await tick();
    expect(c.status).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("an approval is read again: every video removed by then, nothing goes", async () => {
    video("v1", "Competition Squat · Top set");
    const item = queue("video_reply", "v1", { context: { day: day() } });
    await tick();
    expect(item.status).toBe("awaiting_approval");
    tables.pl_set_videos[0].deleted_at = new Date().toISOString();
    const { stillGoes } = await import("@/lib/recovery-automation/run.server");
    expect(await stillGoes(db, item as any)).toEqual({ cancel: "The videos were removed" });
  });
});

describe("progress check-ins", () => {
  const submit = (extra: Record<string, any> = {}) => {
    tables.progress_submissions.push({ id: "ps1", client_id: MARC, user_id: "u-marc", owner_type: "client", review_status: "awaiting_review", reviewed_at: null, submitted_at: iso(15 * 60_000), submission_type: "photo", check_in_label: "Week 4 check-in", notes: null, ...extra });
    for (const angle of ["front", "side", "back"]) tables.progress_media.push({ submission_id: "ps1", angle, media_type: "photo", upload_status: "uploaded" });
    const today = dayIn("America/Winnipeg");
    const back = (n: number) => dayIn("America/Winnipeg", -n);
    for (const n of [1, 2, 3]) tables.progress_bodyweight.push({ user_id: "u-marc", logged_date: back(n), weight_value: 180, weight_unit: "lb" });
    for (const n of [29, 30, 31]) tables.progress_bodyweight.push({ user_id: "u-marc", logged_date: back(n), weight_value: 182, weight_unit: "lb" });
    return today;
  };

  it("drafted from the records only and waits for him; sending it is his review of it", async () => {
    submit();
    modelReply = "thanks for sending these. 7-day average is 180 lb, down 2 lb from four weeks ago, right where we want it";
    const item = queue("progress_reply", "ps1");
    await tick();
    expect(item).toMatchObject({ status: "awaiting_approval", risk: "review", risk_reasons: ["needs_eyes_progress"] });
    expect(calls[0].prompt).toContain("They sent: progress photos (front, side, back) for \"Week 4 check-in\"");
    expect(calls[0].prompt).toContain("Bodyweight, 7-day average: 180.0 lb");
    expect(calls[0].prompt).toContain("Four weeks ago (7-day average): 182.0 lb, so down 2.0 lb");
    expect(calls[0].prompt).toContain("This is their first progress check-in");
    expect(calls[0].system).toContain("Never comment on how they look");
    expect(pushes).toEqual([]);

    const { takeForSending, deliver } = await import("@/lib/recovery-automation/run.server");
    const taken = await takeForSending(db, { ...item, decided_by: OWNER } as any, item.draft);
    await deliver(db, taken as any, { approvedBy: OWNER, edited: false });
    expect(tables.progress_submissions[0]).toMatchObject({ review_status: "reviewed", reviewer_id: OWNER });
    expect(tables.messages.find((m) => m.sender_id === OWNER)).toMatchObject({ message_type: "General", is_automated: false });
  });

  it("an eating-disorder history keeps every body number out", async () => {
    submit();
    tables.client_health_items.push({ client_id: MARC, label: "Eating disorder (in recovery)", details: null, status: "active" });
    const item = queue("progress_reply", "ps1");
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(calls[0].prompt).toContain("Leave bodyweight and body numbers out entirely");
    expect(calls[0].prompt).not.toContain("7-day average");
  });

  it("none for one he's reviewed, one a coach uploaded for them, or one with nothing uploaded", async () => {
    submit({ review_status: "reviewed", reviewed_at: iso(60_000) });
    const a = queue("progress_reply", "ps1");
    await tick();
    expect(a.status).toBe("cancelled");

    Object.assign(tables.progress_submissions[0], { review_status: "awaiting_review", reviewed_at: null, user_id: OWNER });
    const b = queue("progress_reply", "ps1", { id: "item-b" });
    await tick();
    expect(b.status).toBe("cancelled");

    tables.progress_submissions[0].user_id = "u-marc";
    tables.progress_media.forEach((m) => (m.upload_status = "failed"));
    const c = queue("progress_reply", "ps1", { id: "item-c" });
    await tick();
    expect(c.status).toBe("cancelled");
    expect(calls).toEqual([]);
  });
});

describe("when AI is down", () => {
  const review = () =>
    tables.pl_workout_feedback.push({ id: "fb1", client_id: MARC, completion_id: "comp1", day_id: "day1", overall_rating: 4, session_rpe: 8, pain: false, client_note: "felt strong today, top set flew", created_at: iso(5 * 60_000), review_updated_by: "u-marc" });

  it("credits running out parks the item without using an attempt, sends nothing and writes no stand-in", async () => {
    review();
    modes.workout_reply = ["automatic"];
    modelError = new Error('No model answered (openai:gpt-5-mini: 429 {"error":{"message":"You have no credits remaining. Add credits to continue using the API","type":"insufficient_quota"}})');
    const item = queue("workout_reply", "fb1");
    const r = await tick();
    expect(r.processed[0].outcome).toBe("waiting for AI (credits)");
    expect(item).toMatchObject({ status: "queued", attempts: 0, draft: null, locked_at: null });
    expect(item.error).toBe("Waiting for AI: OpenAI credits ran out");
    expect(Date.parse(item.due_at) - Date.now()).toBeGreaterThan(10 * 60_000);
    expect(tables.messages).toEqual([]);
    expect(pushes).toEqual([]);
    expect(tables.coach_automation_events.filter((e) => e.item_id === item.id && e.kind === "queued")).toHaveLength(1);
  });

  it("checked again while it's still down: still parked, still no attempt used, one record of the wait", async () => {
    review();
    modelError = new Error("AI is paused: OpenAI says the account has no credits left.");
    const item = queue("workout_reply", "fb1", { error: "Waiting for AI: OpenAI credits ran out" });
    await tick();
    expect(item).toMatchObject({ status: "queued", attempts: 0 });
    expect(tables.coach_automation_events.filter((e) => e.item_id === item.id)).toHaveLength(0);
  });

  it("an outage parks it too; a bad draft is still a real failure the coach sees", async () => {
    review();
    modelError = new Error("openai:gpt-5.5: 503 {\"error\":\"overloaded\"}");
    const a = queue("workout_reply", "fb1");
    await tick();
    expect(a.status).toBe("queued");

    modelError = new Error("Couldn't write a draft. Try again.");
    a.due_at = iso(60_000);
    await tick();
    expect(a.status).toBe("failed");
    expect(a.error).toBe("Couldn't write a draft. Try again.");
  });

  it("once AI answers, the parked item is written from the records as they are and waits for his OK", async () => {
    review();
    modelError = new Error("no credits remaining");
    const item = queue("workout_reply", "fb1");
    await tick();
    expect(item.status).toBe("queued");
    modelError = null;
    item.due_at = iso(60_000);
    await tick();
    expect(item.status).toBe("awaiting_approval");
    expect(item.draft).toBe(modelReply);
    expect(tables.messages).toEqual([]);
  });
});
