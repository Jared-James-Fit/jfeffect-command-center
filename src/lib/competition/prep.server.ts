/**
 * Competition preparation and handling (server only; callers check who's asking
 * first). One read for a meet (`loadPrep`): the event, the athlete's meet
 * information, the handling service when there is one, the gameplan versions,
 * the estimated timeline, the checklist, readiness, the next action and Cleo's
 * recommendation, every number from the deterministic engines in this folder.
 * The writes keep the rules those engines state: an approved gameplan version
 * never changes (a change is a new version), an athlete's suggestion never
 * overwrites the approved plan, a confirmed time is never overwritten by an
 * answer, and nothing contacts anyone by itself.
 */
import { createHash, createHmac, randomBytes } from "crypto";
import {
  infoChanges,
  infoComplete,
  mergeInfo,
  readAthleteInfo,
  splitEventPatch,
  stepsFor,
  type AthleteInfo,
  type EventPatch,
  type InfoChange,
  type StepKey,
} from "./athlete-info";
import {
  buildTimeline,
  nowInZone,
  readSchedule,
  timelineInputFrom,
  type Anchor,
  type Timeline,
} from "./event-timeline";
import {
  checkGameplan,
  diffGameplans,
  draftGameplan,
  planAttemptsTrio,
  planWarmupTimes,
  readGameplan,
  type GameplanDoc,
} from "./gameplan";
import {
  accessWindow,
  HANDLING_INVITE_DAYS,
  HANDLING_TERMS_VERSION,
  handlingPath,
  handlingStatus,
  handlingTerms,
  inviteState,
  paymentFromSale,
  priceText,
  type HandlingStatus,
  type PaymentState,
} from "./handling";
import { buildChecklist, daysFrom, dueReminders, FORM_KEY_FOR, nextAction, rackHeightsKnown, readChecklistStates, readinessOf, type ItemState } from "./prep-checklist";
import { logEvent } from "./release.server";
import { readRules } from "./rules";
import { classLimitKg } from "@/lib/weight-management/target";
import type { Brief } from "./brief";

type Db = any;
export const SITE = "https://jfeffect.com";

export function todayIn(tz: string | null | undefined, at = new Date()): string {
  return nowInZone(tz, at).date;
}

/* ------------------------------------------------------------------ */
/* The invite link                                                    */

function inviteSecret(): string {
  const s = process.env.HANDLING_INVITE_SECRET || process.env.SETUP_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Handling links can't be made: no server secret configured.");
  return s;
}
/** The link's token, worked out again whenever the coach needs it (only its hash is stored). */
export function handlingToken(handlingId: string, nonce: string): string {
  return createHmac("sha256", inviteSecret()).update(`handling-invite:v1:${handlingId}:${nonce}`).digest("base64url").slice(0, 32);
}
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newNonce = () => randomBytes(12).toString("base64url");
export function handlingUrl(handlingId: string, nonce: string | null): string | null {
  return nonce ? `${SITE}${handlingPath(handlingToken(handlingId, nonce))}` : null;
}

/* ------------------------------------------------------------------ */
/* People                                                             */

export async function coachOfUser(sb: Db, userId: string | null | undefined): Promise<{ first: string; name: string; phone: string | null } | null> {
  if (!userId) return null;
  const { data } = await sb.from("coaches").select("first_name, full_name, phone").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const name = String(data.full_name || data.first_name || "").trim() || "Your coach";
  return { first: String(data.first_name || name.split(" ")[0]), name, phone: data.phone ?? null };
}

export const firstOf = (c: any) =>
  String(c?.preferred_name || c?.first_name || String(c?.full_name ?? "").split(" ")[0] || "").trim() || "there";

/* ------------------------------------------------------------------ */
/* The read                                                           */

const COMP_COLS =
  "id, client_id, prep_id, name, meet_date, meet_end_date, federation, division, weight_class, location, level, objective, status, registration, lifting_start, weigh_in_at, flight, weigh_in_kg, rules, sport, timezone, session_label, equipment_event, flights_in_session, lifters_per_flight, platforms, lot_number, schedule, checklist, athlete_info, athlete_info_at, athlete_info_changes, prep_reminders, internal_test, results, target_total_kg";
export const PLAN_COLS =
  "id, competition_id, client_id, version, source, status, based_on, plan, summary, created_by, created_at, approved_at, approved_by, athlete_confirmed_at, decided_at, decision_note";

export type PrepRead = Awaited<ReturnType<typeof loadPrep>>;

export async function loadPrep(
  sb: Db,
  competitionId: string,
  opts: { brief?: Brief | null; coach?: boolean; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const { data: comp, error } = await sb.from("competitions").select(COMP_COLS).eq("id", competitionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!comp) throw new Error("Competition not found");
  const [{ data: client }, { data: handlingRow }, { data: versions }, { data: log }] = await Promise.all([
    sb
      .from("clients")
      .select("id, user_id, full_name, first_name, last_name, preferred_name, phone, email, timezone, service_tier, status, source, assigned_coach_id, sex")
      .eq("id", comp.client_id)
      .maybeSingle(),
    sb.from("competition_handling").select("*").eq("competition_id", competitionId).maybeSingle(),
    sb.from("competition_gameplans").select(PLAN_COLS).eq("competition_id", competitionId).order("version", { ascending: false }).limit(60),
    sb.from("competition_meet_log").select("entrant, lift, attempt, kg, result").eq("competition_id", competitionId).eq("entrant", "us"),
  ]);
  const tz = comp.timezone || client?.timezone || "America/Winnipeg";
  const today = todayIn(tz, now);
  const rules = readRules(comp.rules, comp.federation);
  const info = readAthleteInfo(comp.athlete_info);
  const handled = !!handlingRow && handlingRow.status !== "cancelled";
  const steps = stepsFor({ sport: comp.sport ?? "powerlifting", handled });
  const complete = infoComplete(info, steps);

  const rows = (versions ?? []) as any[];
  const approved = rows.find((v) => v.status === "approved") ?? null;
  const draft = rows.find((v) => v.status === "draft") ?? null;
  const suggestion = rows.find((v) => v.status === "suggested") ?? null;

  // what the plan reads as: the approved version, else the coach's draft, else Cleo's (not saved yet)
  let handler = handlingRow?.handler_user_id ? await coachOfUser(sb, handlingRow.handler_user_id) : null;
  if (!handler && client?.assigned_coach_id) {
    const { data: co } = await sb.from("coaches").select("first_name, full_name, phone").eq("id", client.assigned_coach_id).maybeSingle();
    if (co) handler = { first: String(co.first_name || ""), name: String(co.full_name || co.first_name || ""), phone: co.phone ?? null };
  }
  const existing = handlingRow?.existing_coach ?? {};
  // uploaded athlete information (athlete-intel): their coach's attempts and warm-ups, racks, cues, notes
  let intel: Parameters<typeof draftGameplan>[0]["intel"] = null;
  try {
    const { loadFacts } = await import("@/lib/athlete-intel/fact-store.server");
    const { gameplanIntel } = await import("@/lib/athlete-intel/engine-input");
    const { resolveFacts } = await import("@/lib/athlete-intel/facts");
    const facts = (await loadFacts(sb, comp.client_id)).filter((f) => f.competition_id == null || f.competition_id === competitionId);
    if (facts.length)
      intel = {
        ...gameplanIntel(facts, competitionId),
        conflicts: [...new Set(resolveFacts(facts).conflicts.filter((c) => c.kind === "attempt_plan" && c.lift).map((c) => c.lift!))],
      };
  } catch (e) {
    console.warn("[competition] athlete information couldn't be read", (e as Error)?.message);
  }
  const engineDraft = draftGameplan({
    intel,
    rules,
    objective: comp.objective ?? null,
    info,
    recordsAttempts: opts.brief?.attempts ?? null,
    warmupHistory: opts.brief?.inputs?.warmups ?? {},
    handler: handler ? { name: handler.name, phone: handler.phone } : null,
    athlete: { name: client?.full_name || firstOf(client), phone: client?.phone ?? null },
    existingCoach: handlingRow?.share_with_coach === "yes" && existing?.name ? { name: String(existing.name) } : null,
  });
  const current = approved ?? draft ?? null;
  const plan: GameplanDoc = current ? readGameplan(current.plan) : engineDraft;
  const problems = checkGameplan(plan, rules);

  const schedule = readSchedule(comp.schedule);
  const timeline: Timeline = buildTimeline(
    timelineInputFrom(
      { ...comp, rules },
      { warmups: planWarmupTimes(plan), attempts: planAttemptsTrio(plan), travelMinutes: info.travel?.minutesToVenue ?? schedule.travelMinutes ?? null },
    ),
  );

  // the sale, for the payment
  let sale: any = null;
  if (handlingRow?.sale_id) {
    const { data } = await sb
      .from("purchase_records")
      .select("id, payment_status, amount_paid_cents, amount_outstanding_cents, amount_refunded_cents, full_payable_amount, currency")
      .eq("id", handlingRow.sale_id)
      .maybeSingle();
    sale = data;
  }
  const payment: PaymentState | null = handlingRow ? paymentFromSale(handlingRow.payment as PaymentState, sale) : null;

  const limit = classLimitKg(comp.weight_class);
  const bodyweight = info.bodyweightKg ?? (comp.weigh_in_kg != null ? Number(comp.weigh_in_kg) : null) ?? opts.brief?.inputs?.bodyweightAvg ?? null;
  const states: Record<string, ItemState> = { ...(await formChecklistStates(sb, comp.client_id, String(comp.meet_date))), ...readChecklistStates(comp.checklist) };
  const liftPrep = await import("./prep-evidence.server").then(m=>m.readPrepRequestStatus(sb,comp.client_id,competitionId)).catch(()=>undefined);
  const items = buildChecklist({
    liftPrep,
    today,
    meetDate: String(comp.meet_date),
    sport: comp.sport ?? "powerlifting",
    registration: comp.registration ?? "unknown",
    federation: comp.federation ?? null,
    weightClass: comp.weight_class ?? null,
    classLimitKg: limit && Number.isFinite(limit) ? limit : null,
    bodyweightKg: bodyweight,
    scheduleKnown: !!comp.lifting_start && (!!comp.flight || comp.flights_in_session === 1),
    weighInKnown: !!comp.weigh_in_at || (!!comp.lifting_start && rules.confirmed),
    travel: info.travel?.mode ?? null,
    travelMinutesKnown: info.travel?.minutesToVenue != null || schedule.travelMinutes != null,
    rackHeights: rackHeightsKnown(plan),
    openersSet: ["squat", "bench", "deadlift"].every((l) => plan.attempts[l as "squat"]?.opener != null) && !!approved,
    gameplanApproved: !!approved,
    athleteConfirmed: !!approved?.athlete_confirmed_at,
    warmupsConfirmed: !!approved?.athlete_confirmed_at && ["squat", "bench", "deadlift"].some((l) => (plan.warmups[l as "squat"]?.rows.length ?? 0) > 0),
    nutritionPlanned: !!(info.nutrition?.afterWeighIn || info.nutrition?.snacks),
    handled,
    intakeComplete: complete,
    termsAccepted: !!handlingRow?.terms_accepted_at,
    payment,
    states,
  });
  const readiness = readinessOf(items, today);
  const nowLocal = nowInZone(tz, now);
  const next = nextAction({ readiness, today, meetDate: String(comp.meet_date), now: nowLocal, timeline });

  const changes = (Array.isArray(comp.athlete_info_changes) ? comp.athlete_info_changes : []) as Array<InfoChange & { at?: string; proposed?: EventPatch }>;

  let handling: any = null;
  if (handlingRow) {
    const status = handlingStatus({
      cancelled_at: handlingRow.cancelled_at,
      completed_at: handlingRow.completed_at,
      competitionStatus: comp.status,
      invite_opened_at: handlingRow.invite_opened_at,
      infoStarted: !!info.steps && Object.keys(info.steps).length > 0,
      infoComplete: complete,
      termsAccepted: !!handlingRow.terms_accepted_at,
      planApproved: !!approved,
      athleteConfirmed: !!approved?.athlete_confirmed_at,
      openCritical: readiness.openCritical,
    });
    if (status !== handlingRow.status) {
      await sb
        .from("competition_handling")
        .update({
          status,
          ...(status === "ready" && !handlingRow.ready_at ? { ready_at: now.toISOString() } : {}),
          ...(payment && payment !== handlingRow.payment ? { payment } : {}),
        })
        .eq("id", handlingRow.id);
    } else if (payment && payment !== handlingRow.payment) {
      await sb.from("competition_handling").update({ payment }).eq("id", handlingRow.id);
    }
    handling = {
      id: handlingRow.id,
      status: status as HandlingStatus,
      payment,
      priceCents: handlingRow.price_cents,
      currency: handlingRow.currency,
      saleId: handlingRow.sale_id,
      handlerUserId: handlingRow.handler_user_id,
      handler: handler?.name ?? null,
      handlerFirst: handler?.first ?? null,
      referrerClientId: handlingRow.referrer_client_id,
      sourceSessionId: handlingRow.source_session_id,
      existingCoach: existing,
      shareWithCoach: handlingRow.share_with_coach,
      termsAcceptedAt: handlingRow.terms_accepted_at,
      termsVersion: handlingRow.terms_version,
      access: { starts: handlingRow.access_starts_on, ends: handlingRow.access_ends_on },
      invite: {
        state: inviteState(handlingRow, now),
        sentAt: handlingRow.invite_sent_at,
        openedAt: handlingRow.invite_opened_at,
        expiresAt: handlingRow.invite_expires_at,
        name: handlingRow.invite_name,
        // the link itself only for the coach
        url: opts.coach ? handlingUrl(handlingRow.id, handlingRow.invite_nonce) : null,
      },
      completedAt: handlingRow.completed_at,
      cancelledAt: handlingRow.cancelled_at,
      recap: handlingRow.recap ?? null,
      notes: opts.coach ? handlingRow.notes : null,
      createdAt: handlingRow.created_at,
    };
  }

  const recommendation = recommend({
    firstName: firstOf(client),
    handling,
    changes: changes.length,
    suggestion: !!suggestion,
    approved: !!approved,
    draft: !!draft,
    problems: problems.filter((p) => p.severity === "error").length,
    readiness,
    daysOut: daysFrom(today, String(comp.meet_date)),
    infoComplete: complete,
    watchTop: opts.brief?.watch?.[0]?.text ?? null,
    timelineMissing: timeline.missing[0] ?? null,
  });

  return {
    today,
    tz,
    competition: { ...comp, rules },
    client: {
      id: client?.id,
      first: firstOf(client),
      name: client?.full_name ?? firstOf(client),
      hasLogin: !!client?.user_id,
      tier: client?.service_tier === "self_serve" ? "self_serve" : "coaching",
    },
    info,
    steps,
    infoComplete: complete,
    changes,
    handling,
    plans: {
      approved: approved ? { ...approved, plan: readGameplan(approved.plan) } : null,
      draft: draft ? { ...draft, plan: readGameplan(draft.plan) } : null,
      suggestion: suggestion ? { ...suggestion, plan: readGameplan(suggestion.plan), changes: diffGameplans(readGameplan(approved?.plan ?? draft?.plan ?? engineDraft), readGameplan(suggestion.plan)) } : null,
      versions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        source: r.source,
        status: r.status,
        summary: r.summary,
        created_at: r.created_at,
        approved_at: r.approved_at,
        athlete_confirmed_at: r.athlete_confirmed_at,
        decided_at: r.decided_at,
        ...(opts.coach ? { plan: readGameplan(r.plan) } : {}),
      })),
      engine: opts.coach ? engineDraft : null,
    },
    plan,
    planSource: approved ? "approved" : draft ? "draft" : "cleo",
    problems,
    timeline,
    checklist: items,
    readiness,
    next,
    recommendation,
    meetLog: (log ?? []) as any[],
  };
}

/**
 * The Meet Day checklist form's answers (meet-checklist-template.ts) for this
 * meet, as checklist states: Ready is done, N/A is N/A. Best effort: a form
 * that can't be read adds nothing.
 */
async function formChecklistStates(sb: Db, clientId: string, meetDate: string): Promise<Record<string, ItemState>> {
  try {
    const since = new Date(`${meetDate}T12:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 60);
    const { data: forms } = await sb.from("nf_forms").select("id").eq("form_type", "meet_checklist").limit(5);
    const ids = ((forms ?? []) as any[]).map((f) => f.id);
    if (!ids.length) return {};
    const { data: sub } = await sb
      .from("nf_submissions")
      .select("id")
      .in("form_id", ids)
      .eq("client_id", clientId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return {};
    const { data: rows } = await sb.from("nf_answers").select("value_json").eq("submission_id", sub.id);
    const out: Record<string, ItemState> = {};
    for (const r of (rows ?? []) as any[]) {
      if (!Array.isArray(r.value_json)) continue;
      for (const e of r.value_json as any[]) {
        const key = FORM_KEY_FOR[String(e?.key ?? "")];
        if (!key) continue;
        if (e.state === "ready") out[key] = "done";
        else if (e.state === "na" && out[key] !== "done") out[key] = "na";
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Cleo's one recommendation for the overview, from the engines (never a model). */
export function recommend(o: {
  firstName: string;
  handling: { status: HandlingStatus; payment: PaymentState | null; invite: { state: string; sentAt: string | null } } | null;
  changes: number;
  suggestion: boolean;
  approved: boolean;
  draft: boolean;
  problems: number;
  readiness: ReturnType<typeof readinessOf>;
  daysOut: number;
  infoComplete: boolean;
  watchTop: string | null;
  timelineMissing: string | null;
}): { text: string; action: "review_changes" | "review_suggestion" | "approve_plan" | "fix_plan" | "send_invite" | "checklist" | "schedule" | "none"; why: string | null } {
  const f = o.firstName;
  if (o.suggestion) return { text: `${f} suggested a change to the gameplan. Review it: the approved plan stays until you accept it.`, action: "review_suggestion", why: null };
  if (o.changes) return { text: `${f} changed ${o.changes === 1 ? "something" : `${o.changes} things`} that affects the plan. Review before approving anything else.`, action: "review_changes", why: null };
  if (o.handling?.status === "invited" && !o.handling.invite.sentAt) return { text: `Send ${f} their link: their meet details shape everything else.`, action: "send_invite", why: null };
  if (o.problems) return { text: "Fix the gameplan before approving it: an attempt or warm-up doesn't add up.", action: "fix_plan", why: null };
  if (!o.approved && o.daysOut <= 14 && (o.infoComplete || !o.handling)) return { text: `Approve ${f}'s gameplan: attempts and warm-ups are drafted${o.draft ? "" : " from what's on file"}.`, action: "approve_plan", why: "The athlete sees the gameplan only once it's approved" };
  const top = o.readiness.outstanding[0];
  if (o.readiness.verdict === "at_risk" && top) return { text: `${top.label} is overdue and it's a must-have.`, action: "checklist", why: o.readiness.line };
  if (o.timelineMissing && o.daysOut <= 10) return { text: `${o.timelineMissing}: the timeline is an estimate until then.`, action: "schedule", why: null };
  if (o.watchTop) return { text: o.watchTop, action: "none", why: null };
  if (o.readiness.verdict === "needs_attention" && top) return { text: `${top.label} needs sorting soon.`, action: "checklist", why: o.readiness.line };
  return { text: "On track. Nothing needs you right now.", action: "none", why: null };
}

/* ------------------------------------------------------------------ */
/* Handling                                                           */

/** Create the handling service for an athlete at a competition (an existing account, or a new record). */
export async function createHandling(
  sb: Db,
  actorUserId: string,
  input: {
    clientId?: string | null;
    person?: { first: string; last?: string | null; email?: string | null; phone?: string | null } | null;
    competitionId?: string | null;
    copyFromCompetitionId?: string | null;
    event?: { name: string; meet_date: string; federation?: string | null; location?: string | null } | null;
    referrerClientId?: string | null;
    sessionId?: string | null;
    sourceNote?: string | null;
    existingCoach?: { name: string; clientId?: string | null; contact?: string | null } | null;
  },
): Promise<{ handlingId: string; clientId: string; competitionId: string; url: string; created: boolean }> {
  const today = todayIn("America/Winnipeg");
  // the athlete: an existing account, else one already on file by email, else a new record (no login until they make one)
  let clientId = input.clientId ?? null;
  let placeholder = false;
  if (!clientId && input.person?.email) {
    const email = input.person.email.trim().toLowerCase();
    const { data: found } = await sb.from("clients").select("id").ilike("email", email).limit(2);
    if ((found ?? []).length === 1) clientId = found[0].id;
  }
  if (!clientId) {
    const p = input.person;
    if (!p?.first?.trim()) throw new Error("The athlete's first name is needed");
    const first = p.first.trim().slice(0, 60);
    const last = (p.last ?? "").trim().slice(0, 60) || null;
    const { data: made, error } = await sb
      .from("clients")
      .insert({
        full_name: [first, last].filter(Boolean).join(" "),
        first_name: first,
        last_name: last,
        email: p.email?.trim().toLowerCase() || null,
        phone: p.phone?.trim() || null,
        service_tier: "self_serve",
        status: "Member",
        source: "competition_handling",
        preferred_weight_unit: "kg",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    clientId = made.id as string;
    placeholder = true;
  }

  // the competition: theirs, else a new one with the event's details (never the referrer's athlete-specific ones)
  let competitionId = input.competitionId ?? null;
  if (competitionId) {
    const { data: c } = await sb.from("competitions").select("client_id").eq("id", competitionId).maybeSingle();
    if (!c || c.client_id !== clientId) throw new Error("That competition isn't this athlete's");
  } else {
    let ev = input.event ?? null;
    let copy: any = null;
    if (input.copyFromCompetitionId) {
      const { data } = await sb
        .from("competitions")
        .select("name, meet_date, meet_end_date, federation, location, level, rules, timezone, sport")
        .eq("id", input.copyFromCompetitionId)
        .maybeSingle();
      copy = data;
      if (copy && !ev) ev = { name: copy.name, meet_date: copy.meet_date, federation: copy.federation, location: copy.location };
    }
    if (!ev?.name || !ev?.meet_date) throw new Error("The competition's name and date are needed");
    const { data: same } = await sb
      .from("competitions")
      .select("id")
      .eq("client_id", clientId)
      .eq("meet_date", ev.meet_date)
      .ilike("name", ev.name)
      .neq("status", "cancelled")
      .limit(1);
    if (same?.[0]) competitionId = same[0].id;
    else {
      const { data: primary } = await sb.from("competitions").select("id").eq("client_id", clientId).eq("is_primary", true).eq("status", "upcoming").limit(1);
      const { rulesFor } = await import("./rules");
      const { data: made, error } = await sb
        .from("competitions")
        .insert({
          client_id: clientId,
          name: ev.name,
          meet_date: ev.meet_date,
          meet_end_date: copy?.meet_end_date ?? null,
          federation: ev.federation ?? null,
          location: ev.location ?? null,
          level: copy?.level ?? null,
          rules: copy?.rules ?? rulesFor(ev.federation ?? null),
          timezone: copy?.timezone ?? null,
          sport: copy?.sport ?? "powerlifting",
          is_primary: !(primary ?? []).length,
          source: "coach",
          created_by: actorUserId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      competitionId = made.id as string;
    }
  }

  const { data: comp } = await sb.from("competitions").select("meet_date").eq("id", competitionId).single();
  const { data: already } = await sb.from("competition_handling").select("id, invite_nonce").eq("competition_id", competitionId).maybeSingle();
  if (already) {
    const nonce = already.invite_nonce ?? newNonce();
    if (!already.invite_nonce)
      await sb.from("competition_handling").update({ invite_nonce: nonce, invite_token_hash: hashToken(handlingToken(already.id, nonce)) }).eq("id", already.id);
    return { handlingId: already.id, clientId: clientId!, competitionId: competitionId!, url: handlingUrl(already.id, nonce)!, created: false };
  }
  const win = accessWindow(String(comp.meet_date), today);
  const { data: h, error: hErr } = await sb
    .from("competition_handling")
    .insert({
      client_id: clientId,
      competition_id: competitionId,
      status: "invited",
      handler_user_id: actorUserId,
      referrer_client_id: input.referrerClientId ?? null,
      source_session_id: input.sessionId ?? null,
      source_note: input.sourceNote?.slice(0, 600) ?? null,
      existing_coach: input.existingCoach
        ? { name: input.existingCoach.name, clientId: input.existingCoach.clientId ?? null, contact: input.existingCoach.contact ?? null, confirmed: false }
        : {},
      access_starts_on: win.starts,
      access_ends_on: win.ends,
      invite_expires_at: new Date(Date.now() + HANDLING_INVITE_DAYS * 864e5).toISOString(),
      invite_name: input.person ? [input.person.first, input.person.last].filter(Boolean).join(" ").slice(0, 120) : null,
      created_by: actorUserId,
    })
    .select("id")
    .single();
  if (hErr) throw new Error(hErr.message);
  const nonce = newNonce();
  await sb
    .from("competition_handling")
    .update({ invite_nonce: nonce, invite_token_hash: hashToken(handlingToken(h.id, nonce)) })
    .eq("id", h.id);
  await logEvent(sb, {
    competitionId: competitionId!,
    clientId: clientId!,
    actorId: actorUserId,
    actor: "coach",
    action: "handling_created",
    detail: { placeholder, sessionId: input.sessionId ?? null, referrer: input.referrerClientId ?? null },
  });
  return { handlingId: h.id, clientId: clientId!, competitionId: competitionId!, url: handlingUrl(h.id, nonce)!, created: true };
}

/** The handling a token names, and where its link stands. */
export async function resolveHandlingToken(sb: Db, token: string) {
  const { data } = await sb.from("competition_handling").select("*").eq("invite_token_hash", hashToken(token)).maybeSingle();
  if (!data) return { state: "invalid" as const, row: null };
  return { state: inviteState(data), row: data };
}

/**
 * Someone signed in opened an invite made for a new record: the handling and
 * its competition move onto their own account (the record made for the invite
 * is archived, never deleted). Only a record made for this invite, with no
 * login and nothing else on it.
 */
export async function claimForViewer(sb: Db, row: any, viewerClientId: string, viewerUserId: string): Promise<{ ok: boolean; why?: string }> {
  const { data: ph } = await sb.from("clients").select("id, user_id, source").eq("id", row.client_id).maybeSingle();
  if (!ph || ph.user_id || ph.source !== "competition_handling") return { ok: false, why: "This invitation is for another account." };
  const { count } = await sb.from("competitions").select("id", { count: "exact", head: true }).eq("client_id", ph.id).neq("id", row.competition_id);
  if ((count ?? 0) > 0) return { ok: false, why: "This invitation is for another account." };
  const { error: e1 } = await sb.from("competitions").update({ client_id: viewerClientId, is_primary: false }).eq("id", row.competition_id);
  if (e1) return { ok: false, why: e1.message };
  await sb.from("competition_gameplans").update({ client_id: viewerClientId }).eq("competition_id", row.competition_id);
  await sb.from("competition_handling").update({ client_id: viewerClientId }).eq("id", row.id);
  await sb.from("clients").update({ archived: true, archived_at: new Date().toISOString(), status: "Archived" }).eq("id", ph.id);
  await logEvent(sb, {
    competitionId: row.competition_id,
    clientId: viewerClientId,
    actorId: viewerUserId,
    actor: "athlete",
    action: "handling_claimed",
    detail: { from: ph.id },
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The athlete's meet information                                     */

export async function saveInfo(
  sb: Db,
  competitionId: string,
  actor: { userId: string; who: "athlete" | "coach" },
  input: { step?: StepKey | null; info?: AthleteInfo; event?: EventPatch | null; officialTimes?: boolean | null; finish?: boolean },
) {
  const { data: comp, error } = await sb.from("competitions").select(COMP_COLS).eq("id", competitionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!comp) throw new Error("Competition not found");
  const prev = readAthleteInfo(comp.athlete_info);
  const nowIso = new Date().toISOString();
  let next = mergeInfo(prev, input.info ?? {});
  if (input.step) next = { ...next, steps: { ...(next.steps ?? {}), [input.step]: nowIso } };
  if (input.finish) next = { ...next, completedAt: nowIso };
  const schedule = readSchedule(comp.schedule);
  const verified = schedule.verified ?? {};
  const patch: Record<string, unknown> = {};
  const proposed: InfoChange[] = [];
  if (input.event) {
    const split = splitEventPatch(input.event, comp, verified as Record<string, boolean>);
    Object.assign(patch, split.write);
    proposed.push(...split.proposed);
    // the athlete says these are the meet's official times: they read as confirmed until the coach says otherwise
    if (actor.who === "athlete" && input.officialTimes) {
      const v = { ...verified } as Record<string, boolean>;
      for (const k of ["lifting_start", "weigh_in_at", "flight"] as const) if (split.write[k]) v[k] = true;
      patch.schedule = { ...(comp.schedule ?? {}), verified: v };
    }
    if (actor.who === "coach") {
      const v = { ...verified } as Record<string, boolean>;
      for (const k of ["lifting_start", "weigh_in_at", "flight"] as const) if (k in split.write) v[k] = !!split.write[k];
      patch.schedule = { ...(comp.schedule ?? {}), verified: v };
    }
  }
  if (input.officialTimes != null) next = { ...next, officialTimes: input.officialTimes };
  const changes = actor.who === "athlete" && (prev.completedAt || prev.steps) ? [...infoChanges(prev, next), ...proposed] : proposed;
  const waiting = Array.isArray(comp.athlete_info_changes) ? comp.athlete_info_changes : [];
  const merged = [...waiting.filter((w: any) => !changes.some((c) => c.key === w.key)), ...changes.map((c) => ({ ...c, at: nowIso, proposed: c.key.startsWith("event_") ? input.event : undefined }))].slice(-30);
  const { error: uErr } = await sb
    .from("competitions")
    .update({
      ...patch,
      athlete_info: next,
      athlete_info_at: nowIso,
      athlete_info_changes: merged,
    })
    .eq("id", competitionId);
  if (uErr) throw new Error(uErr.message);
  // their own coach may be told anything only when they say so
  if (next.shareWithCoach) {
    await sb
      .from("competition_handling")
      .update({ share_with_coach: next.shareWithCoach, share_decided_at: nowIso, ...(next.coach?.name ? { existing_coach: { name: next.coach.name, contact: next.coach.contact ?? null, confirmed: true } } : {}) })
      .eq("competition_id", competitionId);
  }
  await logEvent(sb, {
    competitionId,
    clientId: comp.client_id,
    actorId: actor.userId,
    actor: actor.who,
    action: input.finish ? "meet_info_sent" : "meet_info_saved",
    detail: { step: input.step ?? null, changes: changes.map((c) => c.key) },
  });
  if (actor.who === "athlete" && (changes.length || input.finish)) {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(sb, "meet_info_updated", { clientId: comp.client_id, sourceId: `${competitionId}:${nowIso.slice(0, 13)}`, actorUserId: actor.userId });
  }
  // Cleo drafts the gameplan once the details are in (nothing approved, nothing drafted yet)
  if (input.finish) await ensureDraft(sb, competitionId, actor.userId).catch(() => undefined);
  return { changes };
}

/** Save Cleo's draft as a version when there's nothing to start from (the coach reviews and approves). */
export async function ensureDraft(sb: Db, competitionId: string, actorUserId: string | null) {
  const { data: any } = await sb.from("competition_gameplans").select("id").eq("competition_id", competitionId).limit(1);
  if ((any ?? []).length) return null;
  const prep = await loadPrep(sb, competitionId, { coach: true });
  if (!prep.plans.engine) return null;
  return insertVersion(sb, prep.competition, prep.plans.engine, { source: "cleo", status: "draft", actorUserId, summary: "Cleo's first draft from the meet details" });
}

export async function insertVersion(
  sb: Db,
  comp: { id: string; client_id: string },
  plan: GameplanDoc,
  o: { source: "cleo" | "coach" | "athlete"; status: "draft" | "approved" | "suggested"; actorUserId: string | null; basedOn?: string | null; summary?: string | null },
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await sb
      .from("competition_gameplans")
      .select("version")
      .eq("competition_id", comp.id)
      .order("version", { ascending: false })
      .limit(1);
    const version = ((last?.[0]?.version as number) ?? 0) + 1;
    const nowIso = new Date().toISOString();
    if (o.status === "approved") {
      await sb.from("competition_gameplans").update({ status: "superseded" }).eq("competition_id", comp.id).eq("status", "approved");
      // a draft the approval replaces is done with
      await sb.from("competition_gameplans").update({ status: "superseded" }).eq("competition_id", comp.id).eq("status", "draft");
    }
    if (o.status === "draft") await sb.from("competition_gameplans").update({ status: "superseded" }).eq("competition_id", comp.id).eq("status", "draft");
    const { data, error } = await sb
      .from("competition_gameplans")
      .insert({
        competition_id: comp.id,
        client_id: comp.client_id,
        version,
        source: o.source,
        status: o.status,
        based_on: o.basedOn ?? null,
        plan,
        summary: o.summary?.slice(0, 600) ?? null,
        created_by: o.actorUserId,
        ...(o.status === "approved" ? { approved_at: nowIso, approved_by: o.actorUserId } : {}),
      })
      .select(PLAN_COLS)
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Couldn't save the gameplan: try again");
}

/* ------------------------------------------------------------------ */
/* Reminders                                                          */

/**
 * The preparation reminders due now, for every upcoming competition within 60
 * days (competition_prep_due decides when this runs). Each is a push through
 * the app's sender, once by its key (push_notification_dedupe); day-level ones
 * follow quiet hours and the daily cap, meet-day ones go now (silently in quiet
 * hours) since they only matter at their time. Never for an internal test, a
 * cancelled handling, or someone with no login.
 */
export async function runPrepReminders(sb: Db, now = new Date()) {
  const out = { competitions: 0, sent: 0, skipped: 0 };
  const today = todayIn("America/Winnipeg", now);
  const until = new Date(`${today}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 60);
  const { data: comps } = await sb
    .from("competitions")
    .select("id, client_id, name, meet_date, prep_reminders, internal_test, status")
    .eq("status", "upcoming")
    .eq("prep_reminders", true)
    .eq("internal_test", false)
    .gte("meet_date", today)
    .lte("meet_date", until.toISOString().slice(0, 10))
    .limit(200);
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  const { staffUserIdsForClient } = await import("@/lib/push/app-events.server");
  for (const c of (comps ?? []) as any[]) {
    out.competitions++;
    try {
      const prep = await loadPrep(sb, c.id, { now });
      if (prep.handling && prep.handling.status === "cancelled") continue;
      const { data: client } = await sb.from("clients").select("user_id, archived, status, service_tier").eq("id", c.client_id).maybeSingle();
      if (!client || client.archived) continue;
      // competitive coaching clients and handled athletes
      if (client.service_tier !== "coaching" && !prep.handling) continue;
      const reminders = dueReminders({
        competitionId: c.id,
        meetName: c.name,
        meetDate: String(c.meet_date),
        items: prep.checklist,
        now: nowInZone(prep.tz, now),
        timeline: prep.timeline,
        athleteFirst: prep.client.first,
      });
      for (const r of reminders) {
        const to = r.audience === "athlete" ? (client.user_id ? [client.user_id] : []) : await staffUserIdsForClient(sb, c.client_id);
        for (const uid of to) {
          const res = await sendWebPushToUser(
            sb,
            uid,
            {
              title: r.title,
              body: r.body,
              url: r.audience === "athlete" ? "/portal/competition" : `/admin/clients/${c.client_id}?tab=competition`,
              tag: `comp-prep:${c.id}`,
              data: { kind: "competition_prep", competitionId: c.id },
            },
            { category: "workouts", eventKey: `${r.key}:${uid}`, priority: r.urgent ? "urgent" : "normal" },
          );
          if (res.sent) out.sent++;
          else out.skipped++;
        }
      }
    } catch (e) {
      console.warn("[competition-prep] reminders failed", c.id, (e as Error)?.message);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Payment                                                            */

async function handlingStripeProduct(): Promise<string> {
  const { stripeFetch, formEncode } = await import("@/lib/stripe.server");
  const found = await stripeFetch(`/products/search?query=${encodeURIComponent("metadata['jf_kind']:'competition_handling'")}`);
  if (found?.data?.[0]?.id) return found.data[0].id as string;
  const created = await stripeFetch("/products", {
    method: "POST",
    idempotencyKey: "jf-competition-handling-product",
    body: formEncode({ name: "Competition Handling", "metadata[jf_kind]": "competition_handling" }),
  });
  return created.id as string;
}

async function oneTimePrice(productId: string, cents: number, currency: string): Promise<string> {
  const { stripeFetch, formEncode } = await import("@/lib/stripe.server");
  const cur = currency.toLowerCase();
  const list = await stripeFetch(`/prices?product=${encodeURIComponent(productId)}&active=true&type=one_time&currency=${cur}&limit=100`);
  const hit = ((list?.data ?? []) as any[]).find((p) => p.unit_amount === cents && p.currency === cur && (p.tax_behavior ?? "exclusive") === "exclusive" && !p.recurring);
  if (hit?.id) return hit.id as string;
  const price = await stripeFetch("/prices", {
    method: "POST",
    idempotencyKey: `jf-handling-price:${productId}:${cur}:${cents}`,
    body: formEncode({ product: productId, unit_amount: cents, currency: cur, tax_behavior: "exclusive", nickname: `Competition Handling · $${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`, "metadata[source]": "competition_handling" }),
  });
  return price.id as string;
}

/**
 * The handling's payment request: a one-time sale at its price and a link to pay
 * it (Stripe's checkout behind the app's /pay link). A request, never a charge;
 * a sale with money on it is never replaced.
 */
export async function handlingPaymentLink(sb: Db, staff: any, actorUserId: string, handlingId: string, cents: number, currency = "CAD") {
  const productId = await handlingStripeProduct();
  const priceId = await oneTimePrice(productId, cents, currency);
  const { data: saleId, error } = await sb.rpc("competition_handling_sale", {
    _handling_id: handlingId,
    _price_cents: cents,
    _currency: currency,
    _stripe_product_id: productId,
    _stripe_price_id: priceId,
    _actor: actorUserId,
  });
  if (error) throw new Error(error.message);
  const url = await payUrlFor(sb, staff, actorUserId, saleId as string);
  return { saleId: saleId as string, url };
}

export async function payUrlFor(sb: Db, caller: any, callerUserId: string, saleId: string): Promise<string | null> {
  const { mintShareLinkForPurchase } = await import("@/lib/payment-share.server");
  const { sanitizeShareUrl } = await import("@/lib/payment-share-link");
  let share = await mintShareLinkForPurchase(caller, callerUserId, saleId, SITE);
  if (share.kind !== "none" && (share.needsFreshCheckout || !share.shareUrl)) {
    const { createAssignmentCheckout } = await import("@/lib/stripe-checkout.functions");
    await createAssignmentCheckout(sb, callerUserId, { purchaseRecordId: saleId, origin: SITE, discountCodeId: null } as any, {
      updateSource: "competition_handling",
      metadata: { kind: "competition_handling" },
      agreementNotice: false,
    });
    for (const wait of [0, 250, 600]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      share = await mintShareLinkForPurchase(caller, callerUserId, saleId, SITE);
      if (!share.needsFreshCheckout && share.shareUrl) break;
    }
  }
  return sanitizeShareUrl(share.shareUrl);
}

export function termsFor(o: { handler: string; meetName: string; priceCents: number | null; currency: string; payment: PaymentState | null }) {
  const price = o.payment === "waived" ? null : priceText(o.priceCents, o.currency);
  return { version: HANDLING_TERMS_VERSION, text: handlingTerms({ handler: o.handler, meetName: o.meetName, priceText: price }) };
}

/* ------------------------------------------------------------------ */
/* Meet day                                                           */

export async function logProgress(sb: Db, competitionId: string, actorUserId: string, anchor: Anchor, at: string) {
  const { data: comp } = await sb.from("competitions").select("schedule, client_id").eq("id", competitionId).single();
  const s = (comp.schedule ?? {}) as Record<string, any>;
  const progress = Array.isArray(s.progress) ? s.progress.filter((p: any) => p.anchor !== anchor) : [];
  progress.push({ anchor, at, by: actorUserId, ts: new Date().toISOString() });
  await sb.from("competitions").update({ schedule: { ...s, progress: progress.slice(-40) } }).eq("id", competitionId);
  await logEvent(sb, { competitionId, clientId: comp.client_id, actorId: actorUserId, actor: "coach", action: "meet_progress", detail: { anchor, at } });
}

export { diffGameplans };
