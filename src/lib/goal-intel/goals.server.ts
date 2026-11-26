/**
 * The goal ledger's operations (server only). Every caller has already
 * checked who's asking (goal-intel.functions.ts: assertStaffReachesClient) or
 * is the worker; writes go through the service role, and the database's own
 * triggers keep the fields the rest of the app reads in step (the migration's
 * sync). Nothing here writes a program, a plan or a message the coach didn't
 * approve: the only message is the client update, which waits out the coach's
 * review window in the outbox.
 */
import { assessGoal, meaningfulChange, resolveOutcome } from "./feasibility";
import { dedupeKey, goalTitle, inferUnit, measurableGoals, statedGoals, wordedGoal, type GoalCandidate } from "./extract";
import { loadGoalContext, localToday, readGoals, type GoalClient, type LoadedGoalContext } from "./load.server";
import {
  DEFAULT_REVIEW_MINUTES,
  MAX_REVIEW_MINUTES,
  MIN_REVIEW_MINUTES,
  buildUpdateMessage,
  currentChanges,
  inQuiet,
  latestPerGoal,
  mergeChanges,
  presenceOf,
  sendDecision,
  type OutboxChange,
} from "./outbox";
import {
  APPROACH_LABEL,
  LB_PER_KG,
  OPEN_STATUSES,
  addDays,
  daysBetween,
  fromKg,
  toKg,
  type ApproachKey,
  type GoalRow,
  type Lift,
  type Unit,
} from "./types";

type Db = any;
export type Actor = { userId: string | null; kind: "coach" | "cleo" | "athlete" | "system" };

export async function goalEvent(sb: Db, g: { id: string | null; client_id: string }, actor: Actor, action: string, detail: Record<string, unknown> = {}) {
  const { error } = await sb.from("client_goal_events").insert({ goal_id: g.id, client_id: g.client_id, actor: actor.kind, actor_id: actor.userId, action, detail });
  if (error) console.warn("[goal-intel] event not recorded", error.message);
}

const firstName = (c: Pick<GoalClient, "preferred_name" | "first_name" | "full_name">) =>
  (c.preferred_name || c.first_name || (c.full_name ?? "").split(" ")[0] || "").trim() || null;
const unitOf = (c: Pick<GoalClient, "preferred_weight_unit">): Unit => (c.preferred_weight_unit === "kg" ? "kg" : "lb");
const r1 = (x: number) => Math.round(x * 10) / 10;
/** A target as stored in the client's unit: whole pounds, or kilos to the half. */
export function cleanValue(kg: number, unit: Unit): number {
  const v = fromKg(kg, unit);
  return unit === "lb" ? Math.round(v) : Math.round(v * 2) / 2;
}

/* ------------------------------------------------------------------ */
/* Reading                                                            */

/**
 * Read a client's goals against their records and keep the read on each open
 * goal. A goal re-reads only when what it rests on moved (the signature), or
 * when forced; a recommendation the coach already decided on isn't asked
 * again unless it changed meaningfully. Goals whose date has passed get their
 * outcome from what was lifted or weighed.
 */
export async function assessClient(sb: Db, clientId: string, opts: { force?: boolean; loaded?: LoadedGoalContext } = {}): Promise<{ goals: GoalRow[]; loaded: LoadedGoalContext }> {
  const loaded = opts.loaded ?? (await loadGoalContext(sb, clientId));
  const { ctx, signature } = loaded;
  const goals = [...loaded.goals];
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    if (!OPEN_STATUSES.includes(g.status)) continue;
    // a date that's passed: the outcome, once the result is in
    if (g.status === "active" && g.deadline && g.deadline < ctx.today && !g.outcome) {
      const done = await settleOutcome(sb, g, loaded);
      if (done) {
        goals[i] = done;
        continue;
      }
    }
    const hash = `${signature}|v${g.version}`;
    if (!opts.force && g.data_hash === hash && g.feasibility) continue;
    const f = assessGoal({ ...g, baselineKg: g.feasibility?.baselineKg ?? null }, ctx);
    if (f.baselineKg == null && f.nowKg != null) f.baselineKg = f.nowKg;
    const prevRec = g.recommendation;
    const rec = f.action;
    let recStatus = g.recommendation_status;
    let recommendation = prevRec;
    let recAt = g.recommendation_at;
    const actionable = ["adjust_program", "adjust_target", "raise_target", "collect_data", "protect"].includes(rec.kind) && g.status === "active";
    if (!actionable) {
      if (recStatus === "open") recStatus = "none";
      recommendation = rec.kind === "none" ? null : rec;
    } else if (!prevRec || prevRec.key !== rec.key) {
      // the same advice already decided on isn't re-asked unless the read moved meaningfully
      const decided = recStatus === "dismissed" || recStatus === "maintained";
      if (!decided || prevRec?.kind !== rec.kind || meaningfulChange(g.feasibility, f)) {
        recommendation = rec;
        recStatus = "open";
        recAt = new Date().toISOString();
      }
    }
    const patch = {
      feasibility: f,
      assessed_at: new Date().toISOString(),
      data_hash: hash,
      recommendation,
      recommendation_status: recStatus,
      recommendation_at: recAt,
    };
    const { data, error } = await sb.from("client_goals").update(patch).eq("id", g.id).eq("version", g.version).select("*").maybeSingle();
    if (error) {
      console.warn("[goal-intel] read not saved", error.message);
      continue;
    }
    if (data) {
      goals[i] = data as GoalRow;
      if (recStatus === "open" && recAt !== g.recommendation_at) await goalEvent(sb, g, { userId: null, kind: "cleo" }, "recommendation", { kind: rec.kind, line: rec.line, score: f.score });
    }
  }
  return { goals, loaded: { ...loaded, goals } };
}

/** The outcome of an approved goal whose date has passed, from the meet's results or their records. */
async function settleOutcome(sb: Db, g: GoalRow, loaded: LoadedGoalContext): Promise<GoalRow | null> {
  const { ctx } = loaded;
  const target = g.approved_kg != null ? Number(g.approved_kg) : null;
  if (target == null) return null;
  let actual: number | null = null;
  let source: "meet_results" | "training_line" | "bodyweight_trend" = "training_line";
  if (g.competition_id && (g.kind === "lift" || g.kind === "total")) {
    const { data: comp } = await sb.from("competitions").select("results, status").eq("id", g.competition_id).maybeSingle();
    const res = comp?.results as Record<string, number | null> | null;
    if (!res) return null; // the meet's results come in later
    actual = g.kind === "total" ? res.total ?? null : res[g.lift as string] ?? null;
    source = "meet_results";
  } else if (g.kind === "lift" || g.kind === "total") {
    const lifts: Lift[] = g.kind === "total" ? ["squat", "bench", "deadlift"] : [g.lift as Lift];
    const fresh = lifts.every((l) => {
      const r = ctx.lifts[l];
      return r?.nowKg && r.basisDay && Math.abs(daysBetween(r.basisDay, g.deadline as string)) <= 21;
    });
    if (!fresh) return null;
    actual = r1(lifts.reduce((s, l) => s + (ctx.lifts[l]?.nowKg ?? 0), 0));
  } else if (g.kind === "bodyweight") {
    const bw = ctx.bodyweight;
    if (!bw || bw.stale) return null;
    actual = r1(bw.currentKg);
    source = "bodyweight_trend";
  } else return null;
  const direction = g.kind === "bodyweight" ? (g.direction ?? (target < (actual ?? target) ? "down" : "up")) : "up";
  const result = resolveOutcome({ kind: g.kind, targetKg: target, actualKg: actual, direction });
  if (!result) return null;
  const outcome = {
    result,
    actualKg: actual,
    at: ctx.today,
    source,
    projectedAtApprovalKg: g.approved_read?.expectedKg ?? null,
    nowAtApprovalKg: g.approved_read?.nowKg ?? null,
  };
  const { data } = await sb.from("client_goals").update({ status: result, outcome }).eq("id", g.id).eq("status", "active").select("*").maybeSingle();
  if (data) await goalEvent(sb, g, { userId: null, kind: "system" }, result, { actual_kg: actual, target_kg: target, source });
  return (data as GoalRow) ?? null;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                         */

export type CandidateMeta = {
  sourceKind: "meeting" | "checkin" | "message";
  sourceId: string;
  sourceAt: string | null;
  speaker: "athlete" | "coach" | "unclear";
  context: string | null;
  competitionId: string | null;
  eventTitle: string | null;
  deadline: string | null;
  tentative?: boolean;
};

/** Put one candidate in the ledger as proposed (or update an open goal it's the same as). Never approves. */
export async function upsertCandidate(
  sb: Db,
  client: GoalClient,
  cand: GoalCandidate,
  meta: CandidateMeta,
  loaded: Pick<LoadedGoalContext, "ctx"> | null,
): Promise<"created" | "updated" | "same" | "skipped"> {
  const unitPref = unitOf(client);
  const names = [client.first_name, client.preferred_name, ...(client.full_name ?? "").split(" ")].filter(Boolean) as string[];
  const competitionId = cand.kind === "lift" || cand.kind === "total" || cand.kind === "preference" || cand.timing ? meta.competitionId : null;
  const deadline = meta.deadline;
  const key = dedupeKey({ kind: cand.kind, lift: cand.lift, competitionId, deadline: competitionId ? null : deadline, text: cand.text, names });
  // numbers: the unit said, else read from their own training (marked inferred)
  let unit: Unit | null = cand.unit;
  let unitSource: "stated" | "inferred" | null = cand.unit ? "stated" : null;
  let note: string | null = null;
  if (cand.values.length && !unit) {
    const current =
      cand.kind === "lift" && cand.lift
        ? loaded?.ctx.lifts[cand.lift]?.nowKg ?? null
        : cand.kind === "total"
          ? (["squat", "bench", "deadlift"] as Lift[]).every((l) => loaded?.ctx.lifts[l]?.nowKg)
            ? (["squat", "bench", "deadlift"] as Lift[]).reduce((s, l) => s + (loaded?.ctx.lifts[l]?.nowKg ?? 0), 0)
            : null
          : cand.kind === "bodyweight"
            ? loaded?.ctx.bodyweight?.currentKg ?? null
            : null;
    const inf = inferUnit({ values: cand.values, kind: cand.kind, currentKg: current, preferred: unitPref });
    unit = inf.unit;
    unitSource = inf.source;
    note = inf.note;
  }
  const lo = cand.values.length ? Math.min(...cand.values) : null;
  const hi = cand.values.length > 1 ? Math.max(...cand.values) : null;
  const clientKg = lo != null && unit ? r1(toKg(lo, unit)) : null;
  const clientKgMax = hi != null && unit ? r1(toKg(hi, unit)) : null;
  const isNumber = cand.values.length > 0;
  const { data: existing } = await sb
    .from("client_goals")
    .select("*")
    .eq("client_id", client.id)
    .eq("dedupe_key", key)
    .in("status", OPEN_STATUSES)
    .maybeSingle();
  const context = [meta.context, note].filter(Boolean).join(" ").slice(0, 1200) || null;
  const tentative = !!(cand.tentative || meta.tentative);
  if (existing) {
    const g = existing as GoalRow;
    const same = isNumber
      ? g.client_value != null && Number(g.client_value) === lo && (g.client_value_max == null ? hi == null : Number(g.client_value_max) === hi) && (g.client_unit === unit || unitSource === "inferred")
      : (g.client_text ?? "").trim() === cand.text.trim();
    if (same) return "same";
    // a coach-confirmed unit isn't overwritten by an inferred one
    const keepUnit = g.client_unit_source === "coach" || g.client_unit_source === "stated";
    const patch: Record<string, unknown> = isNumber
      ? {
          client_value: lo,
          client_value_max: hi,
          client_unit: keepUnit && unitSource === "inferred" ? g.client_unit : unit,
          client_unit_source: keepUnit && unitSource === "inferred" ? g.client_unit_source : unitSource,
          client_kg: keepUnit && unitSource === "inferred" && g.client_unit ? r1(toKg(lo as number, g.client_unit)) : clientKg,
          client_kg_max: keepUnit && unitSource === "inferred" && g.client_unit && hi != null ? r1(toKg(hi, g.client_unit)) : clientKgMax,
        }
      : { client_text: cand.text.slice(0, 600) };
    Object.assign(patch, {
      source_kind: meta.sourceKind,
      source_id: meta.sourceId,
      source_quote: cand.quote.slice(0, 600),
      source_context: context,
      source_speaker: meta.speaker,
      source_at: meta.sourceAt,
      tentative,
    });
    const { error } = await sb.from("client_goals").update(patch).eq("id", g.id);
    if (error) throw new Error(error.message);
    await goalEvent(sb, g, { userId: null, kind: "cleo" }, "client_target_changed", { from: meta.sourceKind, source_id: meta.sourceId, before: { value: g.client_value, max: g.client_value_max, unit: g.client_unit, text: g.client_text }, after: patch });
    return "updated";
  }
  const row = {
    client_id: client.id,
    kind: cand.kind,
    lift: cand.lift,
    title: goalTitle({ kind: cand.kind, lift: cand.lift, eventTitle: competitionId ? meta.eventTitle : null, deadline: competitionId ? null : deadline, timing: cand.timing, text: cand.text }),
    direction: cand.kind === "bodyweight" ? (clientKg != null && loaded?.ctx.bodyweight ? (clientKg < loaded.ctx.bodyweight.currentKg ? "down" : "up") : null) : cand.kind === "lift" || cand.kind === "total" ? "up" : null,
    client_value: lo,
    client_value_max: hi,
    client_unit: isNumber ? unit : null,
    client_unit_source: isNumber ? unitSource : null,
    client_kg: clientKg,
    client_kg_max: clientKgMax,
    client_text: isNumber ? null : cand.text.slice(0, 600),
    deadline: competitionId ? meta.deadline : deadline,
    competition_id: competitionId,
    event_title: competitionId ? meta.eventTitle : null,
    status: "proposed",
    // a preference isn't a target to tell them about
    client_facing: cand.kind !== "preference",
    source_kind: meta.sourceKind,
    source_id: meta.sourceId,
    source_quote: cand.quote.slice(0, 600),
    source_context: context,
    source_speaker: meta.speaker,
    source_at: meta.sourceAt,
    tentative,
    dedupe_key: key,
  };
  const { data, error } = await sb.from("client_goals").insert(row).select("id, client_id").maybeSingle();
  if (error) {
    if (/duplicate key/i.test(error.message)) return "same";
    throw new Error(error.message);
  }
  if (data) await goalEvent(sb, data, { userId: null, kind: "cleo" }, "proposed", { from: meta.sourceKind, source_id: meta.sourceId });
  return "created";
}

/** The goals a meeting's analysis (and the coach's notes from the call) say, into the ledger. */
export async function extractFromMeeting(sb: Db, sessionId: string): Promise<{ created: number; updated: number }> {
  const { data: s, error } = await sb
    .from("coaching_sessions")
    .select("id, client_id, competition_id, event, analysis, analysis_status, live, updated_at, scheduled_at, created_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) return { created: 0, updated: 0 };
  const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived").eq("id", s.client_id).maybeSingle();
  let created = 0;
  let updated = 0;
  if (client && s.analysis_status === "ready" && s.analysis) {
    const event = (s.event ?? {}) as any;
    const eventDate: string | null = typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : null;
    let compName: string | null = event.title ?? null;
    let compDate: string | null = eventDate;
    if (s.competition_id) {
      const { data: comp } = await sb.from("competitions").select("name, meet_date").eq("id", s.competition_id).maybeSingle();
      if (comp) {
        compName = comp.name;
        compDate = comp.meet_date;
      }
    }
    const cands: Array<{ c: GoalCandidate; speaker: CandidateMeta["speaker"]; due: string | null; context: string | null; tentative: boolean }> = [];
    const a = s.analysis as any;
    for (const it of (a.items ?? []) as any[]) {
      if (it?.kind !== "goal" && it?.kind !== "objective") continue;
      const text = String(it.text ?? "");
      const quote = String(it.quote ?? text);
      const measured = measurableGoals(text, quote);
      const list = measured.length ? measured : [wordedGoal(text, quote)].filter(Boolean) as GoalCandidate[];
      for (const c of list) cands.push({ c, speaker: it.speaker === "coach" || it.speaker === "athlete" ? it.speaker : "unclear", due: it.due ?? null, context: text, tentative: it.basis === "tentative" });
    }
    for (const it of (a.intelligence ?? []) as any[]) {
      if (it?.kind !== "goal") continue;
      const text = String(it.text ?? "");
      const quote = String(it.quote ?? text);
      if (measurableGoals(text, quote).length) continue; // the items carry the numbers
      const w = wordedGoal(text, quote);
      if (w && w.kind !== "preference") cands.push({ c: w, speaker: it.speaker === "coach" || it.speaker === "athlete" ? it.speaker : "unclear", due: it.expiresOn ?? null, context: text, tentative: false });
    }
    // the coach's own notes from the call ("squat 220-225, bench 110-115 …")
    const notes = String((s.live as any)?.notes ?? "");
    for (const c of measurableGoals(notes, notes)) cands.push({ c, speaker: "coach", due: compDate, context: "From the coach's notes in the call", tentative: c.tentative });

    const needsEvidence = cands.some((x) => x.c.values.length && !x.c.unit);
    const loaded = needsEvidence ? await loadGoalContext(sb, client.id, { goals: [], evidence: true }).catch(() => null) : null;
    const seen = new Set<string>();
    for (const x of cands) {
      // a meet goal: an attempt, a meet word, or due on the meet day
      const atMeet = !!s.competition_id && (x.c.timing != null || x.due === compDate || x.c.kind === "preference");
      const meta: CandidateMeta = {
        sourceKind: "meeting",
        sourceId: s.id,
        sourceAt: s.scheduled_at ?? s.created_at,
        speaker: x.speaker,
        context: x.context,
        competitionId: atMeet ? s.competition_id : null,
        eventTitle: atMeet ? compName : null,
        deadline: atMeet ? compDate : x.due && /^\d{4}-\d{2}-\d{2}$/.test(x.due) && x.c.kind !== "physique" && x.c.kind !== "performance" ? x.due : null,
        tentative: x.tentative,
      };
      const k = `${x.c.kind}:${x.c.lift}:${meta.competitionId}:${x.c.kind === "lift" || x.c.kind === "total" || x.c.kind === "bodyweight" ? "" : x.c.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const r = await upsertCandidate(sb, client as GoalClient, x.c, meta, loaded);
      if (r === "created") created++;
      if (r === "updated") updated++;
    }
  }
  await sb.from("client_goal_sources").upsert({ source_kind: "meeting", source_id: s.id, client_id: s.client_id, goals: created + updated, scanned_at: new Date().toISOString() });
  return { created, updated };
}

/** A weekly check-in's own words (next week's goal, what they need help with): strict, numbers only. */
export async function extractFromCheckin(sb: Db, checkin: { id: string; client_id: string; answers: any; submitted_at: string | null }): Promise<number> {
  const texts = ["next_week_goal", "help"].map((k) => checkin.answers?.[k]).filter((v) => typeof v === "string" && v.trim()) as string[];
  let n = 0;
  const cands = texts.flatMap((t) => statedGoals(t));
  if (cands.length) {
    const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived").eq("id", checkin.client_id).maybeSingle();
    if (client && client.service_tier === "coaching") {
      const loaded = cands.some((c) => !c.unit) ? await loadGoalContext(sb, client.id, { goals: [], evidence: true }).catch(() => null) : null;
      for (const c of cands) {
        const r = await upsertCandidate(sb, client as GoalClient, c, { sourceKind: "checkin", sourceId: checkin.id, sourceAt: checkin.submitted_at, speaker: "athlete", context: "From their weekly check-in", competitionId: null, eventTitle: null, deadline: null }, loaded);
        if (r === "created" || r === "updated") n++;
      }
    }
  }
  await sb.from("client_goal_sources").upsert({ source_kind: "checkin", source_id: checkin.id, client_id: checkin.client_id, goals: n, scanned_at: new Date().toISOString() });
  return n;
}

/** Clients' own chat messages since the last read: strict, numbers only, coaching clients only. */
export async function extractFromMessages(sb: Db): Promise<number> {
  const { data: setting } = await sb.from("app_settings").select("value").eq("key", "goal_intel_scan").maybeSingle();
  const since = (setting?.value as any)?.messages_at ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const startedAt = new Date().toISOString();
  const { data: msgs } = await sb
    .from("messages")
    .select("id, client_id, body, created_at, is_internal_note, deleted_at")
    .eq("sender_role", "client")
    .gt("created_at", since)
    .lte("created_at", startedAt)
    .order("created_at", { ascending: true })
    .limit(500);
  let n = 0;
  const clients = new Map<string, GoalClient | null>();
  for (const m of (msgs ?? []) as any[]) {
    if (m.is_internal_note || m.deleted_at || !m.client_id) continue;
    const cands = statedGoals(String(m.body ?? ""));
    if (!cands.length) continue;
    if (!clients.has(m.client_id)) {
      const { data: c } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived").eq("id", m.client_id).maybeSingle();
      clients.set(m.client_id, c && c.service_tier === "coaching" && !c.archived ? (c as GoalClient) : null);
    }
    const client = clients.get(m.client_id);
    if (!client) continue;
    const loaded = cands.some((c) => !c.unit) ? await loadGoalContext(sb, client.id, { goals: [], evidence: true }).catch(() => null) : null;
    for (const c of cands) {
      const r = await upsertCandidate(sb, client, c, { sourceKind: "message", sourceId: m.id, sourceAt: m.created_at, speaker: "athlete", context: "From their message in the coach chat", competitionId: null, eventTitle: null, deadline: null }, loaded);
      if (r === "created" || r === "updated") n++;
    }
    await sb.from("client_goal_sources").upsert({ source_kind: "message", source_id: m.id, client_id: m.client_id, goals: cands.length, scanned_at: new Date().toISOString() });
  }
  const last = (msgs ?? []).length === 500 ? (msgs as any[])[499].created_at : startedAt;
  await sb.from("app_settings").upsert({ key: "goal_intel_scan", value: { ...(setting?.value as any), messages_at: last } }, { onConflict: "key" });
  return n;
}

/* ------------------------------------------------------------------ */
/* The coach's decisions                                              */

export type GoalDecision =
  | { action: "approve"; value?: number | null; unit?: Unit | null; approach?: ApproachKey | null; deadline?: string | null; text?: string | null; clientFacing?: boolean | null }
  | { action: "dismiss" }
  | { action: "archive" }
  | { action: "reopen" }
  | { action: "client_facing"; clientFacing: boolean }
  | { action: "result"; result: "achieved" | "missed"; actualValue?: number | null; unit?: Unit | null };

async function goalById(sb: Db, goalId: string): Promise<GoalRow> {
  const { data, error } = await sb.from("client_goals").select("*").eq("id", goalId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That goal wasn't found.");
  return data as GoalRow;
}

export async function clientIdOfGoal(sb: Db, goalId: string): Promise<string> {
  return (await goalById(sb, goalId)).client_id;
}

/** Approve, dismiss or close a goal. An approved, client-facing change joins the client's waiting update. */
export async function decideGoal(sb: Db, goalId: string, d: GoalDecision, actor: Actor): Promise<GoalRow> {
  const g = await goalById(sb, goalId);
  const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived").eq("id", g.client_id).maybeSingle();
  const unitPref: Unit = client?.preferred_weight_unit === "kg" ? "kg" : "lb";
  let patch: Record<string, unknown> = {};
  let action: string = d.action;
  if (d.action === "approve") {
    const measurable = g.kind === "lift" || g.kind === "total" || g.kind === "bodyweight";
    let kg: number | null = null;
    let value: number | null = null;
    let unit: Unit | null = null;
    if (measurable) {
      if (d.value != null) {
        unit = d.unit ?? g.client_unit ?? unitPref;
        value = d.value;
        kg = r1(toKg(value, unit));
      } else if (d.approach) {
        const opt = g.feasibility?.approaches?.find((a) => a.key === d.approach);
        if (!opt) throw new Error("That approach isn't in the latest read. Refresh and try again.");
        unit = g.client_unit ?? unitPref;
        value = cleanValue(opt.targetKg, unit);
        kg = r1(toKg(value, unit));
      } else if (g.client_value != null && g.client_unit) {
        // their own number: the top of a range they said
        unit = g.client_unit;
        value = Number(g.client_value_max ?? g.client_value);
        kg = r1(toKg(value, unit));
      } else if (g.approved_kg != null) {
        unit = g.approved_unit ?? unitPref;
        value = Number(g.approved_value ?? cleanValue(Number(g.approved_kg), unit));
        kg = Number(g.approved_kg);
      } else {
        throw new Error("Give it a number to approve.");
      }
      if (!(kg > 0) || kg > 1500) throw new Error("That number doesn't look right.");
    }
    patch = {
      status: "active",
      approved_value: value,
      approved_unit: unit,
      approved_kg: kg,
      approved_text: measurable ? null : (d.text ?? g.approved_text ?? g.client_text ?? g.title).slice(0, 600),
      approved_approach: d.approach ?? null,
      approved_at: new Date().toISOString(),
      approved_by: actor.userId,
      approved_read: { expectedKg: g.feasibility?.projection?.expectedKg ?? null, nowKg: g.feasibility?.nowKg ?? null, score: g.feasibility?.score ?? null, confidence: g.feasibility?.confidence ?? null, at: new Date().toISOString() },
      ...(d.deadline !== undefined ? { deadline: d.deadline } : {}),
      ...(d.clientFacing != null ? { client_facing: d.clientFacing } : {}),
      // a unit the coach approved is a unit confirmed
      ...(g.client_unit_source === "inferred" && unit && g.client_unit === unit ? { client_unit_source: "coach" } : {}),
      recommendation_status: g.recommendation_status === "open" ? "approved" : g.recommendation_status,
      ...(g.kind === "bodyweight" && kg != null && g.feasibility?.nowKg != null ? { direction: kg < g.feasibility.nowKg ? "down" : "up" } : {}),
    };
    action = g.status === "active" ? "edited" : "approved";
  } else if (d.action === "dismiss") {
    patch = { status: "dismissed" };
  } else if (d.action === "archive") {
    patch = { status: "archived" };
  } else if (d.action === "reopen") {
    if (OPEN_STATUSES.includes(g.status)) return g;
    patch = { status: g.approved_kg != null || g.approved_text ? "active" : "proposed", outcome: null };
  } else if (d.action === "client_facing") {
    patch = { client_facing: d.clientFacing };
  } else if (d.action === "result") {
    const kg = d.actualValue != null ? r1(toKg(d.actualValue, d.unit ?? unitPref)) : null;
    patch = { status: d.result, outcome: { result: d.result, actualKg: kg, at: localToday(client?.timezone), source: "coach", projectedAtApprovalKg: g.approved_read?.expectedKg ?? null, nowAtApprovalKg: g.approved_read?.nowKg ?? null } };
  }
  const { data, error } = await sb.from("client_goals").update(patch).eq("id", g.id).eq("version", g.version).select("*").maybeSingle();
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new Error("There's already an open goal like this one. Close that one first.");
    throw new Error(error.message);
  }
  if (!data) throw new Error("The goal changed since you opened it. Refresh and try again.");
  const next = data as GoalRow;
  await goalEvent(sb, g, actor, action, {
    before: { status: g.status, approved_kg: g.approved_kg, approved_text: g.approved_text, deadline: g.deadline },
    after: { status: next.status, approved_kg: next.approved_kg, approved_text: next.approved_text, deadline: next.deadline, approach: next.approved_approach },
  });
  // fresh read with the new target
  await assessClient(sb, g.client_id, { force: true }).catch((e) => console.warn("[goal-intel] reread failed", e?.message));
  const fresh = await goalById(sb, g.id);
  // tell the client about an approved, client-facing change (after the review window)
  const changedTarget = next.status === "active" && (Number(g.approved_kg ?? NaN) !== Number(next.approved_kg ?? NaN) || (g.approved_text ?? "") !== (next.approved_text ?? "") || g.status !== "active");
  if (changedTarget && next.client_facing && client?.user_id && next.kind !== "preference") {
    await enqueueUpdate(sb, fresh, g.status === "active" ? (g.approved_kg != null ? Number(g.approved_kg) : null) : null, actor, client as GoalClient).catch((e) => console.warn("[goal-intel] update not queued", e?.message));
  }
  return fresh;
}

/** A goal the coach adds directly: approved at once. */
export async function addGoal(
  sb: Db,
  clientId: string,
  x: { kind: GoalRow["kind"]; lift?: Lift | null; value?: number | null; unit?: Unit | null; deadline?: string | null; competitionId?: string | null; text?: string | null; clientFacing?: boolean },
  actor: Actor,
): Promise<GoalRow> {
  const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Client not found");
  const measurable = x.kind === "lift" || x.kind === "total" || x.kind === "bodyweight";
  if (measurable && !(x.value && x.value > 0)) throw new Error("Give it a number.");
  if (x.kind === "lift" && !x.lift) throw new Error("Pick the lift.");
  if (!measurable && !(x.text ?? "").trim()) throw new Error("Say what the goal is.");
  let comp: { name: string; meet_date: string } | null = null;
  if (x.competitionId) {
    const { data } = await sb.from("competitions").select("name, meet_date, client_id").eq("id", x.competitionId).maybeSingle();
    if (!data || data.client_id !== clientId) throw new Error("That competition isn't theirs.");
    comp = data;
  }
  const unit = x.unit ?? unitOf(client);
  const deadline = comp?.meet_date ?? x.deadline ?? null;
  const key = dedupeKey({ kind: x.kind, lift: x.lift ?? null, competitionId: x.competitionId ?? null, deadline: x.competitionId ? null : deadline, text: x.text, names: [client.first_name, client.preferred_name].filter(Boolean) as string[] });
  const kg = measurable ? r1(toKg(x.value as number, unit)) : null;
  const row = {
    client_id: clientId,
    kind: x.kind,
    lift: x.kind === "lift" ? x.lift : null,
    title: goalTitle({ kind: x.kind, lift: x.lift ?? null, eventTitle: comp?.name ?? null, deadline: comp ? null : deadline, text: x.text }),
    direction: x.kind === "lift" || x.kind === "total" ? "up" : null,
    approved_value: measurable ? x.value : null,
    approved_unit: measurable ? unit : null,
    approved_kg: kg,
    approved_text: measurable ? null : (x.text ?? "").trim().slice(0, 600),
    approved_at: new Date().toISOString(),
    approved_by: actor.userId,
    deadline,
    competition_id: x.competitionId ?? null,
    event_title: comp?.name ?? null,
    status: "active",
    client_facing: x.clientFacing ?? true,
    source_kind: "coach",
    source_speaker: "coach",
    source_at: new Date().toISOString(),
    dedupe_key: key,
    created_by: actor.userId,
  };
  const { data, error } = await sb.from("client_goals").insert(row).select("*").maybeSingle();
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new Error("There's already an open goal like this one: edit that one instead.");
    throw new Error(error.message);
  }
  const g = data as GoalRow;
  await goalEvent(sb, g, actor, "created", { from: "coach" });
  const { goals } = await assessClient(sb, clientId, { force: true });
  const fresh = goals.find((x) => x.id === g.id) ?? g;
  if (fresh.client_facing && client.user_id) {
    // a bodyweight goal's direction once there's a read
    if (fresh.kind === "bodyweight" && kg != null && fresh.feasibility?.nowKg != null && !fresh.direction) {
      await sb.from("client_goals").update({ direction: kg < fresh.feasibility.nowKg ? "down" : "up" }).eq("id", fresh.id);
    }
    await enqueueUpdate(sb, fresh, null, actor, client as GoalClient).catch((e) => console.warn("[goal-intel] update not queued", e?.message));
  }
  return fresh;
}

/**
 * The coach's call on Cleo's recommendation: approve it (a target suggestion
 * becomes the approved target; a programming change hands its words to
 * Adjust program, which shows and applies it; data or protection is noted),
 * dismiss it, or keep the current plan. Nothing changes a program here.
 */
export async function decideRecommendation(
  sb: Db,
  goalId: string,
  d: { action: "approve" | "dismiss" | "maintain"; value?: number | null; unit?: Unit | null },
  actor: Actor,
): Promise<{ goal: GoalRow; handoff: string | null }> {
  const g = await goalById(sb, goalId);
  const rec = g.recommendation;
  if (!rec) throw new Error("There's no recommendation on this goal.");
  if (d.action === "dismiss" || d.action === "maintain") {
    const { data, error } = await sb.from("client_goals").update({ recommendation_status: d.action === "dismiss" ? "dismissed" : "maintained" }).eq("id", g.id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    await goalEvent(sb, g, actor, d.action === "dismiss" ? "recommendation_dismissed" : "plan_maintained", { kind: rec.kind, line: rec.line });
    return { goal: data as GoalRow, handoff: null };
  }
  let handoff: string | null = null;
  if ((rec.kind === "adjust_target" || rec.kind === "raise_target" || rec.kind === "protect") && (d.value != null || rec.suggestedKg != null)) {
    const unit = d.unit ?? g.approved_unit ?? g.client_unit ?? "kg";
    const value = d.value ?? cleanValue(rec.suggestedKg as number, unit);
    await decideGoal(sb, g.id, { action: "approve", value, unit, approach: d.value != null ? null : rec.approach }, actor);
  } else if (rec.kind === "adjust_program") {
    const f = g.feasibility;
    const unit = (f?.unit ?? "kg") as Unit;
    const w = (kg: number | null | undefined) => (kg == null ? "?" : `${cleanValue(kg, unit)} ${unit}`);
    handoff = [
      `${g.title}: the approved target is ${w(g.approved_kg)}${g.deadline ? ` by ${g.deadline}` : ""}.`,
      f?.projection ? `Their projection is ${w(f.projection.expectedKg)} (${w(f.projection.lowKg)}–${w(f.projection.highKg)}), ${f.score}/100 feasibility.` : "",
      f?.pace?.requiredPctPerWeek != null ? `It needs about ${f.pace.requiredPctPerWeek}% a week${f.pace.demonstratedPctPerWeek != null ? `; they've shown ${f.pace.demonstratedPctPerWeek}%` : ""}.` : "",
      "Propose the smallest change to the remaining programming that would close the gap (progression, intensity or frequency on that lift), keeping trained workouts and what's working. Say the expected benefit.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const { data, error } = await sb.from("client_goals").update({ recommendation_status: d.value != null ? "edited" : "approved" }).eq("id", g.id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  await goalEvent(sb, g, actor, "recommendation_approved", { kind: rec.kind, line: rec.line, value: d.value ?? null });
  return { goal: data as GoalRow, handoff };
}

/* ------------------------------------------------------------------ */
/* The client update outbox                                           */

export type GoalUpdateSettings = { reviewMinutes: number; autoSend: boolean };

export async function readUpdateSettings(sb: Db): Promise<GoalUpdateSettings> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "goal_updates").maybeSingle();
  const v = (data?.value ?? {}) as any;
  const m = Number(v.review_minutes);
  return {
    reviewMinutes: Number.isFinite(m) ? Math.min(MAX_REVIEW_MINUTES, Math.max(MIN_REVIEW_MINUTES, Math.round(m))) : DEFAULT_REVIEW_MINUTES,
    autoSend: v.auto_send !== false,
  };
}

function changeFor(g: GoalRow, beforeKg: number | null, unit: Unit): OutboxChange {
  return {
    goalId: g.id,
    version: g.version,
    kind: g.kind,
    lift: g.lift,
    title: g.title,
    eventTitle: g.event_title,
    deadline: g.deadline,
    targetKg: g.approved_kg != null ? Number(g.approved_kg) : null,
    targetText: g.approved_kg == null ? g.approved_text : null,
    unit: (g.approved_unit as Unit) ?? unit,
    beforeKg,
  };
}

/** Add an approved change to the client's waiting update (one per client), restarting its window. */
export async function enqueueUpdate(sb: Db, g: GoalRow, beforeKg: number | null, actor: Actor, client: GoalClient): Promise<void> {
  const settings = await readUpdateSettings(sb);
  const unit = unitOf(client);
  const change = changeFor(g, beforeKg, unit);
  const now = new Date();
  const sendAfter = new Date(now.getTime() + settings.reviewMinutes * 60_000).toISOString();
  const { data: open } = await sb.from("client_update_outbox").select("*").eq("client_id", g.client_id).in("status", ["pending", "held"]).maybeSingle();
  if (open) {
    const changes = mergeChanges((open.changes ?? []) as OutboxChange[], change);
    const edited = !!open.edited_at;
    const patch: Record<string, unknown> = {
      changes,
      last_change_at: now.toISOString(),
      review_minutes: settings.reviewMinutes,
      send_after: sendAfter,
      next_attempt_at: null,
      wait_reason: "window",
      status_line: null,
    };
    if (edited) {
      // the coach's own words stay theirs: a newer change holds it for them to check
      Object.assign(patch, { status: "held", hold_reason: "changed_after_edit", status_line: "A newer change came in after your edit: check it and send." });
    } else {
      Object.assign(patch, { status: "pending", hold_reason: null, body: buildUpdateMessage({ firstName: firstName(client), changes }) });
    }
    const { error } = await sb.from("client_update_outbox").update(patch).eq("id", open.id).in("status", ["pending", "held"]);
    if (error) throw new Error(error.message);
    await goalEvent(sb, g, actor, "client_update_queued", { outbox_id: open.id, joined: true });
    return;
  }
  const body = buildUpdateMessage({ firstName: firstName(client), changes: [change] });
  const { data, error } = await sb
    .from("client_update_outbox")
    .insert({ client_id: g.client_id, sender_id: actor.userId, status: "pending", body, changes: [change], review_minutes: settings.reviewMinutes, send_after: sendAfter, wait_reason: "window", last_change_at: now.toISOString() })
    .select("id")
    .maybeSingle();
  if (error) {
    // another request opened one at the same moment: join it
    if (/duplicate key/i.test(error.message)) return enqueueUpdate(sb, g, beforeKg, actor, client);
    throw new Error(error.message);
  }
  await goalEvent(sb, g, actor, "client_update_queued", { outbox_id: data?.id });
}

export type OutboxAction = { action: "edit"; body: string } | { action: "hold" } | { action: "resume" } | { action: "cancel" } | { action: "send_now" };

/** The coach on the waiting update: edit it, hold it, put it back on its window, cancel it, or send it now. */
export async function outboxAction(sb: Db, outboxId: string, a: OutboxAction, actor: Actor): Promise<{ status: string }> {
  const { data: o, error } = await sb.from("client_update_outbox").select("*").eq("id", outboxId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!o) throw new Error("That update wasn't found.");
  if (!["pending", "held"].includes(o.status)) throw new Error(`It's already ${o.status}.`);
  const evt = (action: string, detail: Record<string, unknown> = {}) => goalEvent(sb, { id: null, client_id: o.client_id }, actor, action, { outbox_id: o.id, ...detail });
  if (a.action === "edit") {
    const body = a.body.trim();
    if (body.length < 2) throw new Error("The message is empty.");
    await sb.from("client_update_outbox").update({ body: body.slice(0, 2000), edited_at: new Date().toISOString(), edited_by: actor.userId, ...(o.hold_reason === "changed_after_edit" ? { status: "pending", hold_reason: null, status_line: null } : {}) }).eq("id", o.id);
    await evt("client_update_edited");
    return { status: o.hold_reason === "changed_after_edit" ? "pending" : o.status };
  }
  if (a.action === "hold") {
    await sb.from("client_update_outbox").update({ status: "held", hold_reason: "coach", status_line: "Held: it won't go until you send it." }).eq("id", o.id);
    await evt("client_update_held");
    return { status: "held" };
  }
  if (a.action === "resume") {
    const settings = await readUpdateSettings(sb);
    await sb.from("client_update_outbox").update({ status: "pending", hold_reason: null, status_line: null, wait_reason: "window", send_after: new Date(Date.now() + settings.reviewMinutes * 60_000).toISOString(), next_attempt_at: null }).eq("id", o.id);
    await evt("client_update_resumed");
    return { status: "pending" };
  }
  if (a.action === "cancel") {
    await sb.from("client_update_outbox").update({ status: "cancelled", closed_by: actor.userId, status_line: "Cancelled" }).eq("id", o.id);
    await evt("client_update_cancelled");
    return { status: "cancelled" };
  }
  // send now: the coach's choice, so no window or presence check; still only what's current
  const res = await deliverOutbox(sb, o.id, { manualBy: actor.userId });
  return { status: res };
}

/** Is there a heartbeat or activity right now? (app_sessions beats once a minute while the app is on screen) */
async function presenceFor(sb: Db, userId: string | null, lastActiveAt: string | null): Promise<ReturnType<typeof presenceOf>> {
  if (!userId) return "unknown";
  const { data } = await sb.from("app_sessions").select("last_seen_at").eq("user_id", userId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  return presenceOf({ lastBeatAt: data?.last_seen_at ?? null, lastActiveAt, now: Date.now() });
}

async function quietFor(sb: Db, userId: string, tz: string | null): Promise<{ now: boolean; endsAt: number | null }> {
  const { data: prefs } = await sb.from("push_notification_preferences").select("quiet_hours_enabled, quiet_start, quiet_end, timezone").eq("user_id", userId).maybeSingle();
  const on = prefs?.quiet_hours_enabled ?? true;
  if (!on) return { now: false, endsAt: null };
  const zone = prefs?.timezone || tz || "America/Winnipeg";
  const { localHour, quietEndsAt } = await import("@/lib/push/push.server");
  const start = prefs?.quiet_start ?? 22;
  const end = prefs?.quiet_end ?? 7;
  const quiet = inQuiet(localHour(zone), start, end);
  return { now: quiet, endsAt: quiet ? quietEndsAt(zone, end).getTime() : null };
}

/**
 * Process one waiting update: drop anything outdated, check the window, their
 * quiet hours and whether they're in the app, and send it (by itself, or now
 * when the coach tapped Send). Claimed before sending, never twice.
 */
export async function deliverOutbox(sb: Db, outboxId: string, opts: { manualBy?: string | null } = {}): Promise<string> {
  const { data: o } = await sb.from("client_update_outbox").select("*").eq("id", outboxId).maybeSingle();
  if (!o || !["pending", "held"].includes(o.status)) return o?.status ?? "missing";
  if (!opts.manualBy && o.status !== "pending") return o.status;
  const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, last_active_at, assigned_coach_id, service_tier, archived").eq("id", o.client_id).maybeSingle();
  const changes = (o.changes ?? []) as OutboxChange[];
  const goalIds = Array.from(new Set(changes.map((c) => c.goalId)));
  const { data: goals } = goalIds.length ? await sb.from("client_goals").select("id, status, version, approved_kg, client_facing").in("id", goalIds) : { data: [] };
  const current = currentChanges(changes, (goals ?? []) as any[]);
  const now = Date.now();
  const update = (patch: Record<string, unknown>) => sb.from("client_update_outbox").update({ ...patch, attempts: (o.attempts ?? 0) + 1 }).eq("id", o.id).in("status", ["pending", "held"]);
  if (!client?.user_id || client.archived || client.service_tier !== "coaching") {
    await update({ status: "cancelled", status_line: "They no longer have a coaching login to tell." });
    return "cancelled";
  }
  // outdated or withdrawn lines drop out; the words follow (unless the coach wrote them)
  const edited = !!o.edited_at;
  let body: string = o.body;
  if (current.length !== latestPerGoal(changes).length && current.length) {
    if (edited) {
      await update({ status: "held", hold_reason: "changed_after_edit", status_line: "Something in it changed after your edit: check it and send." });
      return "held";
    }
    body = buildUpdateMessage({ firstName: firstName(client), changes: current });
  }
  if (!opts.manualBy) {
    const settings = await readUpdateSettings(sb);
    const presence = await presenceFor(sb, client.user_id, client.last_active_at);
    const quiet = await quietFor(sb, client.user_id, client.timezone);
    const decision = sendDecision({
      now,
      sendAfter: Date.parse(o.send_after),
      createdAt: Date.parse(o.created_at),
      autoSend: settings.autoSend,
      presence,
      quiet,
      currentChanges: current.length,
      editedThenChanged: o.hold_reason === "changed_after_edit",
    });
    if (!decision.send) {
      if ("hold" in decision) {
        if (decision.hold === "nothing_current") {
          await update({ status: "cancelled", status_line: "Nothing in it is current any more." });
          return "cancelled";
        }
        await update({ status: "held", hold_reason: decision.hold, status_line: decision.line, body, changes: current });
        return "held";
      }
      await update({ wait_reason: decision.wait, next_attempt_at: new Date(decision.retryAt).toISOString(), status_line: decision.line, body, changes: current });
      return "pending";
    }
  } else if (!current.length) {
    await update({ status: "cancelled", status_line: "Nothing in it is current any more." });
    return "cancelled";
  }
  // claim it, then send once
  const { data: claimed } = await sb
    .from("client_update_outbox")
    .update({ status: "sending", body, changes: current })
    .eq("id", o.id)
    .in("status", ["pending", "held"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "busy";
  try {
    const senderId = o.sender_id ?? opts.manualBy ?? (await coachUserOf(sb, client.assigned_coach_id));
    if (!senderId) throw new Error("No coach to send it as.");
    const { data: same } = await sb.from("messages").select("id").eq("client_id", o.client_id).contains("attachments", JSON.stringify([{ kind: "goal_update", outbox_id: o.id }])).limit(1);
    let messageId: string | null = same?.[0]?.id ?? null;
    if (!messageId) {
      const at = new Date().toISOString();
      const { data: msg, error } = await sb
        .from("messages")
        .insert({
          client_id: o.client_id,
          sender_id: senderId,
          sender_role: "admin",
          body,
          attachments: [{ kind: "goal_update", outbox_id: o.id, automatic: !opts.manualBy }],
          message_type: "Goals",
          is_internal_note: false,
          // waited out the coach's window; never presented as typed right now
          is_automated: !opts.manualBy,
          delivery_status: "sent",
          sent_at: at,
          read_by_admin_at: at,
        })
        .select("id, client_id, sender_id, sender_role, is_internal_note, body, attachments")
        .single();
      if (error) throw new Error(error.message);
      messageId = msg.id;
      try {
        const { pushNewMessage } = await import("@/lib/push/message-push.server");
        await pushNewMessage(sb, msg);
      } catch (e: any) {
        console.warn("[goal-intel] push failed", e?.message);
      }
    }
    await sb.from("client_update_outbox").update({ status: "sent", message_id: messageId, sent_at: new Date().toISOString(), sent_by: opts.manualBy ?? null, status_line: opts.manualBy ? "Sent" : "Sent automatically", wait_reason: null, hold_reason: null }).eq("id", o.id);
    for (const c of current) await goalEvent(sb, { id: c.goalId, client_id: o.client_id }, { userId: opts.manualBy ?? null, kind: opts.manualBy ? "coach" : "system" }, "client_told", { outbox_id: o.id, message_id: messageId, version: c.version });
    return "sent";
  } catch (e: any) {
    await sb.from("client_update_outbox").update({ status: "pending", next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(), status_line: `Couldn't send: ${String(e?.message ?? e).slice(0, 120)}` }).eq("id", o.id).eq("status", "sending");
    if ((o.attempts ?? 0) >= 5) await sb.from("client_update_outbox").update({ status: "failed" }).eq("id", o.id).eq("status", "pending");
    return "failed";
  }
}

async function coachUserOf(sb: Db, coachId: string | null): Promise<string | null> {
  if (coachId) {
    const { data } = await sb.from("coaches").select("user_id").eq("id", coachId).maybeSingle();
    if (data?.user_id) return data.user_id;
  }
  const { data: owner } = await sb.from("business_owners").select("user_id").limit(1).maybeSingle();
  return owner?.user_id ?? null;
}

/* ------------------------------------------------------------------ */
/* What the coach sees                                                */

export type GoalsView = {
  clientId: string;
  firstName: string | null;
  unit: Unit;
  today: string;
  goals: GoalRow[];
  outbox: any | null;
  settings: GoalUpdateSettings;
  history: Array<{ goal_id: string | null; actor: string; action: string; detail: any; at: string }>;
  competitions: Array<{ id: string; name: string; meet_date: string }>;
};

/** One client's goals, read fresh when stale, with the waiting update and the recent history. */
export async function goalsView(sb: Db, clientId: string, opts: { refresh?: boolean } = {}): Promise<GoalsView> {
  const goals0 = await readGoals(sb, clientId);
  const stale = goals0.some((g) => OPEN_STATUSES.includes(g.status) && (!g.assessed_at || Date.now() - Date.parse(g.assessed_at) > 60 * 60_000));
  let goals = goals0;
  let loaded: LoadedGoalContext | null = null;
  if (stale || opts.refresh) {
    const r = await assessClient(sb, clientId, { force: !!opts.refresh }).catch((e) => {
      console.warn("[goal-intel] read failed", e?.message);
      return null;
    });
    if (r) {
      goals = r.goals;
      loaded = r.loaded;
    }
  }
  const [client, outbox, history, comps, settings] = await Promise.all([
    loaded ? Promise.resolve(loaded.client) : sb.from("clients").select("id, first_name, preferred_name, full_name, preferred_weight_unit, timezone").eq("id", clientId).maybeSingle().then((r: any) => r.data),
    sb.from("client_update_outbox").select("*").eq("client_id", clientId).in("status", ["pending", "held", "sending"]).maybeSingle().then((r: any) => r.data ?? null),
    sb.from("client_goal_events").select("goal_id, actor, action, detail, at").eq("client_id", clientId).order("at", { ascending: false }).limit(60).then((r: any) => r.data ?? []),
    sb.from("competitions").select("id, name, meet_date").eq("client_id", clientId).eq("status", "upcoming").order("meet_date").limit(10).then((r: any) => r.data ?? []),
    readUpdateSettings(sb),
  ]);
  return {
    clientId,
    firstName: client ? firstName(client) : null,
    unit: client?.preferred_weight_unit === "kg" ? "kg" : "lb",
    today: localToday(client?.timezone),
    goals,
    outbox,
    settings,
    history,
    competitions: comps,
  };
}

/** One worker pass over clients whose goals are due a read (stale, new, or past their date). */
export async function assessDueClients(sb: Db, opts: { limit?: number; budgetMs?: number } = {}): Promise<Array<{ clientId: string; ok: boolean; error?: string }>> {
  const started = Date.now();
  const stale = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const { data } = await sb
    .from("client_goals")
    .select("client_id, assessed_at, deadline, status, outcome")
    .in("status", OPEN_STATUSES)
    .or(`assessed_at.is.null,assessed_at.lt.${stale}`)
    .limit(500);
  const ids = Array.from(new Set(((data ?? []) as any[]).map((r) => r.client_id))).slice(0, opts.limit ?? 15);
  const out: Array<{ clientId: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    if (Date.now() - started > (opts.budgetMs ?? 60_000)) break;
    try {
      await assessClient(sb, id);
      // an unchanged read still counts as read
      await sb.from("client_goals").update({ assessed_at: new Date().toISOString() }).eq("client_id", id).in("status", OPEN_STATUSES).or(`assessed_at.is.null,assessed_at.lt.${stale}`);
      out.push({ clientId: id, ok: true });
    } catch (e: any) {
      out.push({ clientId: id, ok: false, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}

export { APPROACH_LABEL, LB_PER_KG };
