/**
 * Coaching automation's worker (server only, service role; the
 * `coach-automation-tick` hook runs it every minute while something is due,
 * and once a day looks for missed sessions). Pain reports and their
 * follow-ups, workout reviews, weekly check-ins and missed sessions.
 * Each item is claimed once (`coach_automation_claim`), checked again against
 * the coach's capabilities and settings (never trusting what was true when it
 * was queued), drafted, then routed by its mode and risk:
 *
 *   manual            the draft waits in the client's pain sheet
 *   approval          queued for one tap; the coach is told
 *   automatic         routine reports are sent under the coach's name;
 *                     anything that could be an injury waits for him
 *
 * A sent reply plans its follow-up (owner: the evening before the next
 * session that loads the area; a paid plan: three days later), which is
 * checked again when it comes due. Every step goes on the record. A failure
 * leaves the athlete's report exactly as it was.
 */
import { classifyRecovery, followUpStillRelevant, localToInstant, planFollowUp, routeItem, type AutomationCategory, type Risk, type UpcomingSession } from "@/lib/recovery-automation/rules";
import { checkinReplyRead, messageTypeFor, missedSessionRead, pushesCoach, workoutReplyRead } from "@/lib/recovery-automation/categories";
import { userHasFeature } from "@/lib/cleo-capabilities.server";

type Item = {
  id: string;
  coach_user_id: string;
  client_id: string;
  category: AutomationCategory;
  dedupe_key: string;
  source_kind: string;
  source_id: string | null;
  parent_id: string | null;
  regions: string[];
  status: string;
  mode: string | null;
  risk: Risk | null;
  risk_reasons: string[];
  attempts: number;
  context: any;
  draft: string | null;
  message_id: string | null;
  sent_at: string | null;
  locked_at: string | null;
  decided_by: string | null;
};

export type TickResult = { id: string; outcome: string };

async function event(admin: any, item: Pick<Item, "id" | "coach_user_id" | "client_id">, kind: string, detail: Record<string, unknown> = {}, actor: string | null = null) {
  const { error } = await admin.from("coach_automation_events").insert({ item_id: item.id, coach_user_id: item.coach_user_id, client_id: item.client_id, kind, actor, detail });
  if (error) console.error("[recovery-automation] event not recorded", kind, error.message);
}

/**
 * A write only the run holding the item may make: the status it holds it in and
 * the moment it took it. A coach's Dismiss (or Pause, or an approval) in the
 * meantime moves the item on, and then nothing the run does afterwards lands.
 */
function held(q: any, item: Pick<Item, "id" | "status" | "locked_at">) {
  q = q.eq("id", item.id).eq("status", item.status);
  return item.locked_at ? q.eq("locked_at", item.locked_at) : q.is("locked_at", null);
}

/** Moves a held item on; false when it was taken away meanwhile (nothing was written). */
async function finish(admin: any, item: Item, status: string, patch: Record<string, unknown> = {}, why?: string): Promise<boolean> {
  const { data } = await held(
    admin.from("coach_automation_items").update({ status, locked_at: null, updated_at: new Date().toISOString(), ...(why ? { why: why.slice(0, 400) } : {}), ...patch }),
    item,
  )
    .select("id")
    .maybeSingle();
  return !!data;
}

async function cancel(admin: any, item: Item, why: string): Promise<TickResult> {
  if (!(await finish(admin, item, "cancelled", {}, why))) return { id: item.id, outcome: "taken away" };
  await event(admin, item, "cancelled", { why });
  return { id: item.id, outcome: `cancelled: ${why}` };
}

/** The item's message, when one already went (a run cut off after sending). */
async function sentMessage(admin: any, item: Pick<Item, "id" | "client_id">): Promise<string | null> {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("client_id", item.client_id)
    .contains("attachments", JSON.stringify([{ kind: "recovery_auto", item_id: item.id }]))
    .limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Takes a held item for one send: status `sending`, a fresh lock, the text that
 * will go. Nothing else (Dismiss, another run, a second approval) can touch it
 * after this, and a run cut off here is retried with exactly this text.
 */
export async function takeForSending(admin: any, item: Item, text: string, patch: Record<string, unknown> = {}): Promise<Item | null> {
  const { data } = await held(
    admin.from("coach_automation_items").update({ status: "sending", locked_at: new Date().toISOString(), draft: text, updated_at: new Date().toISOString(), ...patch }),
    item,
  )
    .select("*")
    .maybeSingle();
  return (data as Item) ?? null;
}

/** The client as the worker needs them, still this coach's active coaching client. */
async function loadClient(admin: any, item: Item) {
  const [{ data: client }, { data: coach }] = await Promise.all([
    admin.from("clients").select("id, user_id, full_name, preferred_name, timezone, service_tier, archived, assigned_coach_id").eq("id", item.client_id).maybeSingle(),
    admin.from("coaches").select("id, status, archived").eq("user_id", item.coach_user_id).maybeSingle(),
  ]);
  const ok = !!client && !!coach && client.assigned_coach_id === coach.id && client.service_tier === "coaching" && !client.archived && coach.status === "Active" && !coach.archived && !!client.user_id;
  return ok ? client : null;
}

function todayIn(tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The next ten days of workouts and whether each loads one of the regions (pain/sessions.ts PLAUSIBLE, or the exercise they named). */
async function upcomingSessions(admin: any, clientId: string, today: string, regions: string[], named: string[]): Promise<UpcomingSession[]> {
  const [{ loadDatedWorkouts }, { PLAUSIBLE }, { patternOf }] = await Promise.all([
    import("@/lib/cleo-schedule.server"),
    import("@/lib/pain/sessions"),
    import("@/lib/analytics/training-load"),
  ]);
  const workouts = (await loadDatedWorkouts(admin, { clientIds: [clientId], from: addDays(today, 1), to: addDays(today, 10) })).filter((w) => !w.done && w.visible && !w.optional);
  if (!workouts.length) return [];
  const dayIds = [...new Set(workouts.map((w) => w.dayId))];
  const { data: rows } = await admin.from("pl_exercise_rows").select("day_id, exercise_name_override, exercises(name)").in("day_id", dayIds).limit(2000);
  const names = new Map<string, string[]>();
  for (const r of (rows ?? []) as any[]) {
    const n = (r.exercise_name_override || r.exercises?.name || "").trim();
    if (n) names.set(r.day_id, [...(names.get(r.day_id) ?? []), n]);
  }
  const patterns = new Set(regions.flatMap((r) => PLAUSIBLE[r] ?? []));
  const namedLower = named.map((n) => n.toLowerCase());
  return workouts.map((w) => {
    const ex = names.get(w.dayId) ?? [];
    const loads = ex.some((n) => {
      const p = patternOf({ exercise: n, category: null, dbPattern: null, countsTowardVolume: true });
      return (p && patterns.has(p)) || namedLower.some((x) => x && n.toLowerCase().includes(x));
    });
    return { date: w.date, title: w.title, loads, exercises: ex };
  });
}

/**
 * Sends a taken item's text (status `sending`) in the client's coach chat as the
 * coach, tells the client, and plans the follow-up. Never twice: a message for
 * the item already in the chat is the send.
 */
export async function deliver(admin: any, item: Item, opts: { approvedBy: string | null; edited: boolean }): Promise<string> {
  if (item.status !== "sending" || !item.draft) throw new Error("Not taken for sending.");
  const text = item.draft;
  const now = new Date().toISOString();
  const automatic = !opts.approvedBy;
  const done = async (messageId: string) => {
    await held(admin.from("coach_automation_items").update({ status: "sent", message_id: messageId, sent_at: now, locked_at: null, updated_at: now }), item);
  };
  const already = await sentMessage(admin, item);
  if (already) {
    await done(already);
    return already;
  }
  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      client_id: item.client_id,
      sender_id: item.coach_user_id,
      sender_role: "admin",
      body: text,
      attachments: [{ kind: "recovery_auto", item_id: item.id, category: item.category, automatic }],
      message_type: messageTypeFor(item.category),
      is_internal_note: false,
      // sent by itself: it isn't the coach replying (his inbox still shows the report); approved: it is
      is_automated: automatic,
      delivery_status: "sent",
      sent_at: now,
      read_by_admin_at: now,
    })
    .select("id, client_id, sender_id, sender_role, is_internal_note, body, attachments")
    .single();
  if (error) throw new Error(`Message not sent: ${error.message}`);
  await done(msg.id);
  if (opts.edited) await event(admin, item, "edited", {}, opts.approvedBy);
  if (opts.approvedBy) await event(admin, item, "approved", {}, opts.approvedBy);
  await event(admin, item, "sent", { automatic, message_id: msg.id }, opts.approvedBy);
  // the pain sheet's "reviewed through" moves with a recovery message
  if (item.category === "recovery_reply" || item.category === "recovery_follow_up") {
    const { data: latest } = await admin.from("pain_reports").select("reported_at").eq("client_id", item.client_id).order("reported_at", { ascending: false }).limit(1).maybeSingle();
    await admin.from("pain_coach_reviews").insert({ client_id: item.client_id, kind: "used", through_at: latest?.reported_at ?? now, regions: item.regions, suggestion_keys: [], created_by: item.coach_user_id });
  }
  try {
    const { pushNewMessage } = await import("@/lib/push/message-push.server");
    await pushNewMessage(admin, msg);
  } catch (e: any) {
    console.error("[recovery-automation] push failed", e?.message);
  }
  if (item.category === "recovery_reply") await planItemFollowUp(admin, { ...item, status: "sent", sent_at: now }).catch((e) => console.error("[recovery-automation] follow-up not planned", e?.message));
  return msg.id;
}

/**
 * The worker's own send (automatic): taken first, then the coach's setting read
 * again right before it goes, so a Pause or a change of mode while it was being
 * written is honoured: off cancels it, anything but automatic asks him instead.
 */
async function sendAutomatically(admin: any, item: Item, text: string): Promise<TickResult> {
  const taken = await takeForSending(admin, item, text);
  if (!taken) return { id: item.id, outcome: "taken away" };
  const { data: mode } = await admin.rpc("coach_automation_mode_for", { _uid: item.coach_user_id, _client: item.client_id, _category: item.category });
  if (mode !== "automatic") {
    const status = mode === "off" || !mode ? "cancelled" : "awaiting_approval";
    await held(admin.from("coach_automation_items").update({ status, locked_at: null, updated_at: new Date().toISOString(), why: status === "cancelled" ? "Switched off while it was being written" : "Your setting changed while it was being written, so it waits for you" }), taken);
    await event(admin, item, status === "cancelled" ? "cancelled" : "awaiting_approval", { mode });
    return { id: item.id, outcome: status };
  }
  await deliver(admin, taken, { approvedBy: null, edited: false });
  return { id: item.id, outcome: "sent" };
}

async function planItemFollowUp(admin: any, item: Item) {
  const { data: mode } = await admin.rpc("coach_automation_mode_for", { _uid: item.coach_user_id, _client: item.client_id, _category: "recovery_follow_up" });
  if (!mode || mode === "off") return;
  const client = await loadClient(admin, item);
  if (!client) return;
  const today = todayIn(client.timezone);
  const trainingAware = await userHasFeature(admin, item.coach_user_id, "owner.training_aware");
  const named = ((item.context?.exercises as string[] | undefined) ?? []).filter(Boolean);
  const sessions = trainingAware ? await upcomingSessions(admin, client.id, today, item.regions, named) : [];
  const plan = planFollowUp({ after: new Date(), today, tz: client.timezone || "America/Winnipeg", trainingAware, sessions });
  if (!plan) return;
  const { data: row, error } = await admin
    .from("coach_automation_items")
    .insert({
      coach_user_id: item.coach_user_id,
      client_id: item.client_id,
      category: "recovery_follow_up",
      dedupe_key: `recovery_follow_up:${item.id}`,
      source_kind: "follow_up",
      source_id: item.source_id,
      parent_id: item.id,
      regions: item.regions,
      status: "queued",
      risk: item.risk,
      risk_reasons: item.risk_reasons,
      due_at: plan.dueAt.toISOString(),
      context: { session: plan.session ? { title: plan.session.title, date: plan.session.date } : null, reason: plan.reason, exercises: named },
    })
    .select("id")
    .maybeSingle();
  if (error && !/duplicate key/i.test(error.message)) throw error;
  if (row) await event(admin, { ...item, id: row.id }, "follow_up_planned", { due_at: plan.dueAt.toISOString(), reason: plan.reason, parent_id: item.id });
}

const PUSH_TITLE: Record<AutomationCategory, (first: string) => string> = {
  recovery_reply: (f) => `Reply to ${f} ready to approve`,
  recovery_follow_up: (f) => `Follow-up for ${f} to approve`,
  workout_reply: (f) => `Reply to ${f}'s workout ready to approve`,
  checkin_reply: (f) => `Reply to ${f}'s check-in ready to approve`,
  missed_session: (f) => `Check-in for ${f} to approve`,
};

async function tellCoach(admin: any, item: Item, risk: Risk, firstName: string) {
  // the client's own review or check-in already pushed him; only what could be serious pushes again
  if (!pushesCoach(item.category, risk)) return;
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const urgent = risk === "urgent";
    const pain = item.category === "recovery_reply" || item.category === "recovery_follow_up";
    await sendWebPushToUser(
      admin,
      item.coach_user_id,
      {
        title: urgent ? (pain ? `${firstName}'s pain report needs you` : `${firstName} needs you`) : PUSH_TITLE[item.category](firstName),
        body: urgent ? (pain ? "A warning sign came up. Open it to see the report and the reply." : "Something they wrote may need medical help. Open it to read it.") : "Tap to read it and send it.",
        url: `/admin/messages?recovery=${item.id}`,
        tag: `recovery-${item.id}`,
      },
      { category: "lift_reviews", eventKey: `recovery_item:${item.id}` } as any,
    );
  } catch (e: any) {
    console.error("[recovery-automation] coach push failed", e?.message);
  }
}

async function processReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const { data: rows } = await admin.from("pain_reports").select("*").eq("feedback_id", item.source_id).order("created_at");
  if (!rows?.length) return cancel(admin, item, "the pain came off their review");
  // a reply is about something they just said: never about a report two days old
  const newest = Math.max(...(rows as any[]).map((r) => Date.parse(r.reported_at ?? r.created_at)));
  if (Date.now() - newest > 2 * 86_400_000) return cancel(admin, item, "the report is too old to reply to now");
  const [{ entriesFromReports, buildPainHistory }, { loadPainEntries }, { redFlags }] = await Promise.all([
    import("@/lib/pain/history"),
    import("@/lib/pain/load"),
    import("@/lib/pain/safety"),
  ]);
  const focus = entriesFromReports(rows);
  const today = todayIn(client.timezone);
  const all = (await loadPainEntries(admin, [client.id], { tz: new Map([[client.id, client.timezone]]) })).get(client.id) ?? [];
  const history = buildPainHistory(all, today);
  const { risk, reasons } = classifyRecovery(focus, history.areas, redFlags(focus));
  let route = routeItem(mode as any, risk);
  if (route === "off") return cancel(admin, item, "switched off");
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writePainDraft } = await import("@/lib/pain/pain-draft.server");
  const draft = await writePainDraft(admin, { clientId: client.id, voice, automatic: route === "send", feedbackId: item.source_id, route: "recovery_write" });
  let why: string | null = null;
  if (route === "send" && draft.warnings.length) {
    route = "awaiting_approval";
    why = `The draft needs a look before it goes (${draft.warnings.join(", ")}).`;
  }
  const regions = [...new Set(focus.map((e) => e.region))];
  const { reportLine } = await import("@/lib/pain/report");
  const context = { reports: focus.map((e) => reportLine(e)), exercises: [...new Set(focus.map((e) => e.exerciseName).filter(Boolean))] };
  const next: Item = { ...item, regions, risk, risk_reasons: reasons, context, mode, draft: draft.message };
  const { data: kept } = await held(
    admin
      .from("coach_automation_items")
      .update({ regions, risk, risk_reasons: reasons, mode, draft: draft.message, insights: draft.insights, model: draft.model, context, updated_at: new Date().toISOString(), ...(why ? { why } : {}) }),
    item,
  )
    .select("id")
    .maybeSingle();
  if (!kept) return { id: item.id, outcome: "taken away" };
  await event(admin, item, "drafted", { risk, reasons, model: draft.model });
  if (route === "send") return sendAutomatically(admin, next, draft.message);
  if (route === "draft") {
    if (!(await finish(admin, next, "draft"))) return { id: item.id, outcome: "taken away" };
    await admin.from("pain_coach_reviews").insert({
      client_id: client.id,
      kind: "draft",
      through_at: history.latestAt,
      regions: history.flagged.map((a) => a.region),
      suggestion_keys: draft.used,
      draft: draft.message,
      insights: draft.insights,
      model: draft.model,
      created_by: item.coach_user_id,
    });
    return { id: item.id, outcome: "draft" };
  }
  if (!(await finish(admin, next, "awaiting_approval"))) return { id: item.id, outcome: "taken away" };
  await event(admin, item, risk === "urgent" ? "escalated" : "awaiting_approval", { risk, reasons });
  await tellCoach(admin, next, risk, draft.firstName);
  return { id: item.id, outcome: "awaiting_approval" };
}

async function processFollowUp(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  const { data: parent } = item.parent_id ? await admin.from("coach_automation_items").select("id, status, sent_at, message_id, risk").eq("id", item.parent_id).maybeSingle() : { data: null };
  if (!parent || parent.status !== "sent" || !parent.sent_at) return cancel(admin, item, "the reply it follows wasn't sent");
  const session = item.context?.session as { title: string | null; date: string } | null;
  const today = todayIn(client?.timezone ?? null);
  if (session && session.date < today) return cancel(admin, item, "their session has passed");
  const [{ data: later }, { data: coachMsgs }] = await Promise.all([
    admin.from("pain_reports").select("region, reported_at").eq("client_id", item.client_id).gt("reported_at", parent.sent_at).limit(50),
    admin
      .from("messages")
      .select("id")
      .eq("client_id", item.client_id)
      .eq("sender_role", "admin")
      .eq("is_automated", false)
      .eq("is_internal_note", false)
      .is("deleted_at", null)
      .gt("created_at", parent.sent_at)
      .neq("id", parent.message_id)
      .limit(1),
  ]);
  const verdict = followUpStillRelevant({
    regions: item.regions,
    replyAt: parent.sent_at,
    laterReports: ((later ?? []) as any[]).map((r) => ({ region: r.region, at: r.reported_at })),
    coachWroteSince: (coachMsgs ?? []).length > 0,
    clientActive: !!client,
  });
  if (verdict === "cancel") return cancel(admin, item, client ? "they reported that area again" : "not an active coaching client of this coach any more");
  const risk = (parent.risk as Risk) ?? "review";
  let route = routeItem(mode as any, risk);
  if (route === "off") return cancel(admin, item, "switched off");
  if (verdict === "ask" && route === "send") route = "awaiting_approval";
  if (route === "draft") route = "awaiting_approval";
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writePainDraft } = await import("@/lib/pain/pain-draft.server");
  const draft = await writePainDraft(admin, {
    clientId: item.client_id,
    voice,
    automatic: route === "send",
    route: "recovery_write",
    followUp: { regions: item.regions, session, repliedOn: String(parent.sent_at).slice(0, 10) },
  });
  let why = verdict === "ask" ? "You've written to them yourself since the reply, so this waits for you." : null;
  if (route === "send" && draft.warnings.length) {
    route = "awaiting_approval";
    why = `The draft needs a look before it goes (${draft.warnings.join(", ")}).`;
  }
  const next: Item = { ...item, mode, draft: draft.message, risk };
  const { data: kept } = await held(
    admin.from("coach_automation_items").update({ mode, draft: draft.message, insights: draft.insights, model: draft.model, updated_at: new Date().toISOString(), ...(why ? { why } : {}) }),
    item,
  )
    .select("id")
    .maybeSingle();
  if (!kept) return { id: item.id, outcome: "taken away" };
  await event(admin, item, "drafted", { model: draft.model, follow_up: true });
  if (route === "send") return sendAutomatically(admin, next, draft.message);
  if (!(await finish(admin, next, "awaiting_approval"))) return { id: item.id, outcome: "taken away" };
  await event(admin, item, "awaiting_approval", { follow_up: true });
  await tellCoach(admin, next, risk, draft.firstName);
  return { id: item.id, outcome: "awaiting_approval" };
}

// ── workout reviews, weekly check-ins, missed sessions ─────────────────────

/** Whether the coach has written to them himself (not automation, not a note to himself) since then. */
async function coachWroteSince(admin: any, clientId: string, since: string): Promise<boolean> {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("client_id", clientId)
    .neq("sender_role", "client")
    .eq("is_automated", false)
    .eq("is_internal_note", false)
    .is("deleted_at", null)
    .gt("created_at", since)
    .limit(1);
  return (data ?? []).length > 0;
}

const round = (n: number, step: number) => Math.round(n / step) * step;
function loadText(kg: unknown, unit: unknown): string | null {
  const k = Number(kg);
  if (!Number.isFinite(k) || k <= 0) return null;
  return unit === "lb" ? `${round(k * 2.20462262, 0.5)} lb` : `${round(k, 0.5)} kg`;
}

/** What the records say about a finished workout, one line each, for its reply. */
async function workoutFacts(admin: any, fb: any): Promise<string[]> {
  const [{ data: stats }, { data: day }, { data: completion }, { data: rows }] = await Promise.all([
    admin.rpc("community_workout_stats_cached", { _completion_id: fb.completion_id }),
    admin.from("pl_days").select("title, subtitle").eq("id", fb.day_id).maybeSingle(),
    admin.from("pl_day_completions").select("scheduled_workout_id, completed_at").eq("id", fb.completion_id).maybeSingle(),
    admin.from("pl_exercise_rows").select("id, sets, reps_text, rpe, rir, measurement_type, tracking_type, exercise_name_override, cardio_target_id, exercises(name)").eq("day_id", fb.day_id).limit(80),
  ]);
  const facts: string[] = [];
  const name = (stats as any)?.workout_name || day?.subtitle || day?.title || "their workout";
  facts.push(`Workout: ${name}${(stats as any)?.workout_title ? ` (${(stats as any).workout_title})` : ""}`);
  facts.push(`Their review: rated the session ${fb.overall_rating}/5, session effort ${fb.session_rpe}/10`);
  const note = String(fb.client_note ?? "").trim();
  if (note) facts.push(`What they wrote: "${note.slice(0, 600)}"`);
  const prs = Array.isArray((stats as any)?.prs) ? ((stats as any).prs as any[]) : [];
  const prLines = prs
    .filter((p) => Number(p.reps) > 0 && Number(p.reps) <= 10)
    .slice(0, 3)
    .map((p) => [p.exercise_name, loadText(p.load_kg, p.unit), `× ${p.reps}`].filter(Boolean).join(" "));
  if (prLines.length) facts.push(`New all-time records today: ${prLines.join("; ")}`);
  const top = (stats as any)?.top_lift;
  if (top?.exercise_name && loadText(top.load_kg, top.unit)) facts.push(`Heaviest set: ${top.exercise_name} ${loadText(top.load_kg, top.unit)} × ${top.reps}`);
  if ((stats as any)?.working_sets) facts.push(`Working sets: ${(stats as any).working_sets}${(stats as any)?.duration_min ? `, about ${(stats as any).duration_min} minutes` : ""}`);
  const rowIds = ((rows ?? []) as any[]).map((r) => r.id);
  if (rowIds.length) {
    let q = admin
      .from("pl_row_results")
      .select("row_id, set_index, actual_reps, actual_rpe, actual_rpe_num, actual_rir, completed_at, completed_duration_seconds, is_working_set")
      .eq("client_id", fb.client_id)
      .in("row_id", rowIds)
      .limit(1000);
    q = completion?.scheduled_workout_id ? q.eq("scheduled_workout_id", completion.scheduled_workout_id) : q.is("scheduled_workout_id", null);
    const { data: results } = await q;
    const { planCheck } = await import("@/lib/workouts/plan-vs-actual");
    const plan = planCheck((rows ?? []) as any[], (results ?? []) as any[]);
    if (plan.asPlanned) facts.push("Against the plan: done as planned");
    else {
      if (plan.lines.length) facts.push(`Against the plan: ${plan.lines.map((l) => l.text).join("; ")}`);
      if (plan.notLogged) facts.push(`Exercises with nothing logged: ${plan.notLogged}`);
    }
  }
  return facts;
}

/**
 * After a new kind's read and draft: record them on the held item, then send it
 * (automatic and routine), leave it as a draft (manual and routine) or ask him.
 */
async function routeDrafted(
  admin: any,
  item: Item,
  opts: { mode: string; risk: Risk; reasons: string[]; draft: { message: string; model: string; warnings: string[]; firstName: string }; context: Record<string, unknown>; ask?: string | null },
): Promise<TickResult> {
  let route = routeItem(opts.mode as any, opts.risk);
  if (route === "off") return cancel(admin, item, "switched off");
  let why: string | null = null;
  if (route === "send" && opts.ask) {
    route = "awaiting_approval";
    why = opts.ask;
  }
  if (route === "send" && opts.draft.warnings.length) {
    route = "awaiting_approval";
    why = `The draft needs a look before it goes (${opts.draft.warnings.join(", ")}).`;
  }
  const next: Item = { ...item, risk: opts.risk, risk_reasons: opts.reasons, context: opts.context, mode: opts.mode, draft: opts.draft.message };
  const { data: kept } = await held(
    admin.from("coach_automation_items").update({
      risk: opts.risk,
      risk_reasons: opts.reasons,
      mode: opts.mode,
      draft: opts.draft.message,
      model: opts.draft.model,
      context: opts.context,
      updated_at: new Date().toISOString(),
      ...(why ? { why } : {}),
    }),
    item,
  )
    .select("id")
    .maybeSingle();
  if (!kept) return { id: item.id, outcome: "taken away" };
  await event(admin, item, "drafted", { risk: opts.risk, reasons: opts.reasons, model: opts.draft.model });
  if (route === "send") return sendAutomatically(admin, next, opts.draft.message);
  if (route === "draft") {
    if (!(await finish(admin, next, "draft"))) return { id: item.id, outcome: "taken away" };
    return { id: item.id, outcome: "draft" };
  }
  if (!(await finish(admin, next, "awaiting_approval"))) return { id: item.id, outcome: "taken away" };
  await event(admin, item, opts.risk === "urgent" ? "escalated" : "awaiting_approval", { risk: opts.risk, reasons: opts.reasons });
  await tellCoach(admin, next, opts.risk, opts.draft.firstName);
  return { id: item.id, outcome: "awaiting_approval" };
}

async function processWorkoutReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const { data: fb } = await admin
    .from("pl_workout_feedback")
    .select("id, client_id, completion_id, day_id, overall_rating, session_rpe, pain, client_note, created_at")
    .eq("id", item.source_id)
    .maybeSingle();
  if (!fb || fb.client_id !== item.client_id) return cancel(admin, item, "the review is gone");
  if (Date.now() - Date.parse(fb.created_at) > 2 * 86_400_000) return cancel(admin, item, "the review is too old to reply to now");
  const { data: pain } = await admin.from("pain_reports").select("id").eq("feedback_id", fb.id).limit(1);
  if (fb.pain || (pain ?? []).length) return cancel(admin, item, "its pain report gets its own reply");
  if (await coachWroteSince(admin, item.client_id, fb.created_at)) return cancel(admin, item, "you've written to them since");
  const read = workoutReplyRead({ note: fb.client_note, rating: fb.overall_rating });
  if (!read.useful) return cancel(admin, item, read.why ?? "nothing that needs a reply");
  const facts = await workoutFacts(admin, fb);
  const route = routeItem(mode as any, read.risk);
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
  const draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic: route === "send", kind: "workout", facts });
  return routeDrafted(admin, item, { mode, risk: read.risk, reasons: read.reasons, draft, context: { facts } });
}

async function processCheckinReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const { data: ci } = await admin
    .from("messenger_checkins")
    .select("id, client_id, status, ai_status, ai_analysis, answers, submitted_at, reviewed_at, superseded_at")
    .eq("id", item.source_id)
    .maybeSingle();
  if (!ci || ci.client_id !== item.client_id || ci.status !== "completed" || !ci.submitted_at) return cancel(admin, item, "the check-in is gone");
  if (ci.superseded_at) return cancel(admin, item, "a newer check-in replaced it");
  if (ci.reviewed_at) return cancel(admin, item, "you've already replied or marked it reviewed");
  if (await coachWroteSince(admin, item.client_id, ci.submitted_at)) return cancel(admin, item, "you've written to them since");
  const analysis = (ci.ai_analysis ?? null) as any;
  const read = checkinReplyRead({ analysis, answers: ci.answers ?? null });
  if (!read.useful) return cancel(admin, item, read.why ?? "nothing to reply from");
  const route = routeItem(mode as any, read.risk);
  const automatic = route === "send";
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const suggested = String(analysis?.suggested_response ?? "").trim();
  const { autoMessageProblems } = await import("@/lib/recovery-automation/rules");
  const facts = [
    analysis?.summary ? `Recap: ${String(analysis.summary)}` : "",
    Array.isArray(analysis?.wins) && analysis.wins.length ? `Wins: ${analysis.wins.join("; ")}` : "",
    Array.isArray(analysis?.focus) && analysis.focus.length ? `Focus: ${analysis.focus.join("; ")}` : "",
    Array.isArray(analysis?.goals) && analysis.goals.length ? `Goals for the week: ${analysis.goals.join("; ")}` : "",
    Array.isArray(analysis?.red_flags) && analysis.red_flags.length ? `To ask about: ${analysis.red_flags.join("; ")}` : "",
  ].filter(Boolean);
  let draft: { message: string; model: string; warnings: string[]; firstName: string };
  const first = (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them";
  // The recap's reply was written in the owner's voice: his, as it is (it's on his check-in card
  // already), unless it would go by itself and says something an automatic message can't.
  if (voice && (!automatic || autoMessageProblems(suggested).length === 0)) {
    draft = { message: suggested.slice(0, 2000), model: "check-in recap", warnings: automatic ? autoMessageProblems(suggested) : [], firstName: first };
  } else {
    const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
    draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic, kind: "checkin", facts, startFrom: voice ? suggested : null });
  }
  return routeDrafted(admin, item, { mode, risk: read.risk, reasons: read.reasons, draft, context: { facts } });
}

async function processMissedSession(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const missed = (item.context?.workout ?? null) as { title: string | null; date: string } | null;
  if (!missed?.date || !item.source_id) return cancel(admin, item, "no missed workout on file");
  const tz = client.timezone || "America/Winnipeg";
  const since = localToInstant(missed.date, 0, tz).toISOString();
  const [{ data: started }, { data: trained }] = await Promise.all([
    admin.from("pl_day_completions").select("id").eq("day_id", item.source_id).limit(1),
    admin.from("pl_day_completions").select("id").eq("client_id", item.client_id).gte("completed_at", since).limit(1),
  ]);
  if ((started ?? []).length) return cancel(admin, item, "they've logged that workout since");
  if ((trained ?? []).length) return cancel(admin, item, "they've trained since");
  const today = todayIn(client.timezone);
  if (missed.date < addDays(today, -3)) return cancel(admin, item, "it's too long ago to ask about now");
  const read = missedSessionRead({ missedInTwoWeeks: Number(item.context?.missed_in_two_weeks ?? 1) });
  const route = routeItem(mode as any, read.risk);
  const wrote = await coachWroteSince(admin, item.client_id, since);
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const weekday = new Date(`${missed.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const facts = [
    `Planned workout with nothing logged: ${missed.title ?? "their workout"} on ${weekday} (${missed.date})`,
    `Planned workouts missed in the last two weeks, this one included: ${Math.max(1, Number(item.context?.missed_in_two_weeks ?? 1))}`,
  ];
  const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
  const draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic: route === "send" && !wrote, kind: "missed", facts });
  return routeDrafted(admin, item, {
    mode,
    risk: read.risk,
    reasons: read.reasons,
    draft,
    context: { ...(item.context ?? {}), facts },
    ask: wrote ? "You've written to them yourself since, so this waits for you." : null,
  });
}

/**
 * Once a day: every coach whose level includes follow-ups, every active coaching
 * client of theirs, and yesterday in the client's own time zone. A planned,
 * visible, required workout with nothing logged (not started, not finished, not
 * moved) and nothing trained since queues one check-in, at most one a client in
 * six days. Whether it's on, and how it goes, is the coach's setting per client.
 */
export async function scanMissedSessions(admin: any): Promise<{ looked: number; queued: number }> {
  const { data: coaches } = await admin.from("coaches").select("id, user_id, status, archived").eq("status", "Active").eq("archived", false).not("user_id", "is", null);
  const able: { id: string; user_id: string }[] = [];
  for (const c of (coaches ?? []) as any[]) {
    if ((await userHasFeature(admin, c.user_id, "automation.approval_queue")) && (await userHasFeature(admin, c.user_id, "automation.follow_ups"))) able.push(c);
  }
  if (!able.length) return { looked: 0, queued: 0 };
  const coachOf = new Map(able.map((c) => [c.id, c.user_id]));
  const { data: clients } = await admin
    .from("clients")
    .select("id, user_id, timezone, status, service_tier, archived, assigned_coach_id")
    .in("assigned_coach_id", [...coachOf.keys()])
    .eq("service_tier", "coaching")
    .eq("archived", false)
    .limit(2000);
  const active = ((clients ?? []) as any[]).filter((c) => c.user_id && !["Paused", "Deactivated", "Deleted"].includes(String(c.status ?? "")));
  if (!active.length) return { looked: 0, queued: 0 };
  const yesterday = new Map<string, string>(active.map((c) => [c.id, addDays(todayIn(c.timezone), -1)]));
  const days = [...yesterday.values()].sort();
  const { loadDatedWorkouts } = await import("@/lib/cleo-schedule.server");
  const workouts = await loadDatedWorkouts(admin, { clientIds: active.map((c) => c.id), from: addDays(days[0], -13), to: days[days.length - 1] });
  let queued = 0;
  for (const c of active) {
    const y = yesterday.get(c.id)!;
    const mine = workouts.filter((w) => w.clientId === c.id && w.visible && !w.optional);
    const missed = mine.filter((w) => w.date === y && !w.done);
    if (!missed.length) continue;
    const coachUserId = coachOf.get(c.assigned_coach_id)!;
    const { data: mode } = await admin.rpc("coach_automation_mode_for", { _uid: coachUserId, _client: c.id, _category: "missed_session" });
    if (!mode || mode === "off") continue;
    const since = localToInstant(y, 0, c.timezone || "America/Winnipeg").toISOString();
    const [{ data: started }, { data: trained }, { data: recent }] = await Promise.all([
      admin.from("pl_day_completions").select("day_id").in("day_id", missed.map((w) => w.dayId)).limit(10),
      admin.from("pl_day_completions").select("id").eq("client_id", c.id).gte("completed_at", since).limit(1),
      admin.from("coach_automation_items").select("id").eq("client_id", c.id).eq("category", "missed_session").gte("created_at", new Date(Date.now() - 6 * 86_400_000).toISOString()).limit(1),
    ]);
    const startedDays = new Set(((started ?? []) as any[]).map((r) => r.day_id));
    const untouched = missed.filter((w) => !startedDays.has(w.dayId));
    if (!untouched.length || (trained ?? []).length || (recent ?? []).length) continue;
    const missedInTwoWeeks = mine.filter((w) => w.date <= y && !w.done).length;
    const w = untouched[0];
    const { data: row, error } = await admin
      .from("coach_automation_items")
      .insert({
        coach_user_id: coachUserId,
        client_id: c.id,
        category: "missed_session",
        dedupe_key: `missed_session:${c.id}:${y}`,
        source_kind: "missed",
        source_id: w.dayId,
        status: "queued",
        due_at: new Date().toISOString(),
        context: { workout: { title: w.title, date: w.date }, missed_in_two_weeks: missedInTwoWeeks },
      })
      .select("id")
      .maybeSingle();
    if (error && !/duplicate key/i.test(error.message)) throw error;
    if (row) {
      queued += 1;
      await event(admin, { id: row.id, coach_user_id: coachUserId, client_id: c.id }, "queued", { missed: w.date });
    }
  }
  return { looked: active.length, queued };
}

async function processItem(admin: any, item: Item): Promise<TickResult> {
  // a run cut off after its message went: that was the send
  const already = await sentMessage(admin, item);
  if (already) {
    await finish(admin, item, "sent", { message_id: already, sent_at: new Date().toISOString() });
    return { id: item.id, outcome: "already sent" };
  }
  // a send the coach approved that was cut off: only ever his own words, never a new draft
  if (item.decided_by && item.draft) {
    const taken = await takeForSending(admin, item, item.draft);
    if (!taken) return { id: item.id, outcome: "taken away" };
    await deliver(admin, taken, { approvedBy: item.decided_by, edited: false });
    return { id: item.id, outcome: "sent (approved)" };
  }
  if (!(await userHasFeature(admin, item.coach_user_id, "automation.approval_queue"))) return cancel(admin, item, "automation isn't part of the coach's plan");
  const { data: mode, error } = await admin.rpc("coach_automation_mode_for", { _uid: item.coach_user_id, _client: item.client_id, _category: item.category });
  if (error) throw new Error(error.message);
  if (!mode || mode === "off") return cancel(admin, item, "switched off");
  switch (item.category) {
    case "recovery_follow_up":
      return processFollowUp(admin, item, mode);
    case "workout_reply":
      return processWorkoutReply(admin, item, mode);
    case "checkin_reply":
      return processCheckinReply(admin, item, mode);
    case "missed_session":
      return processMissedSession(admin, item, mode);
    default:
      return processReply(admin, item, mode);
  }
}

/**
 * New items are claimed only in a run's first 15 s: one item can take about a
 * minute and a half (two model calls), and the database's call gives up at 120 s.
 */
export async function runAutomationTick(admin: any, opts: { itemId?: string | null; budgetMs?: number } = {}): Promise<{ processed: TickResult[] }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 15_000;
  const processed: TickResult[] = [];
  while (Date.now() - started < budget) {
    const { data, error } = await admin.rpc("coach_automation_claim", { _id: opts.itemId ?? null });
    if (error) throw new Error(error.message);
    const item = ((data ?? []) as Item[])[0];
    if (!item) break;
    try {
      processed.push(await processItem(admin, item));
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 500);
      console.error("[recovery-automation] item failed", item.id, message);
      // only while this run still holds it (in either state it can hold it in)
      const now = new Date().toISOString();
      await admin.from("coach_automation_items").update({ status: "failed", error: message, locked_at: null, updated_at: now }).eq("id", item.id).in("status", ["working", "sending"]);
      await event(admin, item, "failed", { error: message, attempt: item.attempts });
      processed.push({ id: item.id, outcome: `failed: ${message}` });
    }
    if (opts.itemId) break;
  }
  return { processed };
}
