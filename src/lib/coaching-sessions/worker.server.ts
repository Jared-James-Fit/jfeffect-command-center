/**
 * Coaching sessions' background work (the `coaching-sessions-tick` hook, pg_cron
 * every minute while coaching_sessions_due()): Cleo's pre-call brief and the
 * reading of a meeting's notes or transcript. One job per row at a time,
 * claimed with the row's updated_at so two runs never take the same one;
 * a model still thinking parks the row (stagedCall keeps its answers), and a
 * provider that's down or out of credits waits without using an attempt.
 * OpenAI key only (openaiOnly): never Lovable credits.
 */
import type { CallState } from "@/lib/ai/staged-call.server";
import { checkBrief, prepLines } from "./brief";
import { checkAnalysis, transcriptForModel, type MeetingAnalysis } from "./analysis";

type Db = any;
type Job = "brief" | "analysis";
const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 4;

const isStale = (locked: string | null) => !locked || Date.now() - Date.parse(locked) > STALE_MS;

function jobFor(r: any): Job | null {
  const ready = (st: string) => st === "queued" || (st === "running" && isStale(r.locked_at));
  if (ready(r.analysis_status)) return "analysis";
  if (ready(r.write_up_status)) return "brief";
  return null;
}

export async function runSessionWork(sb: Db, opts: { limit?: number; deadlineMs?: number } = {}) {
  const started = Date.now();
  const deadline = opts.deadlineMs ?? 80_000;
  // every booked call has a plan the moment it's booked, and upcoming plans follow what's on file
  const plans = await keepMeetingsReady(sb).catch((e: any) => ({ error: String(e?.message ?? e) }));
  // a recording's parts become words (Phase 4: audio.server.ts)
  const audio = await import("./audio.server").then((m) => m.transcribeDueParts(sb, { limit: 2, deadlineMs: Math.max(20_000, deadline - 40_000) })).catch((e: any) => ({ error: String(e?.message ?? e) }));
  const { data: rows } = await sb
    .from("coaching_sessions")
    .select("id, write_up_status, analysis_status, locked_at, attempts, updated_at")
    .or("write_up_status.in.(queued,running),analysis_status.in.(queued,running)")
    .lt("attempts", MAX_ATTEMPTS)
    .order("updated_at")
    .limit(12);
  const done: Array<{ id: string; job: Job; status: string }> = [];
  for (const r of (rows ?? []) as any[]) {
    if (done.length >= (opts.limit ?? 3) || Date.now() - started > deadline) break;
    const job = jobFor(r);
    if (!job) continue;
    const col = job === "analysis" ? "analysis_status" : "write_up_status";
    const { data: claimed } = await sb
      .from("coaching_sessions")
      .update({ [col]: "running", locked_at: new Date().toISOString(), attempts: (r.attempts ?? 0) + 1 })
      .eq("id", r.id)
      .eq("updated_at", r.updated_at)
      .select("*");
    const s = claimed?.[0];
    if (!s) continue;
    const status = await runJob(sb, s, job);
    done.push({ id: s.id, job, status });
  }
  return { jobs: done, plans, audio };
}

/**
 * Booked calls with no plan get one (three a run), and upcoming plans due a
 * refresh are refreshed (three a run): read with the service role, after which
 * every coach screen reads them through RLS as usual.
 */
export async function keepMeetingsReady(sb: Db) {
  const { autoPrepare, refreshMeeting } = await import("./meetings.server");
  const { isTrainingSessionType } = await import("@/lib/booking-types");
  const now = new Date();
  const to = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const { data: calls } = await sb
    .from("pt_sessions")
    .select("id, client_id, title, session_type, starts_at, ends_at, start_time, end_time, status, clients!inner(archived, service_tier)")
    .eq("status", "Scheduled")
    .gt("starts_at", now.toISOString())
    .lt("starts_at", to)
    .order("starts_at")
    .limit(60);
  const wanted = ((calls ?? []) as any[]).filter((p) => !isTrainingSessionType(p.session_type) && !p.clients?.archived && p.clients?.service_tier === "coaching");
  const { data: has } = wanted.length ? await sb.from("coaching_sessions").select("pt_session_id").in("pt_session_id", wanted.map((p) => p.id)) : { data: [] as any[] };
  const covered = new Set(((has ?? []) as any[]).map((r) => r.pt_session_id));
  const prepared: string[] = [];
  for (const p of wanted.filter((x) => !covered.has(x.id)).slice(0, 3)) {
    try {
      const id = await autoPrepare(sb, sb, p);
      if (id) prepared.push(id);
    } catch (e) {
      console.warn("[meetings] auto-prepare", p.id, e);
    }
  }
  const stale = new Date(now.getTime() - 3 * 3_600_000).toISOString();
  const { data: due } = await sb
    .from("coaching_sessions")
    .select("*")
    .in("status", ["preparing", "ready"])
    .neq("format", "retrospective")
    .or(`prep_refreshed_at.is.null,prep_refreshed_at.lt.${stale}`)
    // only plans still ahead (the same window coaching_sessions_due() wakes the tick for)
    .or(`scheduled_at.is.null,and(scheduled_at.gt.${now.toISOString()},scheduled_at.lt.${new Date(now.getTime() + 8 * 86_400_000).toISOString()})`)
    .gt("created_at", new Date(now.getTime() - 60 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(6);
  const refreshed: Array<{ id: string; changes: number }> = [];
  for (const s of ((due ?? []) as any[]).filter((x) => !x.scheduled_at || (Date.parse(x.scheduled_at) > now.getTime() && Date.parse(x.scheduled_at) < now.getTime() + 8 * 86_400_000)).slice(0, 3)) {
    try {
      const r = await refreshMeeting(sb, sb, s);
      refreshed.push({ id: s.id, changes: r.changed.length });
    } catch (e) {
      // a plan that can't be refreshed keeps the one it has; try again later
      await sb.from("coaching_sessions").update({ prep_refreshed_at: now.toISOString() }).eq("id", s.id);
      console.warn("[meetings] refresh", s.id, e);
    }
  }
  return { prepared, refreshed };
}

async function runJob(sb: Db, s: any, job: Job): Promise<string> {
  const col = job === "analysis" ? "analysis_status" : "write_up_status";
  const progress = (s.progress ?? {}) as Record<string, CallState>;
  const state: CallState = progress[job] ?? {};
  const save = async () => {
    await sb.from("coaching_sessions").update({ progress: { ...progress, [job]: state } }).eq("id", s.id);
  };
  try {
    // the call's transcript goes to OpenAI only with the client's permission (5.1.2(i), src/lib/ai-consent):
    // refused (or unreadable: fails closed), the job stops here, says why for the coach and asks no model
    const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
    const consent = await clientAllowsAi(s.client_id);
    if (!consent.ok) {
      const { coachConsentMessage } = await import("@/lib/ai-consent/consent");
      const words = coachConsentMessage(consent.name);
      // the coach reads why (the brief keeps it on write_up, which is only read as a brief once it's ready)
      await sb
        .from("coaching_sessions")
        .update({ [col]: "failed", locked_at: null, ...(job === "analysis" ? { analysis_error: words } : { write_up: { ...(s.write_up ?? {}), error: words } }) })
        .eq("id", s.id);
      await log(sb, s, job === "analysis" ? "analysis_failed" : "brief_failed", { error: words, reason: "no_ai_consent" });
      return "no_consent";
    }
    const { resolveRoute } = await import("@/lib/ai/routing");
    const { readRouteOverride } = await import("@/lib/ai/route-call.server");
    const route = resolveRoute(job === "analysis" ? "session_analysis" : "session_brief", await readRouteOverride(sb), { openaiOnly: true });
    if (job === "brief") {
      const brief = await writeBrief(sb, s, route, state, save);
      // Cleo's phrasing goes onto the points it refines (never one the coach wrote or edited)
      const { normalizeAgenda } = await import("./prepare");
      const { data: fresh } = await sb.from("coaching_sessions").select("agenda").eq("id", s.id).maybeSingle();
      const agenda = normalizeAgenda((fresh as any)?.agenda ?? s.agenda);
      const say = new Map((brief.brief.phrasing ?? []).map((p) => [p.pointId, p.say]));
      const withSay = agenda
        ? { ...agenda, sections: agenda.sections.map((sec) => ({ ...sec, items: sec.items.map((i) => (say.has(i.id) && !i.edited && !i.custom ? { ...i, cleoSay: say.get(i.id) } : i)) })) }
        : null;
      await sb
        .from("coaching_sessions")
        .update({ write_up: { ...brief.brief, model: brief.model, at: new Date().toISOString() }, write_up_status: "ready", progress: dropKey(progress, job), locked_at: null, ...(withSay ? { agenda: withSay } : {}) })
        .eq("id", s.id);
      await log(sb, s, "brief_ready", { model: brief.model, dropped: brief.brief.dropped.length });
      return "ready";
    }
    const a = await analyse(sb, s, route, state, save);
    await saveAnalysis(sb, s, a.analysis, a.model, a.source);
    await sb
      .from("coaching_sessions")
      .update({ analysis: { ...a.analysis, model: a.model, at: new Date().toISOString(), source: a.source, clipped: a.clipped }, analysis_status: "ready", analysis_error: null, progress: dropKey(progress, job), locked_at: null })
      .eq("id", s.id);
    await log(sb, s, "analysis_ready", { model: a.model, items: a.analysis.items.length, recommendations: a.analysis.recommendations.length, dropped: a.analysis.dropped.length });
    // the goals it names go to the goal ledger as proposed (goal-intel; the 5-minute tick catches any this misses)
    try {
      const { extractFromMeeting, assessClient } = await import("@/lib/goal-intel/goals.server");
      const g = await extractFromMeeting(sb, s.id);
      if (g.created || g.updated) await assessClient(sb, s.client_id);
    } catch (e: any) {
      console.warn("[coaching-sessions] goals not read yet", e?.message);
    }
    return "ready";
  } catch (e: any) {
    const { WaitingForModel } = await import("@/lib/ai/staged-call.server");
    if (e instanceof WaitingForModel) {
      await sb.from("coaching_sessions").update({ progress: { ...progress, [job]: state }, locked_at: null, attempts: Math.max(0, (s.attempts ?? 1) - 1) }).eq("id", s.id);
      return "waiting_ai";
    }
    const { classifyAiError, isProviderFailure, errorText } = await import("@/lib/ai/ai-errors");
    const kind = classifyAiError(e);
    const msg = String(e?.message ?? e).slice(0, 500);
    if (isProviderFailure(kind)) {
      // AI is down or out of credits: the job waits for it, using no attempt
      await sb
        .from("coaching_sessions")
        .update({ locked_at: new Date().toISOString(), attempts: Math.max(0, (s.attempts ?? 1) - 1), ...(job === "analysis" ? { analysis_error: `Waiting for AI: ${errorText(e)}` } : {}) })
        .eq("id", s.id);
      return "waiting_ai";
    }
    const last = (s.attempts ?? 1) >= MAX_ATTEMPTS - 1;
    await sb
      .from("coaching_sessions")
      .update({
        [col]: last ? "failed" : "queued",
        locked_at: null,
        ...(job === "analysis" ? { analysis_error: msg } : {}),
        ...(e?.restart ? { progress: dropKey(progress, job) } : {}),
      })
      .eq("id", s.id);
    if (last) await log(sb, s, job === "analysis" ? "analysis_failed" : "brief_failed", { error: msg });
    return last ? "failed" : "retry";
  }
}

const dropKey = (p: Record<string, unknown>, k: string) => {
  const { [k]: _gone, ...rest } = p;
  return Object.keys(rest).length ? rest : null;
};

async function log(sb: Db, s: any, action: string, detail: Record<string, unknown>) {
  await sb.from("coaching_session_events").insert({ session_id: s.id, client_id: s.client_id, actor: "cleo", action, detail });
}

class Unreadable extends Error {
  restart = true;
}

async function call(route: any, state: CallState, save: () => Promise<void>, key: string, system: string, prompt: string, tag: string) {
  const { stagedCall, ModelsExhausted, OPENAI_CREDITS_HINT } = await import("@/lib/ai/staged-call.server");
  try {
    return await stagedCall({
      state,
      key,
      route,
      req: { system, prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens },
      save,
      tag,
      poll: { ms: 35_000, every: 2500 },
      backgroundLimitMs: 12 * 60_000,
      hedgeAfterMs: 6 * 60_000,
      finalLimitMs: 20 * 60_000,
      syncTimeoutMs: 120_000,
    });
  } catch (e) {
    if (e instanceof ModelsExhausted)
      throw new Error(`Cleo couldn't answer (tried ${e.tried.join(", ")}).${e.noOpenAiCredits ? OPENAI_CREDITS_HINT : ""}`);
    throw e;
  }
}

/* ------------------------------------------------------------------ */

async function writeBrief(sb: Db, s: any, route: any, state: CallState, save: () => Promise<void>) {
  const { BRIEF_SYSTEM } = await import("./prompts.server");
  const lines = prepLines(s.agenda, s.prep);
  const e = s.event ?? {};
  const header = [
    `SESSION: ${e.title ? `${e.title}${e.kind ? ` (${e.kind})` : ""}` : "General check-in"}${e.date ? ` on ${e.date}` : ""}${e.daysOut != null ? `, ${e.daysOut} days out` : ""}${e.phase ? `, ${e.phase}` : ""}`,
    `FORMAT: ${s.format === "touch_base" ? "a 5–10 minute touch-base" : `a ${s.minutes ?? 20} minute call`}`,
  ].join("\n");
  const prompt = `${header}\n\nPREP LINES (id [section] (source) text):\n${lines.map((l) => `${l.id} [${l.section}] (${l.source}) ${l.text}`).join("\n") || "(nothing on file)"}`;
  let r = await call(route, state, save, "brief", BRIEF_SYSTEM, prompt, "session_brief");
  let brief = checkBrief(r.text, lines, s.event);
  if (!brief) {
    r = await call(route, state, save, "brief2", BRIEF_SYSTEM, `${prompt}\n\nYour last answer wasn't the JSON asked for. Answer with that JSON only.`, "session_brief");
    brief = checkBrief(r.text, lines, s.event);
  }
  if (!brief) throw new Unreadable("Cleo's brief couldn't be read");
  return { brief, model: r.model };
}

async function analyse(sb: Db, s: any, route: any, state: CallState, save: () => Promise<void>) {
  const { ANALYSIS_SYSTEM } = await import("./prompts.server");
  let text = "";
  let source: "transcript" | "notes" = "notes";
  if (s.recording?.transcript_ready && s.transcript_path && !s.transcript_deleted_at) {
    const { data, error } = await sb.storage.from("coaching-transcripts").download(s.transcript_path);
    if (error) throw new Error(`The transcript couldn't be read: ${error.message}`);
    text = await data.text();
    source = "transcript";
  } else if (s.transcript_path && !s.transcript_deleted_at) {
    const { data, error } = await sb.storage.from("coaching-transcripts").download(s.transcript_path);
    if (error) throw new Error(`The transcript couldn't be read: ${error.message}`);
    text = await data.text();
    source = "transcript";
  } else {
    text = [s.live?.notes ?? "", ...((s.live?.decisions ?? []) as string[]).map((d) => `Agreed: ${d}`)].join("\n").trim();
  }
  if (text.trim().length < 40) throw new Unreadable("There's too little in the notes to read");
  const t = transcriptForModel(text);
  const today = new Date().toISOString().slice(0, 10);
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [{ data: intel }, { data: client }, { data: recent }] = await Promise.all([
    sb.from("client_intelligence").select("kind, text, expires_on").eq("client_id", s.client_id).eq("status", "confirmed").limit(60),
    sb.from("clients").select("first_name, preferred_name, preferred_weight_unit").eq("id", s.client_id).maybeSingle(),
    sb.from("coaching_session_recommendations").select("title, status, session_id").eq("client_id", s.client_id).neq("session_id", s.id).neq("status", "proposed").gte("created_at", since60).limit(40),
  ]);
  const known = ((intel ?? []) as any[]).filter((i) => !i.expires_on || i.expires_on >= today);
  const lines = prepLines(s.agenda, s.prep).filter((l) => l.source === "record");
  const e = s.event ?? {};
  const prompt = [
    `TODAY: ${today}`,
    `CLIENT: ${(client as any)?.preferred_name || (client as any)?.first_name || "the client"}`,
    `MEETING: ${e.title ?? "General meeting"}${e.date ? `, event on ${e.date}` : ""}${e.phase ? ` (${e.phase})` : ""}`,
    `CONFIRMED INTELLIGENCE:\n${known.map((i) => `- [${i.kind}] ${i.text}`).join("\n") || "- none yet"}`,
    `RECORDS (from the app):\n${lines.map((l) => `- ${l.text}`).join("\n") || "- none"}`,
    s.coach_notes ? `COACH'S PRIVATE NOTES BEFORE THE CALL:\n${s.coach_notes}` : null,
    source === "transcript" && (s.live?.notes || (s.live?.decisions ?? []).length)
      ? `COACH'S NOTES DURING THE CALL:\n${[s.live?.notes ?? "", ...((s.live?.decisions ?? []) as string[]).map((d) => `Agreed: ${d}`)].join("\n").trim()}`
      : null,
    `<transcript source="${source === "transcript" ? s.transcript_source ?? "other" : "coach notes"}">\n${t.text}\n</transcript>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const ctx = {
    today,
    recordNumbers: [lines.map((l) => l.text), s.event],
    knownIntelligence: known.map((i) => i.text),
    clientUnit: ((client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb") as "kg" | "lb",
    recentRecommendations: ((recent ?? []) as any[]).map((r) => String(r.title)),
  };
  // the coach's own notes are part of what may be quoted
  const quotable = source === "transcript" ? `${t.text}\n${s.live?.notes ?? ""}\n${((s.live?.decisions ?? []) as string[]).join("\n")}` : t.text;
  let r = await call(route, state, save, "analysis", ANALYSIS_SYSTEM, prompt, "session_analysis");
  let analysis: MeetingAnalysis | null = checkAnalysis(r.text, quotable, ctx);
  if (!analysis) {
    r = await call(route, state, save, "analysis2", ANALYSIS_SYSTEM, `${prompt}\n\nYour last answer wasn't the JSON asked for. Answer with that JSON only.`, "session_analysis");
    analysis = checkAnalysis(r.text, quotable, ctx);
  }
  if (!analysis) throw new Unreadable("Cleo's read of the meeting couldn't be read");
  return { analysis, model: r.model, source, clipped: t.clipped };
}

/** What the read proposes, as rows the coach decides on: replaces this meeting's earlier undecided proposals only. */
async function saveAnalysis(sb: Db, s: any, a: MeetingAnalysis, model: string, source: string) {
  await Promise.all([
    sb.from("coaching_session_recommendations").delete().eq("session_id", s.id).eq("status", "proposed"),
    sb.from("client_intelligence").delete().eq("source_session_id", s.id).eq("status", "proposed"),
    sb.from("coaching_session_commitments").delete().eq("session_id", s.id).eq("confirmed", false),
  ]);
  if (a.recommendations.length)
    await sb.from("coaching_session_recommendations").insert(
      a.recommendations.map((r) => ({
        session_id: s.id,
        client_id: s.client_id,
        area: r.area,
        kind: r.kind,
        title: r.title,
        current_text: r.current || null,
        proposed_text: r.proposed || null,
        reason: r.reason || null,
        evidence: r.quotes.map((q) => ({ quote: q })),
        benefit: r.benefit || null,
        tradeoffs: r.tradeoffs || null,
        affects: r.affects || null,
        flags: r.flags ?? [],
      })),
    );
  if (a.intelligence.length) {
    // each line reviewed before the coach sees it: a duplicate is merged, a conflict flagged, a plain low-risk one kept
    const { reviewCandidate } = await import("./memory");
    const { data: existing } = await sb.from("client_intelligence").select("id, text, kind, status, merged_count").eq("client_id", s.client_id).eq("status", "confirmed").limit(200);
    const kept = (existing ?? []) as any[];
    const speakerConfirmed = s.transcript_source === "otter" || (s.recording?.speakers_confirmed === true && s.recording?.transcript_ready === true);
    const e = s.event ?? {};
    const rows: any[] = [];
    for (const i of a.intelligence) {
      const verdict = reviewCandidate({ kind: i.kind, text: i.text, quote: i.quote, speaker: i.speaker ?? "unclear" }, kept, { allowAutoKeep: true, speakerConfirmed });
      if (verdict.action === "duplicate") {
        const k = kept.find((x) => x.id === verdict.of);
        if (k) await sb.from("client_intelligence").update({ merged_count: (k.merged_count ?? 1) + 1 }).eq("id", k.id);
        continue;
      }
      const event = i.event && e.key && e.date ? { event_key: e.key, event_title: e.title ?? null, event_date: String(e.date).slice(0, 10) } : {};
      rows.push({
        client_id: s.client_id,
        kind: i.kind,
        text: i.text,
        permanence: i.permanence,
        expires_on: i.expiresOn,
        status: verdict.action === "auto_keep" ? "confirmed" : "proposed",
        auto_kept: verdict.action === "auto_keep",
        confirmed_at: verdict.action === "auto_keep" ? new Date().toISOString() : null,
        conflicts_with: verdict.action === "conflict" ? verdict.with : null,
        review_reason: verdict.reason,
        source_session_id: s.id,
        source_quote: i.quote,
        ...event,
      });
    }
    if (rows.length) await sb.from("client_intelligence").insert(rows);
  }
  const commitments = a.items.filter((i) => i.kind === "athlete_commitment" || i.kind === "coach_commitment");
  if (commitments.length)
    await sb.from("coaching_session_commitments").insert(
      commitments.map((c) => ({
        client_id: s.client_id,
        session_id: s.id,
        owner: c.kind === "athlete_commitment" ? "athlete" : "coach",
        text: c.text.slice(0, 400),
        due_on: c.due,
        confirmed: false,
        source_quote: c.quote.slice(0, 600),
      })),
    );
  void model;
  void source;
}
