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
import { dedupeKey, goalNotes, goalTitle, inferUnit, measurableGoals, statedGoals, wordedGoal, type GoalCandidate } from "./extract";
import { loadGoalContext, localToday, readGoals, type GoalClient, type LoadedGoalContext } from "./load.server";
import {
  DEFAULT_REVIEW_MINUTES,
  MAX_REVIEW_MINUTES,
  MIN_REVIEW_MINUTES,
  MAX_SEND_FAILURES,
  STALE_SENDING_MS,
  buildUpdateMessage,
  changesMoved,
  currentChanges,
  inQuiet,
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
  let direction: "up" | "down" | "hold" = "up";
  if (g.kind === "bodyweight") {
    const type = g.profile_type;
    // from where they started (the approval's read), never from where they ended up
    const start = g.approved_read?.nowKg ?? g.feasibility?.baselineKg ?? null;
    const d =
      type === "maintain"
        ? "hold"
        : g.direction ?? (type === "gain" ? "up" : type === "lose" || type === "performance_cut" ? "down" : start != null && Math.abs(target - start) >= 0.3 ? (target < start ? "down" : "up") : null);
    if (!d) return null; // can't tell a cut from a gain: the coach records it
    direction = d;
  }
  const result =
    direction === "hold"
      ? actual == null
        ? null
        : Math.abs(actual - target) <= Math.max(1, target * 0.02)
          ? "achieved"
          : "missed"
      : resolveOutcome({ kind: g.kind, targetKg: target, actualKg: actual, direction });
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
  const { data: rows, error: readErr } = await sb
    .from("client_goals")
    .select("*")
    .eq("client_id", client.id)
    .eq("dedupe_key", key)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (readErr) throw new Error(readErr.message);
  const sameKey = (rows ?? []) as GoalRow[];
  const existing = sameKey.find((g) => OPEN_STATUSES.includes(g.status)) ?? null;
  const context = [meta.context, note].filter(Boolean).join(" ").slice(0, 1200) || null;
  const tentative = !!(cand.tentative || meta.tentative);
  const saidAt = Date.parse(meta.sourceAt ?? "") || null;
  if (!existing) {
    // what the coach dismissed or closed isn't proposed again from the same words, or from anything said before they closed it
    const closedBefore = sameKey.find((g) => !OPEN_STATUSES.includes(g.status) && (g.source_id === meta.sourceId || (saidAt != null && saidAt <= Date.parse(g.updated_at))));
    if (closedBefore) return "skipped";
  }
  if (existing) {
    const g = existing as GoalRow;
    // a coach's note from a call is context, never the client's own number
    if (meta.speaker === "coach" && g.source_speaker !== "coach") return "same";
    // something said earlier never replaces something said later (an old meeting read after a newer message)
    if (g.source_id !== meta.sourceId && saidAt != null && g.source_at && saidAt < Date.parse(g.source_at)) return "same";
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
    // only a number is told to them: a preference, and a goal in words (the analysis's words, not theirs), never are
    client_facing: isNumber && cand.kind !== "preference",
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

/** What a meeting's goals are read from (its analysis's goal lines and the coach's goal notes), as one fingerprint. */
export function meetingContentHash(s: { analysis: any; live: any }): string {
  const a = s.analysis ?? {};
  const parts = JSON.stringify([
    ((a.items ?? []) as any[]).filter((it) => it?.kind === "goal" || it?.kind === "objective").map((it) => [it.text, it.quote, it.speaker, it.due, it.basis]),
    ((a.intelligence ?? []) as any[]).filter((it) => it?.kind === "goal").map((it) => [it.text, it.quote, it.speaker, it.expiresOn]),
    goalNotes(String(s.live?.notes ?? "")),
  ]);
  let h = 2166136261;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a:${(h >>> 0).toString(16)}:${parts.length}`;
}

/**
 * The goals a meeting's analysis (and the coach's goal notes from the call)
 * say, into the ledger. Read again only when those words change: opening the
 * meeting or any other write to it never proposes a dismissed goal again.
 */
export async function extractFromMeeting(sb: Db, sessionId: string): Promise<{ created: number; updated: number; unchanged?: boolean }> {
  const { data: s, error } = await sb
    .from("coaching_sessions")
    .select("id, client_id, competition_id, event, analysis, analysis_status, live, updated_at, scheduled_at, created_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) return { created: 0, updated: 0 };
  const contentHash = meetingContentHash(s);
  const { data: prev, error: prevErr } = await sb.from("client_goal_sources").select("content_hash").eq("source_kind", "meeting").eq("source_id", s.id).maybeSingle();
  if (prevErr) throw new Error(prevErr.message);
  if (prev?.content_hash === contentHash) {
    await sb.from("client_goal_sources").update({ scanned_at: new Date().toISOString() }).eq("source_kind", "meeting").eq("source_id", s.id);
    return { created: 0, updated: 0, unchanged: true };
  }
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
    // the coach's own notes from the call, only where they're about goals or attempts ("Thirds: squat 220-225 …")
    const notes = goalNotes(String((s.live as any)?.notes ?? ""));
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
  const { error: srcErr } = await sb.from("client_goal_sources").upsert({ source_kind: "meeting", source_id: s.id, client_id: s.client_id, content_hash: contentHash, goals: created + updated, scanned_at: new Date().toISOString() });
  if (srcErr) throw new Error(srcErr.message);
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

/** A message the app made for them (a workout note, a pain report, a card), not words they typed to the coach. */
export function isCardMessage(m: { body?: string | null; attachments?: unknown }): boolean {
  const atts = Array.isArray(m.attachments) ? (m.attachments as any[]) : [];
  return atts.some((a) => a && typeof a === "object" && typeof a.kind === "string") || /^\s*📝/.test(String(m.body ?? ""));
}

const MESSAGE_PAGE = 500;

/** Clients' own chat messages since the last read: strict, numbers only, coaching clients only. */
export async function extractFromMessages(sb: Db): Promise<number> {
  const { data: setting, error: setErr } = await sb.from("app_settings").select("value").eq("key", "goal_intel_scan").maybeSingle();
  if (setErr) throw new Error(setErr.message);
  const scan = settingJson(setting?.value);
  const since = typeof scan.messages_at === "string" ? scan.messages_at : new Date(Date.now() - 7 * 86_400_000).toISOString();
  // messages at exactly the watermark that were already read (several can share one time)
  const readAtMark = new Set<string>(Array.isArray(scan.messages_ids) ? scan.messages_ids : []);
  const startedAt = new Date().toISOString();
  const { data: msgs, error } = await sb
    .from("messages")
    .select("id, client_id, body, attachments, created_at, is_internal_note, deleted_at")
    .eq("sender_role", "client")
    .gte("created_at", since)
    .lte("created_at", startedAt)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MESSAGE_PAGE);
  // a read that failed moves nothing: that window is read next time
  if (error) throw new Error(error.message);
  let n = 0;
  const clients = new Map<string, GoalClient | null>();
  const list = (msgs ?? []) as any[];
  for (const m of list) {
    if (m.created_at === since && readAtMark.has(m.id)) continue;
    if (m.is_internal_note || m.deleted_at || !m.client_id || isCardMessage(m)) continue;
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
  // a full page: carry on from its last message next time (keeping which ones at that moment were read)
  let mark = startedAt;
  let ids: string[] = [];
  if (list.length === MESSAGE_PAGE) {
    mark = list[list.length - 1].created_at;
    ids = list.filter((m) => m.created_at === mark).map((m) => m.id);
    if (mark === since) ids = Array.from(new Set([...readAtMark, ...ids]));
  }
  const { error: saveErr } = await sb.from("app_settings").upsert({ key: "goal_intel_scan", value: JSON.stringify({ ...scan, messages_at: mark, messages_ids: ids.slice(-2000) }) }, { onConflict: "key" });
  if (saveErr) throw new Error(saveErr.message);
  return n;
}

/* ------------------------------------------------------------------ */
/* The coach's decisions                                              */

export type GoalDecision =
  | {
      action: "approve";
      value?: number | null;
      unit?: Unit | null;
      approach?: ApproachKey | null;
      /** the approach's target the coach was shown, kg (the read can move under an open card) */
      approachKg?: number | null;
      deadline?: string | null;
      text?: string | null;
      clientFacing?: boolean | null;
    }
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

const sameKg = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  a == null || b == null ? a == null && b == null : Math.abs(Number(a) - Number(b)) < 0.05;

/**
 * A bodyweight target's direction and the profile's type when it's approved:
 * the direction already on the goal wins (a cut stays a cut), else it's read
 * from where they started; a maintain goal stays a maintain goal, and a type
 * the new target contradicts is dropped so the mirror reads it from the goal.
 */
function bodyweightApproval(g: GoalRow, kg: number): Record<string, unknown> {
  const start = g.feasibility?.baselineKg ?? g.feasibility?.nowKg ?? null;
  const direction = g.direction ?? (start != null && Math.abs(kg - start) >= 0.3 ? (kg < start ? "down" : "up") : null);
  const type = g.profile_type;
  const fits = type == null || type === "maintain" || type === "custom" || (direction === "down" && (type === "lose" || type === "performance_cut")) || (direction === "up" && type === "gain");
  return { ...(direction ? { direction } : {}), ...(fits ? {} : { profile_type: null }) };
}

/** Approve, dismiss or close a goal. An approved, client-facing change joins the client's waiting update. */
export async function decideGoal(sb: Db, goalId: string, d: GoalDecision, actor: Actor, opts: { expectVersion?: number | null } = {}): Promise<GoalRow> {
  const g = await goalById(sb, goalId);
  // the card was rendered from this version: a goal that changed since is checked again, never approved blind
  if (opts.expectVersion != null && opts.expectVersion !== g.version) throw new Error("This goal changed since you opened it. Check it again.");
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
        if (d.approachKg != null && Math.abs(opt.targetKg - d.approachKg) >= 0.05) throw new Error("The projection moved since you opened it. Check it again.");
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
      approved_read: {
        expectedKg: g.feasibility?.projection?.expectedKg ?? null,
        nowKg: g.feasibility?.nowKg ?? null,
        score: g.feasibility?.score ?? null,
        confidence: g.feasibility?.confidence ?? null,
        // what the projection was read from (a meet forecast never calibrates training trends)
        source: g.feasibility?.projection?.source ?? null,
        at: new Date().toISOString(),
      },
      ...(d.deadline !== undefined ? { deadline: d.deadline } : {}),
      ...(d.clientFacing != null ? { client_facing: d.clientFacing } : {}),
      // a unit the coach approved is a unit confirmed
      ...(g.client_unit_source === "inferred" && unit && g.client_unit === unit ? { client_unit_source: "coach" } : {}),
      recommendation_status: g.recommendation_status === "open" ? "approved" : g.recommendation_status,
      ...(g.kind === "bodyweight" && kg != null ? bodyweightApproval(g, kg) : {}),
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
  // tell the client about an approved, client-facing change (after the review window); a switch or a note is never news
  const changedTarget =
    (d.action === "approve" || d.action === "reopen") &&
    next.status === "active" &&
    (g.status !== "active" || !sameKg(g.approved_kg, next.approved_kg) || (g.approved_text ?? "").trim() !== (next.approved_text ?? "").trim());
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
  // only a lift or the total is tied to a meet here (that's what the form offers)
  if (x.kind !== "lift" && x.kind !== "total") x = { ...x, competitionId: null };
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
  // a bodyweight goal's direction once there's a read (it's how its outcome is judged later)
  if (fresh.kind === "bodyweight" && kg != null && fresh.feasibility?.nowKg != null && !fresh.direction && Math.abs(kg - fresh.feasibility.nowKg) >= 0.3) {
    await sb.from("client_goals").update({ direction: kg < fresh.feasibility.nowKg ? "down" : "up" }).eq("id", fresh.id);
  }
  if (fresh.client_facing && client.user_id) {
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
  d: { action: "approve" | "dismiss" | "maintain"; value?: number | null; unit?: Unit | null; expectKey?: string | null },
  actor: Actor,
): Promise<{ goal: GoalRow; handoff: string | null }> {
  const g = await goalById(sb, goalId);
  const rec = g.recommendation;
  if (!rec) throw new Error("There's no recommendation on this goal.");
  if (d.expectKey != null && d.expectKey !== rec.key) throw new Error("Cleo's recommendation changed since you opened it. Check it again.");
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
    await decideGoal(sb, g.id, { action: "approve", value, unit, approach: d.value != null ? null : rec.approach }, actor, { expectVersion: g.version });
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

/** app_settings.value is text holding JSON (an older row may already be an object): read it either way. */
export function settingJson(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const v = JSON.parse(value);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export async function readUpdateSettings(sb: Db): Promise<GoalUpdateSettings> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "goal_updates").maybeSingle();
  const v = settingJson(data?.value);
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
  // a few tries: another request can open or change the waiting update at the same moment
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = new Date();
    const sendAfter = new Date(now.getTime() + settings.reviewMinutes * 60_000).toISOString();
    const { data: open, error: readErr } = await sb.from("client_update_outbox").select("*").eq("client_id", g.client_id).in("status", ["pending", "held"]).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (open) {
      const changes = mergeChanges((open.changes ?? []) as OutboxChange[], change);
      const edited = !!open.edited_at;
      const patch: Record<string, unknown> = {
        changes,
        last_change_at: now.toISOString(),
        review_minutes: settings.reviewMinutes,
        send_after: sendAfter,
        next_attempt_at: null,
      };
      if (edited) {
        // the coach's own words stay theirs: a newer change holds it for them to check
        Object.assign(patch, { status: "held", hold_reason: "changed_after_edit", wait_reason: null, status_line: "A newer change came in after your edit: check it and send." });
      } else if (open.status === "held" && open.hold_reason !== "changed_after_edit" && open.hold_reason !== "nothing_current") {
        // held stays held (the coach's Hold, a send that failed, presence nobody can read): the words follow the new change
        Object.assign(patch, {
          body: buildUpdateMessage({ firstName: firstName(client), changes }),
          status_line: open.hold_reason === "coach" ? "Held, with a newer change added: it won't go until you send it." : open.status_line,
        });
      } else {
        Object.assign(patch, { status: "pending", hold_reason: null, wait_reason: "window", status_line: null, body: buildUpdateMessage({ firstName: firstName(client), changes }) });
      }
      // only over the row as it was read (a send or the coach's action in between: read again)
      const { data: joined, error } = await sb.from("client_update_outbox").update(patch).eq("id", open.id).eq("updated_at", open.updated_at).in("status", ["pending", "held"]).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!joined) continue;
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
      if (/duplicate key/i.test(error.message)) continue;
      throw new Error(error.message);
    }
    await goalEvent(sb, g, actor, "client_update_queued", { outbox_id: data?.id });
    return;
  }
  throw new Error("The client's update kept changing: try again.");
}

export type OutboxAction = { action: "edit"; body: string } | { action: "hold" } | { action: "resume" } | { action: "cancel" } | { action: "send_now" };

/** The coach on the waiting update: edit it, hold it, put it back on its window, cancel it, or send it now. */
export async function outboxAction(sb: Db, outboxId: string, a: OutboxAction, actor: Actor): Promise<{ status: string }> {
  const { data: o, error } = await sb.from("client_update_outbox").select("*").eq("id", outboxId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!o) throw new Error("That update wasn't found.");
  if (!["pending", "held"].includes(o.status)) throw new Error(o.status === "sending" ? "It's sending right now." : `It's already ${o.status}.`);
  const evt = (action: string, detail: Record<string, unknown> = {}) => goalEvent(sb, { id: null, client_id: o.client_id }, actor, action, { outbox_id: o.id, ...detail });
  // never over a send that started in between
  const write = async (patch: Record<string, unknown>) => {
    const { data, error: e } = await sb.from("client_update_outbox").update(patch).eq("id", o.id).in("status", ["pending", "held"]).select("id").maybeSingle();
    if (e) throw new Error(e.message);
    if (!data) throw new Error("It changed or started sending a moment ago. Check it again.");
  };
  if (a.action === "edit") {
    const body = a.body.trim();
    if (body.length < 2) throw new Error("The message is empty.");
    await write({ body: body.slice(0, 2000), edited_at: new Date().toISOString(), edited_by: actor.userId, ...(o.hold_reason === "changed_after_edit" ? { status: "pending", hold_reason: null, status_line: null } : {}) });
    await evt("client_update_edited");
    return { status: o.hold_reason === "changed_after_edit" ? "pending" : o.status };
  }
  if (a.action === "hold") {
    await write({ status: "held", hold_reason: "coach", status_line: "Held: it won't go until you send it." });
    await evt("client_update_held");
    return { status: "held" };
  }
  if (a.action === "resume") {
    const settings = await readUpdateSettings(sb);
    await write({ status: "pending", hold_reason: null, status_line: null, wait_reason: "window", send_after: new Date(Date.now() + settings.reviewMinutes * 60_000).toISOString(), next_attempt_at: null, send_failures: 0 });
    await evt("client_update_resumed");
    return { status: "pending" };
  }
  if (a.action === "cancel") {
    await write({ status: "cancelled", closed_by: actor.userId, status_line: "Cancelled" });
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

/** The message already sent for an update, by its outbox id (a send is never made twice). */
async function sentMessageFor(sb: Db, o: { id: string; client_id: string }): Promise<string | null> {
  const { data, error } = await sb.from("messages").select("id").eq("client_id", o.client_id).contains("attachments", JSON.stringify([{ kind: "goal_update", outbox_id: o.id }])).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

/**
 * Process one waiting update: drop anything outdated, check the window, their
 * quiet hours and whether they're in the app, and send it (by itself, or now
 * when the coach tapped Send). Claimed from the row exactly as it was read, so
 * a Hold, an edit or a newer change landing in between always wins; never twice.
 */
export async function deliverOutbox(sb: Db, outboxId: string, opts: { manualBy?: string | null } = {}): Promise<string> {
  const { data: o } = await sb.from("client_update_outbox").select("*").eq("id", outboxId).maybeSingle();
  if (!o || !["pending", "held"].includes(o.status)) return o?.status ?? "missing";
  if (!opts.manualBy && o.status !== "pending") return o.status;
  const { data: client } = await sb.from("clients").select("id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, last_active_at, assigned_coach_id, service_tier, archived").eq("id", o.client_id).maybeSingle();
  const changes = (o.changes ?? []) as OutboxChange[];
  const goalIds = Array.from(new Set(changes.map((c) => c.goalId)));
  const { data: goals } = goalIds.length
    ? await sb.from("client_goals").select("id, status, version, approved_kg, approved_text, deadline, event_title, client_facing").in("id", goalIds)
    : { data: [] };
  const current = currentChanges(changes, (goals ?? []) as any[]);
  const now = Date.now();
  // a wait or hold is written only over the row as it was read (waits are never counted as failures)
  const update = (patch: Record<string, unknown>) => sb.from("client_update_outbox").update(patch).eq("id", o.id).eq("updated_at", o.updated_at).in("status", ["pending", "held"]);
  if (!client?.user_id || client.archived || client.service_tier !== "coaching") {
    await update({ status: "cancelled", status_line: "They no longer have a coaching login to tell." });
    return "cancelled";
  }
  // outdated or withdrawn lines drop out, a moved meet's date follows; the words follow (unless the coach wrote them)
  const edited = !!o.edited_at;
  let body: string = o.body;
  if (current.length && changesMoved(changes, current)) {
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
  // claim it from exactly what was read (by itself: only a pending one), then send once
  const { data: claimed } = await sb
    .from("client_update_outbox")
    .update({ status: "sending", body, changes: current, claimed_at: new Date().toISOString() })
    .eq("id", o.id)
    .eq("updated_at", o.updated_at)
    .in("status", opts.manualBy ? ["pending", "held"] : ["pending"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "busy";
  let messageId: string | null = null;
  try {
    const senderId = o.sender_id ?? opts.manualBy ?? (await coachUserOf(sb, client.assigned_coach_id));
    if (!senderId) throw new Error("No coach to send it as.");
    messageId = await sentMessageFor(sb, o);
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
          // a prepared update, never a reply: it doesn't close their check-ins or forms (the attachment says who sent it)
          is_automated: true,
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
    const { error: doneErr } = await sb
      .from("client_update_outbox")
      .update({ status: "sent", message_id: messageId, sent_at: new Date().toISOString(), sent_by: opts.manualBy ?? null, status_line: opts.manualBy ? "Sent" : "Sent automatically", wait_reason: null, hold_reason: null })
      .eq("id", o.id)
      .eq("status", "sending");
    if (doneErr) throw new Error(doneErr.message);
    for (const c of current) await goalEvent(sb, { id: c.goalId, client_id: o.client_id }, { userId: opts.manualBy ?? null, kind: opts.manualBy ? "coach" : "system" }, "client_told", { outbox_id: o.id, message_id: messageId, version: c.version });
    return "sent";
  } catch (e: any) {
    const why = String(e?.message ?? e).slice(0, 120);
    // the message went but its record didn't: the next pass finds it by its outbox id and marks it sent
    const failures = (o.send_failures ?? 0) + (messageId ? 0 : 1);
    const handBack = failures >= MAX_SEND_FAILURES;
    await sb
      .from("client_update_outbox")
      .update(
        handBack
          ? { status: "held", hold_reason: "send_failed", send_failures: failures, claimed_at: null, status_line: `Couldn't send (${why}). Send it yourself or cancel.` }
          : { status: "pending", send_failures: failures, claimed_at: null, next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(), status_line: `Couldn't send yet: ${why}` },
      )
      .eq("id", o.id)
      .eq("status", "sending");
    return "failed";
  }
}

/**
 * A send that was claimed and never finished (the request was cut off): if its
 * message went, it's marked sent; otherwise it goes back to waiting, joining
 * the client's newer update if one opened meanwhile. Nothing is sent twice.
 */
export async function recoverStaleSending(sb: Db): Promise<number> {
  const { data: rows, error } = await sb.from("client_update_outbox").select("*").eq("status", "sending").limit(50);
  if (error) throw new Error(error.message);
  const cutoff = Date.now() - STALE_SENDING_MS;
  let n = 0;
  for (const o of (rows ?? []) as any[]) {
    if ((Date.parse(o.claimed_at ?? o.updated_at ?? "") || 0) >= cutoff) continue;
    const messageId = await sentMessageFor(sb, o).catch(() => null);
    if (messageId) {
      await sb.from("client_update_outbox").update({ status: "sent", message_id: messageId, sent_at: new Date().toISOString(), status_line: "Sent", claimed_at: null }).eq("id", o.id).eq("status", "sending");
      n++;
      continue;
    }
    const { data: open } = await sb.from("client_update_outbox").select("*").eq("client_id", o.client_id).in("status", ["pending", "held"]).maybeSingle();
    if (open) {
      // a newer update opened meanwhile: this one's changes join it
      let changes = (open.changes ?? []) as OutboxChange[];
      for (const c of (o.changes ?? []) as OutboxChange[]) if (!changes.some((x) => x.goalId === c.goalId)) changes = [...changes, c];
      const { data: client } = await sb.from("clients").select("first_name, preferred_name, full_name").eq("id", o.client_id).maybeSingle();
      const patch: Record<string, unknown> = { changes };
      if (!open.edited_at) patch.body = buildUpdateMessage({ firstName: client ? firstName(client) : null, changes });
      const { data: joined } = await sb.from("client_update_outbox").update(patch).eq("id", open.id).eq("updated_at", open.updated_at).select("id").maybeSingle();
      if (joined) await sb.from("client_update_outbox").update({ status: "cancelled", status_line: "Joined the newer update", claimed_at: null }).eq("id", o.id).eq("status", "sending");
    } else {
      await sb.from("client_update_outbox").update({ status: "pending", claimed_at: null, next_attempt_at: new Date().toISOString(), status_line: "Trying again" }).eq("id", o.id).eq("status", "sending");
    }
    n++;
  }
  return n;
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
    // the waiting update (a send in flight only when there's nothing waiting)
    sb
      .from("client_update_outbox")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["pending", "held", "sending"])
      .order("created_at", { ascending: false })
      .limit(3)
      .then((r: any) => {
        const rows = (r.data ?? []) as any[];
        return rows.find((o) => o.status !== "sending") ?? rows[0] ?? null;
      }),
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
