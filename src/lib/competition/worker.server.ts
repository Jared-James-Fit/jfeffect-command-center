/**
 * The competition worker (server only; the competition-intel-tick hook, run
 * by pg_cron every minute while something's due and once a day at 7:41
 * Winnipeg):
 *
 *  1. Schedules: every competition whose date, end date, status or results
 *     changed has its milestones worked out again (milestones.ts) and written.
 *  2. Milestones due today are claimed one at a time (competition_milestone_claim:
 *     never two workers on one, three tries at most) and written: the brief
 *     from the records, Cleo's write-up checked against it, a new version of
 *     the assessment (the previous unreleased one superseded, never deleted),
 *     the coach pushed, and a routine update released by itself only when the
 *     coach turned that on. A model still thinking hands the request back
 *     (waiting_ai) and the next minute polls it; OpenAI being down never uses
 *     an attempt and never gets a templated stand-in.
 *  3. Daily: each upcoming competition's live read (the overview's numbers and
 *     concerns, no AI), competitors' records refreshed (weekly, daily in the
 *     last three weeks), finished meets' results picked up, and an interim
 *     update queued when the expected total moved 3%+ or a new serious concern
 *     appeared (at most one every 10 days, never right before a milestone).
 */
import { buildBrief, headline, urgency, type Brief } from "./brief";
import { loadCompetitionContext, todayWinnipeg } from "./load.server";
import {
  MILESTONE_BY_KIND,
  planMilestones,
  daysBetween,
  addDays,
  type ExistingMilestone,
} from "./milestones";
import { autoReleases } from "./lifecycle";
import { logEvent, release } from "./release.server";
import type { MilestoneKind } from "./types";
import { readDebrief, resultsFromLog, type MeetResults } from "./debrief";

type Db = any;

/** Writes a competition's schedule. */
export async function applySchedule(
  sb: Db,
  competitionId: string,
  today = todayWinnipeg(),
): Promise<number> {
  const { data: comp } = await sb
    .from("competitions")
    .select("id, client_id, meet_date, meet_end_date, status, results")
    .eq("id", competitionId)
    .maybeSingle();
  if (!comp) return 0;
  const { data: ms } = await sb
    .from("competition_milestones")
    .select("id, kind, seq, status, due_on, done_at")
    .eq("competition_id", competitionId)
    .neq("kind", "update");
  const existing: ExistingMilestone[] = (ms ?? []).map((m: any) => ({
    kind: m.kind,
    status: m.status,
    due_on: String(m.due_on),
    done_at: m.done_at,
  }));
  const changes = planMilestones({
    meetDate: String(comp.meet_date),
    meetEndDate: comp.meet_end_date ? String(comp.meet_end_date) : null,
    today,
    status: comp.status,
    existing,
    hasResults: !!comp.results,
  });
  for (const ch of changes) {
    const had = (ms ?? []).find((m: any) => m.kind === ch.kind);
    if (had) {
      await sb
        .from("competition_milestones")
        .update({
          due_on: ch.due_on,
          status: ch.status,
          why: ch.why,
          ...(ch.status === "scheduled" ? { attempts: 0, last_error: null, progress: null } : {}),
        })
        .eq("id", had.id);
    } else {
      await sb
        .from("competition_milestones")
        .insert({
          competition_id: competitionId,
          client_id: comp.client_id,
          kind: ch.kind,
          seq: 0,
          due_on: ch.due_on,
          status: ch.status,
          why: ch.why,
        });
    }
  }
  await sb.from("competitions").update({ schedule_dirty: false }).eq("id", competitionId);
  if (changes.length)
    await logEvent(sb, {
      competitionId,
      clientId: comp.client_id,
      actor: "system",
      action: "scheduled",
      detail: { changes },
    });
  return changes.length;
}

/** The overview's numbers, kept on the competition so lists never compute a brief. */
export function liveSummary(b: Brief) {
  return {
    phase: b.phase,
    days_out: b.daysOut,
    total: b.forecast.total,
    confidence: b.forecast.confidence,
    threat: b.landscape.biggest
      ? {
          name: b.landscape.biggest.name,
          expected: b.landscape.biggest.expected,
          overlaps: b.landscape.biggest.overlaps,
        }
      : null,
    place: b.landscape.place,
    headline: headline(b),
    urgency: urgency(b),
    call: b.call.recommend
      ? { minutes: b.call.minutes, reasons: b.call.reasons.slice(0, 3) }
      : null,
    missing: b.missing.essential.length,
  };
}

async function debriefInput(sb: Db, competitionId: string, comp: any) {
  // the forecast and attempts the coach last confirmed (never rewritten after the fact)
  const { data: last } = await sb
    .from("competition_assessments")
    .select("internal, kind")
    .eq("competition_id", competitionId)
    .in("kind", ["confirm", "game_plan"])
    .in("status", ["approved", "released"])
    .order("created_at", { ascending: false })
    .limit(1);
  const { confirmedPlan } = await import("./proposals");
  const plan = confirmedPlan(last?.[0]?.internal);
  let results: MeetResults | null = comp.results ?? null;
  if (!results) {
    const { data: log } = await sb
      .from("competition_meet_log")
      .select("entrant, lift, attempt, kg, result")
      .eq("competition_id", competitionId);
    results = resultsFromLog((log ?? []) as any, comp.weigh_in_kg ?? null);
  }
  return results ? { results, read: readDebrief(plan, results) } : null;
}

export async function processMilestone(
  sb: Db,
  m: any,
): Promise<{ status: string; assessmentId?: string }> {
  const save = async () => {
    await sb.from("competition_milestones").update({ progress: state }).eq("id", m.id);
  };
  const state: any = m.progress ?? {};
  try {
    const { assertProviderUp } = await import("@/lib/ai/ai-health.server");
    await assertProviderUp("openai");
    const kind = m.kind as MilestoneKind;
    const { ctx, competition } = await loadCompetitionContext(sb, m.competition_id, {
      milestone: kind,
    });
    const brief = buildBrief(ctx);
    // the class question, read once a week from the rankings (before the first call only)
    const checked = competition.research?.alternatives_checked_at;
    if (
      !state.calls &&
      kind !== "debrief" &&
      (!checked || Date.now() - Date.parse(checked) > 7 * 86_400_000)
    ) {
      try {
        const { classOptions } = await import("./research.server");
        const alt = await classOptions(sb, m.competition_id, {
          bodyweightAvg: ctx.athlete.bodyweightAvg,
          classLimit: ctx.athlete.classLimit,
          expectedTotal: brief.forecast.total?.expected ?? null,
        });
        brief.classOptions = alt ? [alt] : [];
      } catch (e) {
        console.warn("[competition] class options failed", (e as Error)?.message);
      }
    }
    const debrief =
      kind === "debrief" ? await debriefInput(sb, m.competition_id, competition) : null;
    if (kind === "debrief" && !debrief) {
      // nothing lifted on record yet: wait two more days for results
      await sb
        .from("competition_milestones")
        .update({
          status: "scheduled",
          due_on: addDays(ctx.today, 2),
          attempts: Math.max(0, m.attempts - 1),
          why: "Waiting for results",
          locked_at: null,
        })
        .eq("id", m.id);
      return { status: "waiting_results" };
    }
    const { data: prev } = await sb
      .from("competition_assessments")
      .select("headline")
      .eq("competition_id", m.competition_id)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1);
    const { writeNarrative, athleteVersion } = await import("./write.server");
    const { narrative, model, strategy } = await writeNarrative(
      sb,
      brief,
      {
        athleteName: ctx.athlete.name,
        instructions: m.instructions ?? null,
        previousHeadline: prev?.[0]?.headline ?? null,
        debrief: debrief?.read,
      },
      state,
      save,
    );

    const def = MILESTONE_BY_KIND[kind];
    const { data: versions } = await sb
      .from("competition_assessments")
      .select("version")
      .eq("competition_id", m.competition_id)
      .eq("kind", kind)
      .order("version", { ascending: false })
      .limit(1);
    const version = (versions?.[0]?.version ?? 0) + 1;
    const level = urgency(brief);
    // the game plan and its confirmation always need the coach; an interim update does when it isn't routine
    const needsApproval = def.approval || (kind === "update" && level !== "routine");
    const now = new Date().toISOString();
    const { data: row, error } = await sb
      .from("competition_assessments")
      .insert({
        competition_id: m.competition_id,
        client_id: m.client_id,
        milestone_id: m.id,
        kind,
        version,
        status: "ready",
        urgency: level,
        needs_approval: needsApproval,
        headline: (narrative.key_finding || headline(brief)).slice(0, 300),
        internal: {
          engine: brief,
          narrative,
          strategy: {
            checks: strategy.checks,
            adjusted: strategy.adjusted,
            evidence: strategy.evidence,
            declined: [],
          },
          debrief: debrief ?? null,
          instructions: m.instructions ?? null,
        },
        athlete: athleteVersion(brief, narrative, kind, strategy.adjusted),
        coach_message: narrative.coach_notification,
        call: brief.call,
        model,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);
    // the version before it, never released, is replaced (kept as history)
    await sb
      .from("competition_assessments")
      .update({ status: "superseded", superseded_at: now, superseded_by: row.id })
      .eq("competition_id", m.competition_id)
      .eq("kind", kind)
      .in("status", ["ready", "reviewed", "changes_requested", "approved"])
      .neq("id", row.id);
    await sb
      .from("competition_milestones")
      .update({
        status: "ready",
        done_at: now,
        assessment_id: row.id,
        progress: null,
        locked_at: null,
        last_error: null,
      })
      .eq("id", m.id);
    await sb
      .from("competitions")
      .update({ live: liveSummary(brief), live_at: now, watch: brief.watch })
      .eq("id", m.competition_id);
    await logEvent(sb, {
      competitionId: m.competition_id,
      clientId: m.client_id,
      assessmentId: row.id,
      actor: "cleo",
      action: "assessment_ready",
      detail: { kind, version, urgency: level, model },
    });

    if (autoReleases({ kind, urgency: level, needsApproval, policy: competition.release_policy })) {
      await release(sb, row.id, { userId: null, kind: "automated" });
    }
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(
      sb,
      level === "urgent" ? "competition_assessment_urgent" : "competition_assessment_ready",
      { clientId: m.client_id, sourceId: row.id },
    );
    return { status: "ready", assessmentId: row.id };
  } catch (e: any) {
    const { WaitingForModel } = await import("@/lib/ai/staged-call.server");
    if (e instanceof WaitingForModel) {
      await sb
        .from("competition_milestones")
        .update({ status: "waiting_ai", progress: state, locked_at: null })
        .eq("id", m.id);
      return { status: "waiting_ai" };
    }
    const { classifyAiError, isProviderFailure, errorText } = await import("@/lib/ai/ai-errors");
    const kindOf = classifyAiError(e);
    if (isProviderFailure(kindOf)) {
      // AI is down or out of credits: wait for it, using no attempt
      await sb
        .from("competition_milestones")
        .update({
          status: "waiting_ai",
          attempts: Math.max(0, m.attempts - 1),
          last_error: `Waiting for AI: ${errorText(e)}`,
          locked_at: null,
        })
        .eq("id", m.id);
      return { status: "waiting_ai" };
    }
    const { NarrativeRejected } = await import("./write.server");
    const msg = String(e?.message ?? e).slice(0, 500);
    // a rejected write-up starts fresh next time (its answers aren't reused)
    await sb
      .from("competition_milestones")
      .update({
        status: "failed",
        last_error: msg,
        locked_at: null,
        ...(e instanceof NarrativeRejected ? { progress: null } : {}),
      })
      .eq("id", m.id);
    if (m.attempts >= 3) {
      await logEvent(sb, {
        competitionId: m.competition_id,
        clientId: m.client_id,
        actor: "system",
        action: "assessment_failed",
        detail: { kind: m.kind, error: msg },
      });
    }
    return { status: "failed" };
  }
}

/** The daily read of one competition: live numbers, concerns, competitors, results, interim updates. */
export async function dailyRead(
  sb: Db,
  competitionId: string,
  budget: { left: number },
  today = todayWinnipeg(),
) {
  const { data: comp } = await sb
    .from("competitions")
    .select("*")
    .eq("id", competitionId)
    .maybeSingle();
  if (!comp || comp.status !== "upcoming") return;
  const daysOut = daysBetween(today, String(comp.meet_date));
  // competitors' records: weekly, daily in the last three weeks
  const { data: field } = await sb
    .from("competition_competitors")
    .select("id, meets_fetched_at, identity, opl_slug")
    .eq("competition_id", competitionId)
    .eq("archived", false);
  const { syncCompetitor } = await import("./opl.server");
  for (const c of field ?? []) {
    if (budget.left <= 0) break;
    if (c.identity === "not_found" || c.identity === "ambiguous") continue;
    const age = c.meets_fetched_at
      ? (Date.now() - Date.parse(c.meets_fetched_at)) / 86_400_000
      : 99;
    if (age < (daysOut <= 21 ? 1 : 7)) continue;
    await syncCompetitor(sb, c.id, { today, budget });
  }
  // results in after the meet: from their synced meets on the day, the meet's end date
  const end = String(comp.meet_end_date ?? comp.meet_date);
  if (daysOut < 0 && !comp.results) {
    const { data: rows } = await sb
      .from("athlete_powerlifting_results")
      .select(
        "meet_date, squat_kg, bench_kg, deadlift_kg, total_kg, place, bodyweight_kg, attempts",
      )
      .eq("client_id", comp.client_id)
      .gte("meet_date", String(comp.meet_date))
      .lte("meet_date", end)
      .limit(1);
    const r = rows?.[0];
    if (r) {
      const results: MeetResults = {
        squat: Number(r.squat_kg) || null,
        bench: Number(r.bench_kg) || null,
        deadlift: Number(r.deadlift_kg) || null,
        total: Number(r.total_kg) || null,
        place: r.place ?? null,
        bodyweight: Number(r.bodyweight_kg) || null,
        attempts: r.attempts ?? null,
        source: "opl",
      };
      await sb
        .from("competitions")
        .update({ results, results_at: new Date().toISOString(), status: "completed" })
        .eq("id", competitionId);
      await logEvent(sb, {
        competitionId,
        clientId: comp.client_id,
        actor: "system",
        action: "results_in",
        detail: { source: "opl" },
      });
    } else if (daysBetween(end, today) >= 14) {
      // two weeks on and no results on record: the meet is done either way
      await sb.from("competitions").update({ status: "completed" }).eq("id", competitionId);
    }
    return;
  }
  if (daysOut < 0) return;

  // the field and the class question, refreshed weekly (two weeks out and closer, every few days)
  const researched = comp.research?.field;
  const fieldAge = researched?.fetched_at
    ? (Date.now() - Date.parse(researched.fetched_at)) / 86_400_000
    : 99;
  if (fieldAge >= (daysOut <= 21 ? 3 : 7)) {
    try {
      const { discoverField } = await import("./research.server");
      await discoverField(sb, competitionId, { budget });
    } catch (e) {
      console.warn("[competition] research failed", competitionId, (e as Error)?.message);
    }
  }
  const { ctx } = await loadCompetitionContext(sb, competitionId, { today });
  const brief = buildBrief(ctx);
  const live = liveSummary(brief);
  try {
    const { classOptions } = await import("./research.server");
    await classOptions(sb, competitionId, {
      bodyweightAvg: ctx.athlete.bodyweightAvg,
      classLimit: ctx.athlete.classLimit,
      expectedTotal: brief.forecast.total?.expected ?? null,
    });
  } catch (e) {
    console.warn("[competition] class options failed", competitionId, (e as Error)?.message);
  }
  const prevSerious = new Set(
    ((comp.watch ?? []) as any[]).filter((w) => w.severity === "serious").map((w) => w.key),
  );
  const newSerious = brief.watch.filter((w) => w.severity === "serious" && !prevSerious.has(w.key));
  await sb
    .from("competitions")
    .update({ live, live_at: new Date().toISOString(), watch: brief.watch })
    .eq("id", competitionId);

  // an interim update only when something meaningful moved
  const shift = brief.projectionShift ?? 0;
  if (Math.abs(shift) < 0.03 && !newSerious.length) return;
  const { data: recent } = await sb
    .from("competition_milestones")
    .select("kind, due_on, status, seq")
    .eq("competition_id", competitionId);
  const near = (recent ?? []).some(
    (m: any) =>
      m.status !== "skipped" &&
      Math.abs(daysBetween(today, String(m.due_on))) <= (m.kind === "update" ? 10 : 5) &&
      (m.kind === "update" || String(m.due_on) >= today),
  );
  if (near || daysOut <= 1) return;
  const seq =
    Math.max(0, ...(recent ?? []).filter((m: any) => m.kind === "update").map((m: any) => m.seq)) +
    1;
  const why = newSerious.length
    ? `New concern: ${newSerious[0].text}`
    : `Projected total moved ${Math.round(shift * 1000) / 10}%`;
  await sb
    .from("competition_milestones")
    .insert({
      competition_id: competitionId,
      client_id: comp.client_id,
      kind: "update",
      seq,
      due_on: today,
      status: "scheduled",
      why,
    });
  await logEvent(sb, {
    competitionId,
    clientId: comp.client_id,
    actor: "system",
    action: "update_queued",
    detail: { why },
  });
}

export type TickReport = {
  scheduled: number;
  processed: Array<{ id: string; kind: string; status: string }>;
  daily?: number;
};

export async function runCompetitionTick(
  sb: Db,
  opts: { scan?: "daily" | null; milestoneId?: string | null; budgetMs?: number } = {},
): Promise<TickReport> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 90_000;
  const report: TickReport = { scheduled: 0, processed: [] };
  const { data: dirty } = await sb
    .from("competitions")
    .select("id")
    .eq("schedule_dirty", true)
    .neq("status", "archived")
    .limit(50);
  for (const c of dirty ?? []) report.scheduled += await applySchedule(sb, c.id);
  // a new competition's field is researched right away (best effort, a few at a time)
  if (Date.now() - t0 < budget * 0.4) {
    const { data: fresh } = await sb
      .from("competitions")
      .select("id, research, status")
      .eq("status", "upcoming")
      .order("created_at", { ascending: false })
      .limit(20);
    const { discoverField } = await import("./research.server");
    for (const c of (fresh ?? []).filter((x: any) => !x.research?.field).slice(0, 2)) {
      if (Date.now() - t0 > budget * 0.4) break;
      try {
        const r = await discoverField(sb, c.id, { budget: { left: 10 } });
        if (r.status === "unsupported" || r.status === "error") {
          await sb
            .from("competitions")
            .update({
              research: { ...(c.research ?? {}), field: { fetched_at: new Date().toISOString(), error: r.error ?? r.status } },
            })
            .eq("id", c.id);
        }
      } catch (e) {
        console.warn("[competition] research failed", c.id, (e as Error)?.message);
      }
    }
  }

  if (opts.scan === "daily") {
    const { data: comps } = await sb
      .from("competitions")
      .select("id")
      .in("status", ["upcoming"])
      .order("meet_date")
      .limit(200);
    const oplBudget = { left: 40 };
    let n = 0;
    for (const c of comps ?? []) {
      if (Date.now() - t0 > budget * 0.6) break;
      try {
        await dailyRead(sb, c.id, oplBudget);
        n++;
      } catch (e) {
        console.warn("[competition] daily read failed", c.id, (e as Error)?.message);
      }
    }
    report.daily = n;
  }

  // milestones: one at a time while there's time for another model poll (~45 s)
  while (Date.now() - t0 < budget - 50_000) {
    const { data: claimed, error } = await sb.rpc("competition_milestone_claim", {
      _id: opts.milestoneId ?? null,
    });
    if (error) throw new Error(error.message);
    const m = (claimed ?? [])[0];
    if (!m) break;
    const r = await processMilestone(sb, m);
    report.processed.push({ id: m.id, kind: m.kind, status: r.status });
    if (opts.milestoneId) break;
  }
  return report;
}
