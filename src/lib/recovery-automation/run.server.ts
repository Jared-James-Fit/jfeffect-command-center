/**
 * Recovery automation's worker (server only, service role; the
 * `coach-automation-tick` hook runs it every minute while something is due).
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
import { classifyRecovery, followUpStillRelevant, planFollowUp, routeItem, type Risk, type UpcomingSession } from "@/lib/recovery-automation/rules";
import { userHasFeature } from "@/lib/cleo-capabilities.server";

type Item = {
  id: string;
  coach_user_id: string;
  client_id: string;
  category: "recovery_reply" | "recovery_follow_up";
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
};

export type TickResult = { id: string; outcome: string };

async function event(admin: any, item: Pick<Item, "id" | "coach_user_id" | "client_id">, kind: string, detail: Record<string, unknown> = {}, actor: string | null = null) {
  const { error } = await admin.from("coach_automation_events").insert({ item_id: item.id, coach_user_id: item.coach_user_id, client_id: item.client_id, kind, actor, detail });
  if (error) console.error("[recovery-automation] event not recorded", kind, error.message);
}

async function finish(admin: any, item: Item, status: string, patch: Record<string, unknown> = {}, why?: string) {
  await admin.from("coach_automation_items").update({ status, locked_at: null, updated_at: new Date().toISOString(), ...(why ? { why: why.slice(0, 400) } : {}), ...patch }).eq("id", item.id);
}

async function cancel(admin: any, item: Item, why: string): Promise<TickResult> {
  await finish(admin, item, "cancelled", {}, why);
  await event(admin, item, "cancelled", { why });
  return { id: item.id, outcome: `cancelled: ${why}` };
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

/** Sends the text in the client's coach chat as the coach, tells the client, and plans the follow-up. */
export async function sendItem(admin: any, item: Item, text: string, opts: { approvedBy: string | null; edited: boolean }): Promise<string> {
  const now = new Date().toISOString();
  const automatic = !opts.approvedBy;
  // never twice: a retry after a send that went finds it in the chat
  const { data: already } = await admin
    .from("messages")
    .select("id")
    .eq("client_id", item.client_id)
    .contains("attachments", JSON.stringify([{ kind: "recovery_auto", item_id: item.id }]))
    .limit(1);
  if (already?.length) {
    await admin.from("coach_automation_items").update({ status: "sent", message_id: already[0].id, sent_at: now, locked_at: null, updated_at: now }).eq("id", item.id);
    return already[0].id;
  }
  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      client_id: item.client_id,
      sender_id: item.coach_user_id,
      sender_role: "admin",
      body: text,
      attachments: [{ kind: "recovery_auto", item_id: item.id, category: item.category, automatic }],
      message_type: "Recovery",
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
  await admin
    .from("coach_automation_items")
    .update({ status: "sent", message_id: msg.id, sent_at: now, draft: text, decided_by: opts.approvedBy, decided_at: opts.approvedBy ? now : null, locked_at: null, updated_at: now })
    .eq("id", item.id);
  if (opts.edited) await event(admin, item, "edited", {}, opts.approvedBy);
  if (opts.approvedBy) await event(admin, item, "approved", {}, opts.approvedBy);
  await event(admin, item, "sent", { automatic, message_id: msg.id }, opts.approvedBy);
  // the pain sheet's "reviewed through" moves with it
  const { data: latest } = await admin.from("pain_reports").select("reported_at").eq("client_id", item.client_id).order("reported_at", { ascending: false }).limit(1).maybeSingle();
  await admin.from("pain_coach_reviews").insert({ client_id: item.client_id, kind: "used", through_at: latest?.reported_at ?? now, regions: item.regions, suggestion_keys: [], created_by: item.coach_user_id });
  try {
    const { pushNewMessage } = await import("@/lib/push/message-push.server");
    await pushNewMessage(admin, msg);
  } catch (e: any) {
    console.error("[recovery-automation] push failed", e?.message);
  }
  if (item.category === "recovery_reply") await planItemFollowUp(admin, { ...item, status: "sent", sent_at: now }).catch((e) => console.error("[recovery-automation] follow-up not planned", e?.message));
  return msg.id;
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

async function tellCoach(admin: any, item: Item, risk: Risk, firstName: string) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const urgent = risk === "urgent";
    await sendWebPushToUser(
      admin,
      item.coach_user_id,
      {
        title: urgent ? `${firstName}'s pain report needs you` : item.category === "recovery_follow_up" ? `Follow-up for ${firstName} to approve` : `Reply to ${firstName} ready to approve`,
        body: urgent ? "A warning sign came up. Open it to see the report and the reply." : "Tap to read it and send it.",
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
  await admin
    .from("coach_automation_items")
    .update({ regions, risk, risk_reasons: reasons, mode, draft: draft.message, insights: draft.insights, model: draft.model, context, updated_at: new Date().toISOString(), ...(why ? { why } : {}) })
    .eq("id", item.id);
  await event(admin, item, "drafted", { risk, reasons, model: draft.model });
  if (route === "send") {
    await sendItem(admin, next, draft.message, { approvedBy: null, edited: false });
    return { id: item.id, outcome: "sent" };
  }
  if (route === "draft") {
    await finish(admin, next, "draft");
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
  await finish(admin, next, "awaiting_approval");
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
  await admin.from("coach_automation_items").update({ mode, draft: draft.message, insights: draft.insights, model: draft.model, updated_at: new Date().toISOString(), ...(why ? { why } : {}) }).eq("id", item.id);
  await event(admin, item, "drafted", { model: draft.model, follow_up: true });
  if (route === "send") {
    await sendItem(admin, next, draft.message, { approvedBy: null, edited: false });
    return { id: item.id, outcome: "sent" };
  }
  await finish(admin, next, "awaiting_approval");
  await event(admin, item, "awaiting_approval", { follow_up: true });
  await tellCoach(admin, next, risk, draft.firstName);
  return { id: item.id, outcome: "awaiting_approval" };
}

async function processItem(admin: any, item: Item): Promise<TickResult> {
  if (!(await userHasFeature(admin, item.coach_user_id, "automation.approval_queue"))) return cancel(admin, item, "automation isn't part of the coach's plan");
  const { data: mode, error } = await admin.rpc("coach_automation_mode_for", { _uid: item.coach_user_id, _client: item.client_id, _category: item.category });
  if (error) throw new Error(error.message);
  if (!mode || mode === "off") return cancel(admin, item, "switched off");
  return item.category === "recovery_follow_up" ? processFollowUp(admin, item, mode) : processReply(admin, item, mode);
}

export async function runAutomationTick(admin: any, opts: { itemId?: string | null; budgetMs?: number } = {}): Promise<{ processed: TickResult[] }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 50_000;
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
      await admin.from("coach_automation_items").update({ status: "failed", error: message, locked_at: null, updated_at: new Date().toISOString() }).eq("id", item.id);
      await event(admin, item, "failed", { error: message, attempt: item.attempts });
      processed.push({ id: item.id, outcome: `failed: ${message}` });
    }
    if (opts.itemId) break;
  }
  return { processed };
}
