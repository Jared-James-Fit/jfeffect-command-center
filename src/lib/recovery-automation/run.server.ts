/**
 * Coaching automation's worker (server only, service role; the
 * `coach-automation-tick` hook runs it every minute while something is due,
 * and once a day looks for missed sessions). Pain reports and their
 * follow-ups, workout reviews, weekly check-ins, missed sessions, the day's
 * set videos and progress check-ins (the last two only ever wait for him).
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
import { checkinReplyRead, isFallbackRecap, messageTypeFor, missedSessionRead, progressReplyRead, pushesCoach, videoReplyRead, workoutReplyRead } from "@/lib/recovery-automation/categories";
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

async function cancel(admin: any, item: Item, why: string, patch: Record<string, unknown> = {}): Promise<TickResult> {
  if (!(await finish(admin, item, "cancelled", patch, why))) return { id: item.id, outcome: "taken away" };
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
  // an approved reply to a progress check-in is his review of it (the card says so before he sends)
  if (item.category === "progress_reply" && opts.approvedBy && item.source_id) {
    const { error: revErr } = await admin
      .from("progress_submissions")
      .update({ review_status: "reviewed", reviewed_at: now, reviewer_id: opts.approvedBy })
      .eq("id", item.source_id)
      .is("reviewed_at", null);
    if (revErr) console.error("[recovery-automation] progress check-in not marked reviewed", revErr.message);
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
  // what made it worth sending is read again at the last moment (the model call took a while)
  const verdict = await stillGoes(admin, taken);
  if (verdict.cancel || verdict.ask) {
    const status = verdict.cancel ? "cancelled" : "awaiting_approval";
    const why = verdict.cancel ?? verdict.ask!;
    await held(admin.from("coach_automation_items").update({ status, locked_at: null, updated_at: new Date().toISOString(), why: why.slice(0, 400) }), taken);
    await event(admin, item, status === "cancelled" ? "cancelled" : "awaiting_approval", { why });
    return { id: item.id, outcome: `${status}: ${why}` };
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
  video_reply: (f) => `Reply to ${f}'s set videos ready to approve`,
  progress_reply: (f) => `Reply to ${f}'s progress check-in ready to approve`,
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
  const onReview = must<any[]>(await admin.from("pain_reports").select("*").eq("feedback_id", item.source_id).order("created_at"), "pain reports");
  // only what they reported themselves (a coach saving for them in View as client leaves created_by empty)
  const rows = onReview.filter((r) => r.created_by && r.created_by === client.user_id);
  if (!rows.length) return cancel(admin, item, onReview.length ? "the report wasn't written by them" : "the pain came off their review");
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

/** A read a safety check rests on: a failure fails the item (tried again later), never reads as "nothing there". */
function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Couldn't check ${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

/** Whether the coach has written to them himself (not automation, not a note to himself) since then. */
async function coachWroteSince(admin: any, clientId: string, since: string): Promise<boolean> {
  const res = await admin
    .from("messages")
    .select("id")
    .eq("client_id", clientId)
    .neq("sender_role", "client")
    .eq("is_automated", false)
    .eq("is_internal_note", false)
    .is("deleted_at", null)
    .gt("created_at", since)
    .limit(1);
  return must<any[]>(res, "the chat").length > 0;
}

/** Any set they logged on these workouts (a completion row isn't always there: cardio on its own, a coach logging for them). */
async function setsLoggedOn(admin: any, clientId: string, dayIds: string[]): Promise<boolean> {
  if (!dayIds.length) return false;
  const rows = must<any[]>(await admin.from("pl_exercise_rows").select("id").in("day_id", dayIds).limit(500), "the workout");
  if (!rows.length) return false;
  const logged = must<any[]>(
    await admin.from("pl_row_results").select("row_id").eq("client_id", clientId).in("row_id", rows.map((r) => r.id)).not("completed_at", "is", null).limit(1),
    "logged sets",
  );
  return logged.length > 0;
}

/** Whether they've trained since (a finished workout, or any set logged). */
async function trainedSince(admin: any, clientId: string, since: string): Promise<boolean> {
  const [done, sets] = await Promise.all([
    admin.from("pl_day_completions").select("id").eq("client_id", clientId).gte("completed_at", since).limit(1),
    admin.from("pl_row_results").select("row_id").eq("client_id", clientId).gte("completed_at", since).limit(1),
  ]);
  return must<any[]>(done, "finished workouts").length > 0 || must<any[]>(sets, "logged sets").length > 0;
}

/**
 * Read again right before a message goes, by itself or by the coach's approval:
 * cancel when what it answers is gone or answered (pain added to a review, the
 * check-in replied to or replaced, the missed workout logged or trained past),
 * ask him first when he's written to them himself since (only for one going by itself).
 */
export async function stillGoes(admin: any, item: Pick<Item, "category" | "client_id" | "source_id" | "context">): Promise<{ cancel?: string; ask?: string }> {
  if (item.category === "workout_reply") {
    const fb = must<any>(await admin.from("pl_workout_feedback").select("id, pain, created_at").eq("id", item.source_id).maybeSingle(), "the review");
    if (!fb?.id) return { cancel: "The review is gone" };
    const pain = must<any[]>(await admin.from("pain_reports").select("id").eq("feedback_id", fb.id).limit(1), "pain reports");
    if (fb.pain || pain.length) return { cancel: "Pain was added to the review; it gets its own reply" };
    if (await coachWroteSince(admin, item.client_id, fb.created_at)) return { ask: "You've written to them yourself since, so this waits for you." };
  }
  if (item.category === "checkin_reply") {
    const ci = must<any>(await admin.from("messenger_checkins").select("id, submitted_at, reviewed_at, superseded_at").eq("id", item.source_id).maybeSingle(), "the check-in");
    if (!ci?.id) return { cancel: "The check-in is gone" };
    if (ci.reviewed_at) return { cancel: "You replied to the check-in yourself" };
    if (ci.superseded_at) return { cancel: "A newer check-in replaced it" };
    if (ci.submitted_at && (await coachWroteSince(admin, item.client_id, ci.submitted_at))) return { ask: "You've written to them yourself since, so this waits for you." };
  }
  if (item.category === "missed_session") {
    const w = (item.context?.workout ?? null) as { date: string } | null;
    if (!w?.date || !item.source_id) return { cancel: "No missed workout on file" };
    const client = must<any>(await admin.from("clients").select("timezone").eq("id", item.client_id).maybeSingle(), "the client");
    const since = localToInstant(w.date, 0, client?.timezone || "America/Winnipeg").toISOString();
    const started = must<any[]>(await admin.from("pl_day_completions").select("id").eq("day_id", item.source_id).limit(1), "the workout");
    if (started.length || (await setsLoggedOn(admin, item.client_id, [item.source_id]))) return { cancel: "They've logged that workout since" };
    if (await trainedSince(admin, item.client_id, since)) return { cancel: "They've trained since" };
    if (await coachWroteSince(admin, item.client_id, since)) return { ask: "You've written to them yourself since, so this waits for you." };
  }
  if (item.category === "video_reply") {
    const ids = Array.isArray(item.context?.video_ids) ? (item.context.video_ids as string[]) : [];
    if (!ids.length) return { cancel: "No videos on file" };
    const left = must<any[]>(await admin.from("pl_set_videos").select("id").in("id", ids).is("deleted_at", null).limit(1), "the videos");
    if (!left.length) return { cancel: "The videos were removed" };
  }
  if (item.category === "progress_reply") {
    const sub = must<any>(await admin.from("progress_submissions").select("id, review_status, reviewed_at").eq("id", item.source_id).maybeSingle(), "the check-in");
    if (!sub?.id) return { cancel: "The check-in is gone" };
    if (sub.reviewed_at || sub.review_status !== "awaiting_review") return { cancel: "You reviewed the check-in yourself" };
  }
  return {};
}

const round = (n: number, step: number) => Math.round(n / step) * step;
function loadText(kg: unknown, unit: unknown): string | null {
  const k = Number(kg);
  if (!Number.isFinite(k) || k <= 0) return null;
  return unit === "lb" ? `${round(k * 2.20462262, 0.5)} lb` : `${round(k, 0.5)} kg`;
}

type WorkoutPr = { exercise_name: string; reps: number; load_kg: number | null; unit?: string | null; scope?: string };

/** The workout's stats (PRs, top lift, working sets); a read that fails fails the item. */
async function workoutStats(admin: any, completionId: string | null): Promise<any | null> {
  if (!completionId) return null;
  const res = await admin.rpc("community_workout_stats_cached", { _completion_id: completionId });
  if (res.error) throw new Error(`Couldn't check the workout's records: ${res.error.message}`);
  return res.data ?? null;
}

const prText = (p: WorkoutPr) => [p.exercise_name, loadText(p.load_kg, p.unit), `× ${p.reps}`].filter(Boolean).join(" ");

/** What the records say about a finished workout, one line each, for its reply. */
async function workoutFacts(admin: any, fb: any, stats: any, headline: WorkoutPr | null): Promise<string[]> {
  const [{ data: day }, { data: completion }, { data: rows }] = await Promise.all([
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
  // only all-time records are PRs; a block or program best never is
  const prs = (Array.isArray((stats as any)?.prs) ? ((stats as any).prs as WorkoutPr[]) : []).filter((p) => p.scope === "atpr" && Number(p.reps) >= 1 && Number(p.reps) <= 10);
  if (headline) facts.push(`Headline PR today (an all-time best for ${headline.reps} ${headline.reps === 1 ? "rep" : "reps"} on a main lift): ${prText(headline)}`);
  const others = prs.filter((p) => !headline || p.exercise_name !== headline.exercise_name || p.reps !== headline.reps).slice(0, 2);
  if (others.length) facts.push(`${headline ? "Other all-time records" : "All-time records"} today: ${others.map(prText).join("; ")}`);
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
  if (opts.draft.warnings.length) {
    if (route === "send") route = "awaiting_approval";
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
  const fb = must<any>(
    await admin
      .from("pl_workout_feedback")
      .select("id, client_id, completion_id, day_id, overall_rating, session_rpe, pain, client_note, created_at, review_updated_by")
      .eq("id", item.source_id)
      .maybeSingle(),
    "the review",
  );
  if (!fb?.id || fb.client_id !== item.client_id) return cancel(admin, item, "the review is gone");
  if (fb.review_updated_by !== client.user_id) return cancel(admin, item, "the review wasn't written by them");
  if (Date.now() - Date.parse(fb.created_at) > 2 * 86_400_000) return cancel(admin, item, "the review is too old to reply to now");
  const pain = must<any[]>(await admin.from("pain_reports").select("id").eq("feedback_id", fb.id).limit(1), "pain reports");
  if (fb.pain || pain.length) return cancel(admin, item, "its pain report gets its own reply");
  if (await coachWroteSince(admin, item.client_id, fb.created_at)) return cancel(admin, item, "you've written to them since");
  const stats = await workoutStats(admin, fb.completion_id);
  const { headlinePr } = await import("@/lib/community");
  const headline = (headlinePr(stats as any) as WorkoutPr | null) ?? null;
  const read = workoutReplyRead({ note: fb.client_note, rating: fb.overall_rating, headlinePr: !!headline });
  // marked, so it's looked at again if they add to the note
  if (!read.useful) return cancel(admin, item, read.why ?? "nothing that needs a reply", { context: { not_useful: true } });
  const facts = await workoutFacts(admin, fb, stats, headline);
  const route = routeItem(mode as any, read.risk);
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
  const draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic: route === "send", kind: "workout", facts });
  return routeDrafted(admin, item, { mode, risk: read.risk, reasons: read.reasons, draft, context: { facts } });
}

async function processCheckinReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const ci = must<any>(
    await admin
      .from("messenger_checkins")
      .select("id, client_id, status, ai_status, ai_analysis, answers, submitted_at, reviewed_at, superseded_at")
      .eq("id", item.source_id)
      .maybeSingle(),
    "the check-in",
  );
  if (!ci?.id || ci.client_id !== item.client_id || ci.status !== "completed" || !ci.submitted_at) return cancel(admin, item, "the check-in is gone");
  if (Date.now() - Date.parse(ci.submitted_at) > 3 * 86_400_000) return cancel(admin, item, "the check-in is too old to reply to now");
  if (ci.superseded_at) return cancel(admin, item, "a newer check-in replaced it");
  if (ci.reviewed_at) return cancel(admin, item, "you've already replied or marked it reviewed");
  if (await coachWroteSince(admin, item.client_id, ci.submitted_at)) return cancel(admin, item, "you've written to them since");
  const analysis = (ci.ai_analysis ?? null) as any;
  const read = checkinReplyRead({ analysis, answers: ci.answers ?? null });
  if (!read.useful) return cancel(admin, item, read.why ?? "nothing to reply from");
  const route = routeItem(mode as any, read.risk);
  const automatic = route === "send";
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  // a stand-in recap (the recap model didn't answer) has a template reply: write a real one from their answers
  const standIn = isFallbackRecap(analysis);
  const suggested = standIn ? "" : String(analysis?.suggested_response ?? "").trim();
  const { autoMessageProblems } = await import("@/lib/recovery-automation/rules");
  const facts = [
    analysis?.summary && !standIn ? `Recap: ${String(analysis.summary)}` : "",
    Array.isArray(analysis?.wins) && analysis.wins.length ? `Wins: ${analysis.wins.join("; ")}` : "",
    Array.isArray(analysis?.focus) && analysis.focus.length ? `Focus: ${analysis.focus.join("; ")}` : "",
    Array.isArray(analysis?.goals) && analysis.goals.length ? `Goals for the week: ${analysis.goals.join("; ")}` : "",
    Array.isArray(analysis?.red_flags) && analysis.red_flags.length ? `To ask about: ${analysis.red_flags.join("; ")}` : "",
  ].filter(Boolean);
  let draft: { message: string; model: string; warnings: string[]; firstName: string };
  const first = (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them";
  // The recap's reply was written in the owner's voice: his, as it is (it's on his check-in card
  // already), unless it would go by itself and says something an automatic message can't.
  if (voice && suggested && (!automatic || autoMessageProblems(suggested).length === 0)) {
    draft = { message: suggested.slice(0, 2000), model: "check-in recap", warnings: automatic ? autoMessageProblems(suggested) : [], firstName: first };
  } else {
    const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
    draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic, kind: "checkin", facts, startFrom: voice && suggested ? suggested : null });
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
  const started = must<any[]>(await admin.from("pl_day_completions").select("id").eq("day_id", item.source_id).limit(1), "the workout");
  if (started.length || (await setsLoggedOn(admin, item.client_id, [item.source_id]))) return cancel(admin, item, "they've logged that workout since");
  if (await trainedSince(admin, item.client_id, since)) return cancel(admin, item, "they've trained since");
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

const KG_PER_LB = 0.45359237;
const fmtKg = (kg: number, unit: "kg" | "lb") => (unit === "lb" ? `${(kg / KG_PER_LB).toFixed(1)} lb` : `${kg.toFixed(1)} kg`);
/** A health history the coach would never want a bodyweight number about. */
const EATING_HISTORY = /\b(eating disorder|disordered eating|anorexi\w*|bulimi\w*|binge|arfid|ed recovery|orthorexi\w*)\b/i;

/**
 * The day's set videos: one reply for all of them, from the records only (each
 * set's numbers as the chat card says them, an accepted bar-speed read). Always
 * waits for him: he watches them and adds what he sees.
 */
async function processVideoReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const day = typeof item.context?.day === "string" ? (item.context.day as string) : null;
  if (!day) return cancel(admin, item, "no day on file");
  const tz = client.timezone || "America/Winnipeg";
  const from = localToInstant(day, 0, tz);
  const to = localToInstant(addDays(day, 1), 0, tz);
  if (Date.now() - to.getTime() > 2 * 86_400_000) return cancel(admin, item, "the videos are too old to reply to now");
  // a chat video becomes a set video later, so its row can be newer than its message
  const rows = must<any[]>(
    await admin
      .from("pl_set_videos")
      .select("id, message_id, origin, exercise_name, label, set_index, warmup_id, created_at")
      .eq("client_id", item.client_id)
      .is("deleted_at", null)
      .not("message_id", "is", null)
      .gte("created_at", from.toISOString())
      .lt("created_at", new Date(to.getTime() + 2 * 86_400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(40),
    "the set videos",
  );
  const msgs = rows.length
    ? must<any[]>(
        await admin
          .from("messages")
          .select("id, body, created_at, sender_role, sender_id, deleted_at")
          .in("id", rows.map((r) => r.message_id)),
        "the videos' messages",
      )
    : [];
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const videos = rows
    .map((r) => ({ ...r, msg: byId.get(r.message_id) }))
    .filter((r) => r.msg && !r.msg.deleted_at && r.msg.sender_role === "client" && r.msg.sender_id === client.user_id)
    .filter((r) => Date.parse(r.msg.created_at) >= from.getTime() && Date.parse(r.msg.created_at) < to.getTime())
    .sort((a, b) => Date.parse(a.msg.created_at) - Date.parse(b.msg.created_at));
  const read = videoReplyRead({ videos: videos.length });
  if (!read.useful) return cancel(admin, item, read.why ?? "no videos");
  const lastAt = videos[videos.length - 1].msg.created_at as string;
  if (await coachWroteSince(admin, item.client_id, lastAt)) return cancel(admin, item, "you've replied to them since");
  const reads = must<any[]>(
    await admin
      .from("pl_set_video_analyses")
      .select("set_video_id, reps, set_mcv, velocity_accepted, velocity_loss_pct, status")
      .in("set_video_id", videos.map((v) => v.id)),
    "the bar-speed reads",
  );
  const speed = new Map(reads.filter((a) => a.status === "done" && a.velocity_accepted && Number(a.set_mcv) > 0).map((a) => [a.set_video_id, a]));
  const facts: string[] = [`Set videos sent today: ${videos.length}`];
  for (const v of videos.slice(0, 10)) {
    const set = v.origin === "chat" ? [v.exercise_name, v.label].filter(Boolean).join(" · ") || "A lift video" : String(v.msg.body ?? "").trim() || [v.exercise_name, v.label].filter(Boolean).join(" · ");
    const caption = v.origin === "chat" && String(v.msg.body ?? "").trim() ? ` (they wrote: "${String(v.msg.body).trim().slice(0, 200)}")` : "";
    const a = speed.get(v.id);
    const bar = a
      ? ` · bar speed ${Number(a.set_mcv).toFixed(2)} m/s average over ${a.reps} ${a.reps === 1 ? "rep" : "reps"}${a.velocity_loss_pct != null && a.reps > 1 ? `, ${Math.abs(Number(a.velocity_loss_pct)).toFixed(0)}% slower by the last rep` : ""}`
      : "";
    facts.push(`${v.warmup_id || v.set_index === 0 ? "Warm-up: " : ""}${set}${bar}${caption}`);
  }
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
  const draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic: false, kind: "video", facts });
  return routeDrafted(admin, item, { mode, risk: read.risk, reasons: read.reasons, draft, context: { day, facts, video_ids: videos.map((v) => v.id) } });
}

/**
 * A progress check-in: a reply that thanks them and says what the records say
 * (their bodyweight trend, their goal), never how they look. Always waits for
 * him: he looks at it and adds what he sees. Sending it marks it reviewed.
 */
async function processProgressReply(admin: any, item: Item, mode: string): Promise<TickResult> {
  const client = await loadClient(admin, item);
  if (!client) return cancel(admin, item, "not an active coaching client of this coach any more");
  const sub = must<any>(
    await admin
      .from("progress_submissions")
      .select("id, client_id, user_id, owner_type, review_status, reviewed_at, submitted_at, submission_type, check_in_label, notes")
      .eq("id", item.source_id)
      .maybeSingle(),
    "the check-in",
  );
  if (!sub?.id || sub.client_id !== item.client_id) return cancel(admin, item, "the check-in is gone");
  if (sub.user_id !== client.user_id) return cancel(admin, item, "it wasn't sent by them");
  if (sub.reviewed_at || sub.review_status !== "awaiting_review") return cancel(admin, item, "you've reviewed it already");
  if (!sub.submitted_at || Date.now() - Date.parse(sub.submitted_at) > 3 * 86_400_000) return cancel(admin, item, "the check-in is too old to reply to now");
  const media = must<any[]>(await admin.from("progress_media").select("angle, media_type, upload_status").eq("submission_id", sub.id).limit(20), "what they uploaded");
  const kept = media.filter((m) => m.upload_status !== "failed");
  const read = progressReplyRead({ media: kept.length });
  if (!read.useful) return cancel(admin, item, read.why ?? "nothing uploaded");
  const today = todayIn(client.timezone);
  const [weighIns, before, health, goalRow] = await Promise.all([
    admin.from("progress_bodyweight").select("logged_date, weight_value, weight_unit").eq("user_id", client.user_id).gte("logged_date", addDays(today, -42)).order("logged_date", { ascending: true }).limit(200),
    admin.from("progress_submissions").select("submitted_at").eq("client_id", item.client_id).neq("id", sub.id).not("submitted_at", "is", null).lt("submitted_at", sub.submitted_at).order("submitted_at", { ascending: false }).limit(1),
    admin.from("client_health_items").select("label, details, status").eq("client_id", item.client_id).limit(100),
    admin.from("clients").select("bodyweight_goal_value, bodyweight_goal_unit, bodyweight_goal_date").eq("id", item.client_id).maybeSingle(),
  ]);
  const angles = [...new Set(kept.map((m) => String(m.angle ?? "").replace(/_/g, " ")).filter(Boolean))];
  const facts: string[] = [
    `They sent: ${sub.submission_type === "video" ? "a progress video" : `progress photos${angles.length ? ` (${angles.join(", ")})` : ""}`}${sub.check_in_label ? ` for "${sub.check_in_label}"` : ""}`,
  ];
  const note = String(sub.notes ?? "").trim();
  if (note) facts.push(`What they wrote: "${note.slice(0, 400)}"`);
  const last = must<any[]>(before, "earlier check-ins")[0];
  if (last?.submitted_at) {
    const weeks = Math.round((Date.parse(sub.submitted_at) - Date.parse(last.submitted_at)) / (7 * 86_400_000));
    facts.push(weeks >= 1 ? `Their last progress check-in was ${weeks} ${weeks === 1 ? "week" : "weeks"} before this one` : "They sent another progress check-in earlier this week");
  } else facts.push("This is their first progress check-in");
  const history = must<any[]>(health, "their health profile");
  if (history.some((h) => h.status !== "resolved" && EATING_HISTORY.test(`${h.label ?? ""} ${h.details ?? ""}`))) {
    facts.push("Leave bodyweight and body numbers out entirely (their health history)");
  } else {
    const rows = must<any[]>(weighIns, "their weigh-ins");
    const unit: "kg" | "lb" = rows.filter((r) => r.weight_unit === "kg").length > rows.length / 2 ? "kg" : "lb";
    const kg = (r: any) => (r.weight_unit === "kg" ? Number(r.weight_value) : Number(r.weight_value) * KG_PER_LB);
    const avg = (xs: any[]) => (xs.length ? xs.reduce((n, r) => n + kg(r), 0) / xs.length : null);
    const recent = avg(rows.filter((r) => r.logged_date > addDays(today, -7)));
    const earlier = avg(rows.filter((r) => r.logged_date <= addDays(today, -28) && r.logged_date > addDays(today, -35)));
    if (recent != null) facts.push(`Bodyweight, 7-day average: ${fmtKg(recent, unit)}`);
    if (recent != null && earlier != null) {
      const diff = recent - earlier;
      facts.push(`Four weeks ago (7-day average): ${fmtKg(earlier, unit)}, so ${Math.abs(diff) < 0.2 ? "about the same" : `${diff < 0 ? "down" : "up"} ${fmtKg(Math.abs(diff), unit)}`}`);
    }
    const g = must<any>(goalRow, "their goal");
    if (g?.bodyweight_goal_value) facts.push(`Their bodyweight goal: ${g.bodyweight_goal_value} ${g.bodyweight_goal_unit ?? unit}${g.bodyweight_goal_date ? ` by ${g.bodyweight_goal_date}` : ""}`);
  }
  const voice = await userHasFeature(admin, item.coach_user_id, "owner.voice");
  const { writeCoachReply } = await import("@/lib/recovery-automation/reply-draft.server");
  const draft = await writeCoachReply(admin, { clientId: item.client_id, voice, automatic: false, kind: "progress", facts });
  return routeDrafted(admin, item, { mode, risk: read.risk, reasons: read.reasons, draft, context: { facts, submission_type: sub.submission_type } });
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
    try {
      const y = yesterday.get(c.id)!;
      const mine = workouts.filter((w) => w.clientId === c.id && w.visible && !w.optional);
      const missed = mine.filter((w) => w.date === y && !w.done);
      if (!missed.length) continue;
      const coachUserId = coachOf.get(c.assigned_coach_id)!;
      const { data: mode, error: modeError } = await admin.rpc("coach_automation_mode_for", { _uid: coachUserId, _client: c.id, _category: "missed_session" });
      if (modeError) throw new Error(modeError.message);
      if (!mode || mode === "off") continue;
      const since = localToInstant(y, 0, c.timezone || "America/Winnipeg").toISOString();
      const [startedRes, recentRes] = await Promise.all([
        admin.from("pl_day_completions").select("day_id").in("day_id", missed.map((w) => w.dayId)).limit(10),
        admin.from("coach_automation_items").select("id").eq("client_id", c.id).eq("category", "missed_session").gte("created_at", new Date(Date.now() - 6 * 86_400_000).toISOString()).limit(1),
      ]);
      const startedDays = new Set(must<any[]>(startedRes, "the workout").map((r) => r.day_id));
      if (must<any[]>(recentRes, "the queue").length) continue;
      const untouched: typeof missed = [];
      for (const w of missed) if (!startedDays.has(w.dayId) && !(await setsLoggedOn(admin, c.id, [w.dayId]))) untouched.push(w);
      if (!untouched.length || (await trainedSince(admin, c.id, since))) continue;
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
      if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
      if (row) {
        queued += 1;
        await event(admin, { id: row.id, coach_user_id: coachUserId, client_id: c.id }, "queued", { missed: w.date });
      }
    } catch (e: any) {
      // one client's trouble never stops the others
      console.error("[coach-automation] missed-session scan skipped a client", c.id, e?.message);
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
    case "video_reply":
      return processVideoReply(admin, item, mode);
    case "progress_reply":
      return processProgressReply(admin, item, mode);
    case "recovery_reply":
      return processReply(admin, item, mode);
    default:
      // a kind this build doesn't know (a newer database): leave it for a build that does
      throw new Error(`Unknown automation kind: ${String(item.category)}`);
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
