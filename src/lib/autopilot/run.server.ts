/**
 * Cleo Autopilot, server side (Nov 25 2026): the weekly assessment run, the
 * drafts it lands in the existing builders, publishing what the coach
 * allowed, rollback, and outcome tracking. See docs/CLEO_AUTOPILOT.md.
 *
 *   - runAssessment: after a weekly check-in's recap (recapCheckin, the same
 *     pass that records the weight-management read and the coordinated
 *     recommendation, so nothing is loaded twice), or from the hourly scan for
 *     a coaching client whose week went without one. Deterministic: no model.
 *   - drafts: training → an Edit with AI turn (`program_ai_edits`, answered
 *     by its own worker, applied through `program_ai_apply` with a restore
 *     point); nutrition → Change it with AI on their current plan
 *     (`queuePlanEdit`, applied by `applyPlanEdit`, undone by `undoPlanEdit`);
 *     cardio → the cardio draft (`saveCardioDraft`), from the engine's
 *     treadmill step in code, else from Cleo — Cardio. The coach's own
 *     unpublished draft is never written over.
 *   - publishDecision: only for a coach's approval, or Smart / Advanced with
 *     shadow off; revalidated against a fresh assessment and the drafts as
 *     they are now, never during an active workout, then one system card.
 *   - rollbackDecision: undo / restore through each builder's own path.
 *   - scanAutopilot: the hourly pass (pg_cron `cleo-autopilot-hourly`).
 *
 * Every write is the service role after the caller's staff check (the server
 * functions) or from the hook. Never throws out of runAssessment (a check-in
 * recap never waits on it).
 */
import { assessClient, assessmentHash, isoAdd, type AssessInput, type PainRead, type TrainingRead } from "@/lib/autopilot/assess";
import { resolveSettings, routeAssessment, type Settings, type SettingsRow } from "@/lib/autopilot/autonomy";
import { applyCardioStep } from "@/lib/autopilot/cardio-step";
import { judgeOutcome, type OutcomeSnapshot } from "@/lib/autopilot/outcome";
import { AUTOPILOT_MESSAGE_KIND, publishWindow, systemCard, type PublishedChange } from "@/lib/autopilot/publish";
import type { AutopilotAssessment, Bucket, Domain, StoredDomain } from "@/lib/autopilot/types";
import type { LoadedWeightManagement } from "@/lib/weight-management/load.server";

export const AUTOPILOT_TAG = "[Autopilot]";

type Db = any;

export async function autopilotAvailable(sb: Db): Promise<boolean> {
  const { error } = await sb.from("autopilot_decisions").select("id").limit(1);
  return !error;
}

function localToday(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

function isoMonday(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/** The coach whose name automated changes go out under (their assigned coach, else an admin). */
export async function coachUserFor(sb: Db, clientId: string): Promise<string | null> {
  const { data: client } = await sb.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle();
  if (client?.assigned_coach_id) {
    const { data: coach } = await sb.from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
    if (coach?.user_id) return coach.user_id;
  }
  const { data: adminRole } = await sb.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  return adminRole?.user_id ?? null;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */

export async function loadSettingsRows(sb: Db, clientId: string | null): Promise<{ global: SettingsRow | null; client: SettingsRow | null }> {
  const { data } = await sb.from("autopilot_settings").select("*").or(clientId ? `scope.eq.global,client_id.eq.${clientId}` : "scope.eq.global");
  const rows = (data ?? []) as SettingsRow[];
  return { global: rows.find((r) => r.scope === "global") ?? null, client: rows.find((r) => r.scope === "client") ?? null };
}

export async function settingsFor(sb: Db, clientId: string, today: string): Promise<Settings> {
  const { global, client } = await loadSettingsRows(sb, clientId);
  return resolveSettings(global, client, today);
}

/* ------------------------------------------------------------------ */
/* Reads (all existing systems)                                        */

async function trainingRead(sb: Db, clientId: string, today: string): Promise<TrainingRead> {
  const from = isoAdd(today, -14);
  const { loadProgramContext } = await import("@/lib/program-context.server");
  const [ctx, sched, done, checkin, version] = await Promise.all([
    loadProgramContext(sb, clientId).catch(() => null),
    sb.from("pl_scheduled_workouts").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("scheduled_date", from).lt("scheduled_date", today),
    sb.from("pl_day_completions").select("id", { count: "exact", head: true }).eq("client_id", clientId).not("completed_at", "is", null).gte("completed_at", `${from}T00:00:00Z`),
    sb.from("messenger_checkins").select("answers, submitted_at").eq("client_id", clientId).eq("task_type", "weekly_checkin").eq("status", "completed").gte("submitted_at", `${isoAdd(today, -10)}T00:00:00Z`).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("pl_program_versions").select("created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const w = ctx?.this_week ?? null;
  const rating = Number((checkin as any)?.data?.answers?.training_rating);
  const lastChange = (version as any)?.data?.created_at as string | undefined;
  const endsInDays = w?.end ? daysBetween(today, w.end) + Math.max(0, (w.weeks_in_block ?? w.week) - w.week) * 7 : null;
  return {
    activeProgram: !!ctx && ctx.status !== "completed",
    planned: typeof (sched as any)?.count === "number" ? (sched as any).count : null,
    completed: typeof (done as any)?.count === "number" ? (done as any).count : null,
    rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
    block: w ? { name: ctx?.block?.name ?? w.block, week: w.week, weeks: w.weeks_in_block, endsInDays } : null,
    nextBlockReady: !!ctx?.next_block || (!!ctx?.next_week && ctx.next_week.block_id !== w?.block_id),
    daysSinceChange: lastChange ? daysBetween(lastChange.slice(0, 10), today) : null,
  };
}

async function painRead(sb: Db, clientId: string, tz: string | null): Promise<PainRead> {
  try {
    const { loadPainEntries, todayIn } = await import("@/lib/pain/load");
    const { buildPainHistory, areaSummary } = await import("@/lib/pain/history");
    const byClient = await loadPainEntries(sb, [clientId], { tz: new Map([[clientId, tz]]) });
    const h = buildPainHistory(byClient.get(clientId) ?? [], todayIn(tz));
    const top = h.flagged[0];
    if (top) {
      const severe = top.reasons.some((r) => r === "red_flag" || r === "severe" || r === "stopped");
      return { level: severe ? "severe" : "flag", text: areaSummary(top) };
    }
    return { level: h.areas.length ? "mild" : "none", text: null };
  } catch {
    // a safety read that can't be made never reads as "nothing there": the coach looks
    return { level: "flag", text: "Pain history couldn't be read: check it before changing training." };
  }
}

async function meetDaysOut(sb: Db, clientId: string, today: string): Promise<number | null> {
  const { data } = await sb.from("competitions").select("meet_date").eq("client_id", clientId).eq("status", "upcoming").gte("meet_date", today).order("meet_date").limit(1).maybeSingle();
  return data?.meet_date ? daysBetween(today, data.meet_date) : null;
}

/** Ids of drafts an autopilot decision made (so the coach's own drafts can be told apart). */
async function autopilotDraftIds(sb: Db, clientId: string): Promise<Set<string>> {
  const { data } = await sb.from("autopilot_decisions").select("domains").eq("client_id", clientId).order("created_at", { ascending: false }).limit(10);
  const ids = new Set<string>();
  for (const r of data ?? []) for (const d of Object.values((r.domains ?? {}) as Record<string, StoredDomain>)) if (d?.draft && "id" in d.draft) ids.add(d.draft.id);
  return ids;
}

async function coachDrafts(sb: Db, clientId: string, cardioDraft: { note: string | null } | null): Promise<AssessInput["coachDrafts"]> {
  const mine = await autopilotDraftIds(sb, clientId);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: nut }, { data: prog }] = await Promise.all([
    sb.from("nutrition_plan_edits").select("id").eq("client_id", clientId).in("status", ["pending", "generating", "ready"]).gte("created_at", since),
    sb.from("program_ai_edits").select("id").eq("client_id", clientId).in("status", ["pending", "running", "ready"]).gte("created_at", since),
  ]);
  return {
    cardio: !!cardioDraft && !String(cardioDraft.note ?? "").startsWith(AUTOPILOT_TAG),
    nutrition: (nut ?? []).some((r: any) => !mine.has(r.id)),
    training: (prog ?? []).some((r: any) => !mine.has(r.id)),
  };
}

function snapshotOf(loaded: LoadedWeightManagement, t: TrainingRead | null): OutcomeSnapshot {
  const a = loaded.assessment;
  const adh = t && t.planned && t.planned >= 3 && t.completed != null ? Math.min(1, t.completed / t.planned) : null;
  return {
    date: a.today,
    kgPerWeek: a.trajectory.trend?.kgPerWeek ?? null,
    requiredKgPerWeek: a.trajectory.required?.kgPerWeek ?? null,
    status: a.trajectory.status ?? null,
    performance: a.performance.lower,
    adherence: adh,
  };
}

/** Everything the assessment reads, from the existing systems. */
export async function gatherInput(sb: Db, clientId: string, x: { trigger: AssessInput["trigger"]; checkinId: string | null; loaded?: LoadedWeightManagement | null }) {
  const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
  const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
  const { consolidate } = await import("@/lib/coaching-recommendation/consolidate");
  const loaded = x.loaded ?? (await loadWeightManagement(sb, clientId));
  const today = loaded.assessment.today;
  const view = await loadCardioWorkspace(sb, clientId, { loaded }).catch(() => null);
  const rec = consolidate(loaded.assessment.recommendation, view?.read ?? null);
  const [training, pain, meet, drafts] = await Promise.all([
    trainingRead(sb, clientId, today),
    painRead(sb, clientId, loaded.client.tz),
    meetDaysOut(sb, clientId, today),
    coachDrafts(sb, clientId, view?.draft ?? null),
  ]);
  const wmCardio = loaded.assessment.recommendation.actions.find((a) => a.kind === "cardio");
  const input: AssessInput = {
    today,
    trigger: x.trigger,
    checkinId: x.checkinId,
    direction: loaded.assessment.direction,
    wm: loaded.assessment.recommendation,
    wmCardioPlan: wmCardio && wmCardio.kind === "cardio" ? wmCardio.plan : null,
    rec,
    performance: loaded.assessment.performance.lower,
    training,
    pain,
    meetDaysOut: meet ?? (loaded.assessment.meetWeeksOut != null ? Math.round(loaded.assessment.meetWeeksOut * 7) : null),
    hasNutritionPlan: !!loaded.refs.planId,
    coachDrafts: drafts,
  };
  return { input, loaded, view, rec };
}

/* ------------------------------------------------------------------ */
/* Before / after in the client's words                                 */

async function nutritionWords(sb: Db, planId: string | null): Promise<string | null> {
  if (!planId) return null;
  const { data } = await sb.from("nutrition_target_days").select("day_label, calories, protein, sort_order").eq("target_id", planId).order("sort_order");
  const days = (data ?? []).filter((d: any) => Number(d.calories) > 0);
  if (!days.length) return null;
  return days
    .slice(0, 4)
    .map((d: any) => `${d.day_label || "Day"} ${Math.round(Number(d.calories)).toLocaleString("en-US")} kcal${d.protein ? `, ${Math.round(Number(d.protein))} g protein` : ""}`)
    .join(" · ");
}

async function cardioWords(plan: any, ctx: any): Promise<string> {
  const { planTotals, sessionLine } = await import("@/lib/cardio/plan");
  const t = planTotals(plan, ctx);
  const first = plan.sessions.filter((s: any) => s.enabled).slice(0, 2).map((s: any) => sessionLine(s, "mph"));
  return `${t.minutes} min a week${first.length ? ` (${first.join("; ")})` : ""}`;
}

/* ------------------------------------------------------------------ */
/* The assessment run                                                   */

export type RunResult = { decisionId: string; assessment: AutopilotAssessment; bucket: Bucket } | null;

export async function runAssessment(
  sb: Db,
  clientId: string,
  x: { trigger: AssessInput["trigger"]; checkinId?: string | null; loaded?: LoadedWeightManagement | null; draft?: boolean },
): Promise<RunResult> {
  try {
    if (!(await autopilotAvailable(sb))) return null;
    if (x.checkinId) {
      // a redone recap reads the decision already on record (one assessment per check-in)
      const { data: had } = await sb.from("autopilot_decisions").select("*").eq("checkin_id", x.checkinId).maybeSingle();
      if (had) {
        const { assessmentFromRow } = await import("@/lib/autopilot/reply.server");
        return { decisionId: had.id, assessment: assessmentFromRow(had), bucket: had.bucket };
      }
    }
    const { input, loaded, view } = await gatherInput(sb, clientId, { trigger: x.trigger, checkinId: x.checkinId ?? null, loaded: x.loaded });
    const assessment = assessClient(input);
    const settings = await settingsFor(sb, clientId, input.today);
    const { routes, bucket } = routeAssessment(assessment, settings);
    const hash = assessmentHash(assessment, loaded.assessment.hash);

    // a scheduled run that would say the same as the open one records nothing new
    const { data: prev } = await sb.from("autopilot_decisions").select("id, version, input_hash, status").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (x.trigger === "scheduled" && prev && prev.input_hash === hash && ["open", "approved", "deferred", "publishing"].includes(prev.status)) return null;

    const [nutBefore, cardBefore] = await Promise.all([
      nutritionWords(sb, loaded.refs.planId),
      view ? cardioWords(view.pending?.plan ?? view.live, view.ctx) : Promise.resolve(null),
    ]);
    const domains: Record<Domain, StoredDomain> = {} as any;
    for (const d of ["training", "nutrition", "cardio"] as Domain[]) {
      domains[d] = {
        ...assessment.domains[d],
        routing: routes[d],
        draft: null,
        draftError: null,
        before: d === "nutrition" ? nutBefore : d === "cardio" ? cardBefore : null,
        after: null,
        published: null,
        rolledBack: null,
      };
    }
    const training = input.training;
    const row = {
      client_id: clientId,
      version: (prev?.version ?? 0) + 1,
      supersedes_id: prev?.id ?? null,
      trigger: x.trigger,
      checkin_id: x.checkinId ?? null,
      week_of: isoMonday(input.today),
      category: assessment.category,
      headline: assessment.headline,
      rationale: assessment.rationale,
      expected_outcome: assessment.expected,
      reassess_on: assessment.reassessOn,
      evidence: assessment.evidence,
      protected: assessment.protections,
      missing: assessment.missing,
      domains,
      bucket,
      status: "open",
      shadow: settings.shadow,
      settings: { resolved: settings, baseline: snapshotOf(loaded, training), wm_hash: loaded.assessment.hash },
      input_hash: hash,
    };
    const { data: ins, error } = await sb.from("autopilot_decisions").insert(row).select("id").single();
    if (error || !ins) {
      console.warn("[autopilot] decision not recorded", error?.message);
      return null;
    }
    // the newest decision is the one in force
    await sb.from("autopilot_decisions").update({ status: "superseded" }).eq("client_id", clientId).in("status", ["open", "deferred"]).neq("id", ins.id);
    if (x.draft !== false) await createDrafts(sb, ins.id).catch((e) => console.warn("[autopilot] drafts", e?.message));
    return { decisionId: ins.id, assessment, bucket };
  } catch (e: any) {
    console.warn("[autopilot] assessment not run", e?.message ?? e);
    return null;
  }
}

async function patchDomain(sb: Db, id: string, domain: Domain, patch: Partial<StoredDomain>, extra: Record<string, unknown> = {}) {
  const { data } = await sb.from("autopilot_decisions").select("domains").eq("id", id).maybeSingle();
  const domains = { ...(data?.domains ?? {}) };
  domains[domain] = { ...(domains[domain] ?? {}), ...patch };
  await sb.from("autopilot_decisions").update({ domains, ...extra }).eq("id", id);
  return domains as Record<Domain, StoredDomain>;
}

async function addCost(sb: Db, id: string, call: { model?: string | null; input?: number | null; output?: number | null }) {
  const { addUsage } = await import("@/lib/autopilot/cost");
  const { data } = await sb.from("autopilot_decisions").select("cost").eq("id", id).maybeSingle();
  await sb.from("autopilot_decisions").update({ cost: addUsage(data?.cost ?? null, call) }).eq("id", id);
}

/** Land each proposed change as a real draft in its builder. */
export async function createDrafts(sb: Db, decisionId: string): Promise<void> {
  const { data: dec } = await sb.from("autopilot_decisions").select("*").eq("id", decisionId).maybeSingle();
  if (!dec || dec.status !== "open") return;
  const clientId = dec.client_id as string;
  const userId = await coachUserFor(sb, clientId);
  if (!userId) return;
  const domains = dec.domains as Record<Domain, StoredDomain>;
  for (const d of ["nutrition", "cardio", "training"] as Domain[]) {
    const s = domains[d];
    if (!s || s.change !== "propose" || s.routing.action === "none" || s.draft) continue;
    try {
      if (d === "nutrition") {
        const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
        const loaded = await loadWeightManagement(sb, clientId);
        if (!loaded.refs.planId) throw new Error("No current nutrition plan");
        const { queuePlanEdit } = await import("@/lib/nutrition-plan-edits.server");
        const q = await queuePlanEdit(sb, { clientId, targetId: loaded.refs.planId, instructions: `${AUTOPILOT_TAG} ${s.instruction}`, userId });
        await patchDomain(sb, decisionId, d, { draft: { kind: "nutrition_plan_edit", id: q.id } });
        await addCost(sb, decisionId, { model: null });
      } else if (d === "cardio") {
        const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
        const { saveCardioDraft } = await import("@/lib/cardio/publish.server");
        const view = await loadCardioWorkspace(sb, clientId);
        if (view.draft && !String(view.draft.note ?? "").startsWith(AUTOPILOT_TAG)) throw new Error("Your own cardio draft is in progress");
        const base = view.pending?.plan ?? view.live;
        let after: Parameters<typeof applyCardioStep>[2] = null;
        if (s.cardioStep && (s.cardioStep.variable === "added" || s.cardioStep.variable === "frequency")) {
          const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
          const act = (await loadWeightManagement(sb, clientId)).assessment.recommendation.actions.find((x) => x.kind === "cardio");
          after = act && act.kind === "cardio" ? act.plan : null;
        }
        let plan = s.cardioStep ? applyCardioStep(base, s.cardioStep, after, view.ctx) : null;
        let deterministic = !!plan;
        if (!plan) {
          const { askCardioCleo } = await import("@/lib/cardio/cleo.server");
          const proposal = await askCardioCleo(sb, { clientId, userId, instructions: `From the weekly assessment: ${s.instruction} (${s.reason})`, draft: base.sessions, scope: "the whole cardio plan" });
          await addCost(sb, decisionId, { model: proposal.model });
          plan = proposal.plan;
          deterministic = false;
          if (!plan) throw new Error(proposal.answer?.slice(0, 200) || "No cardio draft came back");
        }
        const saved = await saveCardioDraft(sb, { clientId, userId, sessions: plan.sessions, effectiveDate: null, note: `${AUTOPILOT_TAG} ${s.summary}`, baseHash: view.baseHash });
        await patchDomain(sb, decisionId, d, { draft: { kind: "cardio_draft", savedAt: saved.savedAt, deterministic }, after: await cardioWords(plan, view.ctx) });
      } else {
        const { data: edit, error } = await sb
          .from("program_ai_edits")
          .insert({ target_kind: "client", client_id: clientId, instruction: `${AUTOPILOT_TAG} ${s.instruction}`, rejected: [], created_by: userId, status: "pending" })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await patchDomain(sb, decisionId, d, { draft: { kind: "program_ai_edit", id: edit.id } });
        await addCost(sb, decisionId, { model: null });
      }
    } catch (e: any) {
      await patchDomain(sb, decisionId, d, { draftError: String(e?.message ?? e).slice(0, 300), routing: { ...s.routing, bucket: "requires_attention" } }, { bucket: "requires_attention" });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Publishing                                                           */

type Actor = { userId: string; supabase: Db } | null;

/** A domain's draft as it is now: ready to publish, still being written, or gone / failed. */
async function draftState(sb: Db, clientId: string, s: StoredDomain): Promise<"ready" | "waiting" | "gone" | "edited"> {
  if (!s.draft) return "gone";
  if (s.draft.kind === "nutrition_plan_edit") {
    const { data } = await sb.from("nutrition_plan_edits").select("status").eq("id", s.draft.id).maybeSingle();
    return data?.status === "ready" ? "ready" : data?.status === "pending" || data?.status === "generating" ? "waiting" : "gone";
  }
  if (s.draft.kind === "program_ai_edit") {
    const { data } = await sb.from("program_ai_edits").select("status").eq("id", s.draft.id).maybeSingle();
    return data?.status === "ready" ? "ready" : data?.status === "pending" || data?.status === "running" ? "waiting" : "gone";
  }
  const { data } = await sb.from("cardio_plan_drafts").select("updated_at, note").eq("client_id", clientId).maybeSingle();
  if (!data) return "gone";
  return Math.abs(Date.parse(data.updated_at) - Date.parse(s.draft.savedAt)) > 1000 ? "edited" : "ready";
}

/**
 * Publish a decision's drafts: by the coach (Approve), or by itself for a
 * domain Smart / Advanced routed to publish with shadow off. Revalidated
 * first; never during an active workout; one system card for what went live.
 */
export async function publishDecision(sb: Db, decisionId: string, actor: Actor): Promise<{ status: string; published: Domain[]; waiting?: string | null; errors: string[] }> {
  const { data: dec } = await sb.from("autopilot_decisions").select("*").eq("id", decisionId).maybeSingle();
  if (!dec) throw new Error("That decision wasn't found.");
  if (!["open", "approved", "publishing"].includes(dec.status)) return { status: dec.status, published: [], errors: [] };
  const clientId = dec.client_id as string;
  const domains = dec.domains as Record<Domain, StoredDomain>;
  const { data: client } = await sb.from("clients").select("timezone, last_active_at, user_id").eq("id", clientId).maybeSingle();
  const today = localToday(client?.timezone);
  const settings = await settingsFor(sb, clientId, today);

  // which domains: the coach's approval takes every drafted one (now, or from the hourly pass once a
  // draft is written: training then waits for the coach's own session); by itself, only what autonomy routes to publish
  const approved = !!actor || (dec.status === "approved" && !!dec.decided_by);
  let wanted = (["nutrition", "cardio", "training"] as Domain[]).filter((d) => domains[d]?.draft && !domains[d].published);
  if (!actor && approved) wanted = wanted.filter((d) => d !== "training");
  if (!approved) {
    if (settings.paused) return { status: dec.status, published: [], waiting: "paused", errors: [] };
    wanted = wanted.filter((d) => domains[d].routing.action === "publish" && !settings.shadow && settings.modes[d] !== "draft" && !settings.locked.includes(d) && d !== "training");
  }
  if (!wanted.length) return { status: dec.status, published: [], errors: [] };

  // never during an active workout; preferably while they're out of the app
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: acts } = await sb.from("pl_day_completions").select("started_at, last_activity_at, completed_at, in_progress_at").eq("client_id", clientId).is("completed_at", null).or(`started_at.gte."${since}",last_activity_at.gte."${since}",in_progress_at.gte."${since}"`);
  const win = publishWindow({
    now: Date.now(),
    readySince: Date.parse(dec.publish_after ?? dec.created_at),
    workouts: (acts ?? []).map((r: any) => ({ startedAt: r.started_at ?? r.in_progress_at, lastActivityAt: r.last_activity_at, completedAt: r.completed_at })),
    lastSeenAt: actor ? null : client?.last_active_at ?? null,
  });
  if (!win.ok) {
    await sb.from("autopilot_decisions").update({ status: approved ? "approved" : dec.status, publish_after: new Date(Date.now() + win.retryAfterMs).toISOString(), decided_by: actor?.userId ?? dec.decided_by, decided_at: actor ? new Date().toISOString() : dec.decided_at }).eq("id", decisionId);
    return { status: approved ? "approved" : dec.status, published: [], waiting: win.reason, errors: [] };
  }

  // revalidate against the latest data: a fresh assessment must still want the same change
  const { input } = await gatherInput(sb, clientId, { trigger: "manual", checkinId: dec.checkin_id });
  const fresh = assessClient({ ...input, coachDrafts: {} });
  const errors: string[] = [];
  const published: Domain[] = [];
  const changes: PublishedChange[] = [];
  await sb.from("autopilot_decisions").update({ status: "publishing" }).eq("id", decisionId);
  const userId = actor?.userId ?? (approved ? dec.decided_by : null) ?? (await coachUserFor(sb, clientId));
  for (const d of wanted) {
    const s = domains[d];
    const now = fresh.domains[d];
    const freshGuard = fresh.protections.filter((p) => p.domain === d && p.reason !== "coach_draft");
    if (!approved) {
      const same = now.change === "propose" && (d !== "nutrition" || Math.sign(now.kcalPerDay ?? 0) === Math.sign(s.kcalPerDay ?? 0)) && (d !== "cardio" || (now.cardioStep?.variable === s.cardioStep?.variable && Math.sign(now.cardioMinutesDelta ?? 0) === Math.sign(s.cardioMinutesDelta ?? 0)));
      if (!same || freshGuard.length) {
        errors.push(`${d}: the latest data no longer calls for this change`);
        await patchDomain(sb, decisionId, d, { draftError: "Revalidation: the latest data no longer calls for this change", routing: { ...s.routing, action: "draft", bucket: "requires_attention" } });
        continue;
      }
    }
    const state = await draftState(sb, clientId, s);
    if (state === "waiting") continue;
    if (state === "gone" || (state === "edited" && !approved)) {
      errors.push(`${d}: ${state === "edited" ? "the draft was edited since; it waits for you" : "the draft isn't there any more"}`);
      await patchDomain(sb, decisionId, d, { draftError: state === "edited" ? "Edited since: waits for your approval" : "The draft isn't there any more", routing: { ...s.routing, action: "draft", bucket: "awaiting_approval" } });
      continue;
    }
    try {
      if (d === "nutrition" && s.draft?.kind === "nutrition_plan_edit") {
        const { applyPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
        const r = await applyPlanEdit(sb, s.draft.id, userId!);
        const after = await nutritionWords(sb, r.targetId);
        await patchDomain(sb, decisionId, d, { published: { at: new Date().toISOString(), ref: s.draft.id }, after, draftError: null });
        changes.push({ domain: d, before: s.before, after });
      } else if (d === "cardio") {
        const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
        const { publishCardioPlan } = await import("@/lib/cardio/publish.server");
        const view = await loadCardioWorkspace(sb, clientId);
        if (!view.draft) throw new Error("The cardio draft isn't there any more");
        const beforePlan = view.pending?.plan ?? view.live;
        const r = await publishCardioPlan(sb, { clientId, userId: userId!, sessions: view.draft.plan.sessions, effectiveDate: view.draft.effectiveDate, note: view.draft.note, source: "recommendation", restoredFrom: null, baseHash: view.draft.baseHash ?? view.baseHash, quality: null, notify: false });
        if (r.unchanged) {
          await patchDomain(sb, decisionId, d, { draftError: "Nothing to change: the plan already matches" });
          continue;
        }
        const after = await cardioWords(view.draft.plan, view.ctx);
        await patchDomain(sb, decisionId, d, { published: { at: new Date().toISOString(), ref: r.versionId }, after, draftError: null, beforePlan: beforePlan.sessions } as any);
        changes.push({ domain: d, before: s.before, after });
      } else if (d === "training" && s.draft?.kind === "program_ai_edit" && actor) {
        const { data: edit } = await sb.from("program_ai_edits").select("result").eq("id", s.draft.id).maybeSingle();
        const ids = ((edit?.result?.proposal ?? []) as Array<{ id: string; title?: string }>).map((c) => c.id);
        const titles = ((edit?.result?.proposal ?? []) as Array<{ id: string; title?: string }>).map((c) => c.title).filter(Boolean) as string[];
        if (!ids.length) throw new Error("The proposal has no changes");
        const { applyEdit } = await import("@/lib/program-ai/apply.server");
        const out: any = await applyEdit({ supabase: actor.supabase, userId: actor.userId } as any, s.draft.id, ids);
        const after = titles.slice(0, 3).join(" · ") || "Next week's training adjusted";
        await patchDomain(sb, decisionId, d, { published: { at: new Date().toISOString(), ref: out?.versionId ?? null }, after, before: "As planned", draftError: null });
        changes.push({ domain: d, before: "As planned", after });
      }
      published.push(d);
    } catch (e: any) {
      errors.push(`${d}: ${e?.message ?? e}`);
      await patchDomain(sb, decisionId, d, { draftError: String(e?.message ?? e).slice(0, 300) });
    }
  }

  // one card for everything that went live, once per decision; never for a failed or unpublished change
  let messageId: string | null = dec.message_id ?? null;
  if (changes.length && client?.user_id) {
    messageId = (await postSystemCard(sb, clientId, decisionId, changes, today, userId!)) ?? messageId;
  }
  const allDone = (["nutrition", "cardio", "training"] as Domain[]).every((d) => !domains[d]?.draft || published.includes(d) || domains[d].published);
  const status = published.length ? (allDone ? "published" : "approved") : approved ? "approved" : "open";
  await sb
    .from("autopilot_decisions")
    .update({
      status,
      bucket: published.length && !approved ? "auto_updated" : dec.bucket,
      published_at: published.length ? new Date().toISOString() : dec.published_at,
      message_id: messageId,
      error: errors.length ? errors.join("; ").slice(0, 1000) : null,
      ...(actor ? { decided_by: actor.userId, decided_at: new Date().toISOString() } : {}),
    })
    .eq("id", decisionId);
  return { status, published, errors };
}

async function postSystemCard(sb: Db, clientId: string, decisionId: string, changes: PublishedChange[], effective: string, senderId: string, rollback = false): Promise<string | null> {
  const card = systemCard(decisionId, changes, effective);
  if (!card) return null;
  const attachment = { ...card.attachment, ...(rollback ? { rollback: true } : {}) };
  // once per decision (and once per rollback)
  const { data: same } = await sb.from("messages").select("id").eq("client_id", clientId).contains("attachments", JSON.stringify([{ kind: AUTOPILOT_MESSAGE_KIND, decision_id: decisionId, ...(rollback ? { rollback: true } : {}) }])).limit(rollback ? 1 : 5);
  if (!rollback && (same ?? []).some(Boolean)) return same[0].id;
  if (rollback && same?.length) return same[0].id;
  const at = new Date().toISOString();
  const { data: msg, error } = await sb
    .from("messages")
    .insert({
      client_id: clientId,
      sender_id: senderId,
      sender_role: "admin",
      body: card.body,
      attachments: [attachment],
      message_type: "Plan Update",
      is_internal_note: false,
      // automated: not the coach replying, and never presented as typed by him
      is_automated: true,
      delivery_status: "sent",
      sent_at: at,
      read_by_admin_at: at,
    })
    .select("id")
    .single();
  if (error) return null;
  return msg.id as string;
}

/** Put a published decision back through each builder's own undo. */
export async function rollbackDecision(sb: Db, decisionId: string, actor: { userId: string; supabase: Db }): Promise<{ undone: Domain[]; errors: string[] }> {
  const { data: dec } = await sb.from("autopilot_decisions").select("*").eq("id", decisionId).maybeSingle();
  if (!dec) throw new Error("That decision wasn't found.");
  const domains = dec.domains as Record<Domain, StoredDomain & { beforePlan?: unknown }>;
  const undone: Domain[] = [];
  const errors: string[] = [];
  const changes: PublishedChange[] = [];
  for (const d of ["nutrition", "cardio", "training"] as Domain[]) {
    const s = domains[d];
    if (!s?.published || s.rolledBack) continue;
    try {
      if (d === "nutrition" && s.draft?.kind === "nutrition_plan_edit") {
        const { undoPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
        await undoPlanEdit(sb, s.draft.id);
      } else if (d === "cardio") {
        if (!Array.isArray(s.beforePlan)) throw new Error("The plan from before wasn't kept: restore it from the Cardio tab's versions");
        const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
        const { publishCardioPlan } = await import("@/lib/cardio/publish.server");
        const view = await loadCardioWorkspace(sb, dec.client_id);
        await publishCardioPlan(sb, { clientId: dec.client_id, userId: actor.userId, sessions: s.beforePlan, effectiveDate: null, note: `${AUTOPILOT_TAG} Rolled back`, source: "restore", restoredFrom: s.published.ref, baseHash: view.baseHash, quality: null, notify: false });
      } else if (d === "training" && s.published.ref) {
        const { undoVersion } = await import("@/lib/program-ai/apply.server");
        await undoVersion({ supabase: actor.supabase, userId: actor.userId } as any, s.published.ref);
      } else continue;
      await patchDomain(sb, decisionId, d, { rolledBack: { at: new Date().toISOString(), by: actor.userId } });
      undone.push(d);
      if (d !== "training") changes.push({ domain: d, before: s.after, after: s.before });
    } catch (e: any) {
      errors.push(`${d}: ${e?.message ?? e}`);
    }
  }
  if (undone.length) {
    const { data: client } = await sb.from("clients").select("timezone, user_id").eq("id", dec.client_id).maybeSingle();
    if (client?.user_id && changes.length) await postSystemCard(sb, dec.client_id, decisionId, changes, localToday(client.timezone), actor.userId, true);
    await sb.from("autopilot_decisions").update({ status: "rolled_back", decided_by: actor.userId, decided_at: new Date().toISOString() }).eq("id", decisionId);
  }
  return { undone, errors };
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                             */

export async function checkOutcome(sb: Db, decisionId: string): Promise<void> {
  const { data: dec } = await sb.from("autopilot_decisions").select("*").eq("id", decisionId).maybeSingle();
  if (!dec || dec.outcome) return;
  const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
  const loaded = await loadWeightManagement(sb, dec.client_id);
  const t = await trainingRead(sb, dec.client_id, loaded.assessment.today);
  const domains = dec.domains as Record<Domain, StoredDomain>;
  const changed = (["nutrition", "cardio", "training"] as Domain[]).filter((d) => domains[d]?.published && !domains[d].rolledBack);
  const outcome = judgeOutcome({ category: dec.category, changed, baseline: dec.settings?.baseline ?? null, now: snapshotOf(loaded, t) });
  if (outcome.verdict === "too_early") return;
  await sb.from("autopilot_decisions").update({ outcome, outcome_checked_at: new Date().toISOString() }).eq("id", decisionId);
}

/* ------------------------------------------------------------------ */
/* The hourly pass                                                      */

/** A coaching client whose week went without an assessment (a missed check-in) gets one after their check-in day passed. */
export async function scanAutopilot(sb: Db, opts: { budgetMs?: number } = {}): Promise<{ assessed: number; published: number; outcomes: number; drafts: number }> {
  const stop = Date.now() + (opts.budgetMs ?? 90_000);
  const out = { assessed: 0, published: 0, outcomes: 0, drafts: 0 };
  if (!(await autopilotAvailable(sb))) return out;

  // 1. publish what's due (approved by the coach and waiting on a window, or allowed by itself)
  const { data: due } = await sb
    .from("autopilot_decisions")
    .select("id, status, publish_after, domains")
    .in("status", ["open", "approved", "publishing"])
    .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("created_at")
    .limit(40);
  for (const d of due ?? []) {
    if (Date.now() > stop) break;
    if (d.publish_after && Date.parse(d.publish_after) > Date.now()) continue;
    const doms = Object.values((d.domains ?? {}) as Record<string, StoredDomain>);
    // drafts that failed to start (a busy builder) get one more go
    if (d.status === "open" && doms.some((s) => s.change === "propose" && s.routing?.action !== "none" && !s.draft && !s.draftError)) {
      await createDrafts(sb, d.id).catch(() => undefined);
      out.drafts++;
    }
    const auto = d.status === "open" && doms.some((s) => s.routing?.action === "publish" && s.draft && !s.published);
    // approved by the coach and waiting on a draft or a quiet moment (a training change needs the coach's own session: it waits for them)
    const approvedWaiting = d.status === "approved" && doms.some((s) => s.draft && !s.published && s.domain !== "training");
    if (!auto && !approvedWaiting) continue;
    try {
      const r = await publishDecision(sb, d.id, null);
      if (r.published.length) out.published++;
    } catch (e: any) {
      console.warn("[autopilot] publish", e?.message);
    }
  }

  // 2. outcomes on their reassessment date
  const today = localToday(null);
  const { data: reassess } = await sb
    .from("autopilot_decisions")
    .select("id")
    .is("outcome", null)
    .lte("reassess_on", today)
    .not("status", "in", "(rejected,failed)")
    .order("reassess_on")
    .limit(20);
  for (const r of reassess ?? []) {
    if (Date.now() > stop) break;
    await checkOutcome(sb, r.id).catch(() => undefined);
    out.outcomes++;
  }

  // 3. a week without a check-in: the scheduled assessment (deterministic, no model)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: clients } = await sb
    .from("clients")
    .select("id, user_id, archived, archived_at, status, deactivated_at")
    .eq("archived", false)
    .is("archived_at", null)
    .not("user_id", "is", null)
    .limit(1000);
  const active = (clients ?? []).filter((c: any) => !["Archived", "Deactivated"].includes(String(c.status ?? "")) && !c.deactivated_at);
  if (active.length) {
    const ids = active.map((c: any) => c.id);
    const recent = new Set<string>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from("autopilot_decisions").select("client_id").in("client_id", ids.slice(i, i + 150)).gte("created_at", weekAgo);
      for (const r of data ?? []) recent.add(r.client_id);
    }
    for (const c of active) {
      if (Date.now() > stop) break;
      if (recent.has(c.id)) continue;
      // a check-in still open from the last 2 days is given its chance first
      const { data: open } = await sb.from("messenger_checkins").select("id").eq("client_id", c.id).eq("task_type", "weekly_checkin").neq("status", "completed").gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).limit(1);
      if (open?.length) continue;
      const r = await runAssessment(sb, c.id, { trigger: "scheduled", checkinId: null });
      if (r) out.assessed++;
    }
  }
  return out;
}
