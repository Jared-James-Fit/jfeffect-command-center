/**
 * The nutrition roadmap's server functions. Reads go through the caller's own
 * login (RLS decides what they may see); every write runs as the server only
 * after it checked who's asking: the athlete themselves (never a coach viewing
 * as them), or the athlete's own coach or an admin. A coached athlete's goal,
 * targets and approvals are the coach's; a self-coached athlete owns theirs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canViewClient, isPovRequest, PovInput, resolvePovClientId } from "@/lib/client-pov.server";
import type { BoardRow, CoachRoadmapView, RoadmapView } from "@/lib/nutrition-roadmap/view";

const server = () => import("@/lib/nutrition-roadmap/roadmap.server");
const evaluator = () => import("@/lib/nutrition-roadmap/evaluate.server");
// the roadmap tables are newer than the generated database types
const admin = async (): Promise<any> => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function isStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

/** The caller's own client row (never someone they're viewing as). */
async function ownClient(supabase: any, userId: string): Promise<{ id: string; service_tier: string | null } | null> {
  const { data } = await supabase.from("clients").select("id, service_tier").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

async function requireCoachOf(supabase: any, userId: string, clientId: string) {
  if (!(await isStaff(supabase, userId)) || !(await canViewClient(supabase, userId, clientId))) throw new Error("Coach access required");
}

/** The athlete's roadmap (a coach in View as client reads it, changes nothing). */
export const getMyRoadmapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data: pov, context }): Promise<RoadmapView | null> => {
    const clientId = await resolvePovClientId(context.supabase, context.userId, pov);
    if (!clientId) return null;
    const canEdit = !isPovRequest(context.userId, pov);
    return (await server()).myRoadmapView(context.supabase, await admin(), clientId, { canEdit });
  });

export const getClientRoadmapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CoachRoadmapView> => {
    await requireCoachOf(context.supabase, context.userId, data.clientId);
    return (await server()).coachRoadmapView(context.supabase, await admin(), data.clientId);
  });

/** Read it again now and propose what changed (a coach's Refresh). */
export const refreshClientRoadmapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCoachOf(context.supabase, context.userId, data.clientId);
    const e = await (await evaluator()).evaluateRoadmap(await admin(), data.clientId, { trigger: "coach", actorUserId: context.userId });
    return { created: !!e.created, status: e.read.progress.status };
  });

export const decideRoadmapRevisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ revisionId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).nullish() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: rev } = await sb.from("nutrition_roadmap_revisions").select((await import("@/lib/nutrition-roadmap/load.server")).REVISION_SELECT).eq("id", data.revisionId).maybeSingle();
    if (!rev) throw new Error("Not found");
    if (rev.decider === "coach") await requireCoachOf(context.supabase, context.userId, rev.client_id);
    else {
      const own = await ownClient(context.supabase, context.userId);
      if (!own || own.id !== rev.client_id) throw new Error("Only you can decide this one");
    }
    return (await server()).decideRevision(sb, rev as any, data.decision, context.userId, data.note ?? null);
  });

export const saveRoadmapPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        everyDays: z.number().int().min(3).max(28).nullable(),
        lockCompetition: z.boolean(),
        reminders: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireCoachOf(context.supabase, context.userId, data.clientId);
    const sb = await admin();
    const { error } = await sb.from("nutrition_roadmaps").upsert({ client_id: data.clientId, prefs: { everyDays: data.everyDays, lockCompetition: data.lockCompetition, reminders: data.reminders } }, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    await (await evaluator()).evaluateRoadmap(sb, data.clientId, { trigger: "open" }).catch(() => null);
    return { ok: true };
  });

/** A self-coached athlete lets small, routine changes apply by themselves (never a health flag or a competition phase). */
export const setRoadmapConsentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ consent: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const own = await ownClient(context.supabase, context.userId);
    if (!own || own.service_tier !== "self_serve") throw new Error("Only for your own roadmap");
    const { error } = await (await admin()).from("nutrition_roadmaps").upsert({ client_id: own.id, auto_adjust: data.consent, auto_adjust_at: data.consent ? new Date().toISOString() : null }, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const meetSchema = z
  .object({
    name: z.string().trim().max(120).nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weightClass: z.string().trim().max(20).nullable(),
    federation: z.string().trim().max(60).nullable(),
    sport: z.enum(["powerlifting", "bodybuilding", "other"]),
  })
  .nullable();

/** A self-coached athlete's goal (a coached athlete's is their coach's). */
export const saveMyRoadmapGoalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        type: z.enum(["lose", "gain", "maintain", "performance_cut"]).nullable(),
        value: z.number().min(25).max(400).nullable(),
        unit: z.enum(["kg", "lb"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        meet: meetSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const own = await ownClient(context.supabase, context.userId);
    if (!own) throw new Error("No athlete record");
    if (own.service_tier !== "self_serve") throw new Error("Your coach sets your goal");
    const sb = await admin();
    const clear = data.type == null;
    const { error } = await sb
      .from("clients")
      .update({
        bodyweight_goal_type: clear ? null : data.type,
        bodyweight_goal_value: clear ? null : data.value,
        bodyweight_goal_value_max: null,
        bodyweight_goal_unit: clear ? null : data.unit,
        bodyweight_goal_date: clear ? null : data.date,
        bodyweight_goal_set_at: clear ? null : new Date().toISOString(),
      })
      .eq("id", own.id);
    if (error) throw new Error(error.message);
    const { error: e2 } = await sb.from("nutrition_roadmaps").upsert({ client_id: own.id, athlete_goal: data.meet }, { onConflict: "client_id" });
    if (e2) throw new Error(e2.message);
    const e = await (await evaluator()).evaluateRoadmap(sb, own.id, { trigger: "goal_change", actorUserId: context.userId });
    return { ok: true, verdict: e.fresh.feasibility.verdict, headline: e.fresh.feasibility.headline };
  });

const answerValue = z.union([z.string().max(600), z.number().min(0).max(10), z.array(z.string().max(80)).max(12)]);

/** A self-coached athlete's check-in: saved, then the roadmap read again with it. */
export const submitRoadmapCheckinFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ answers: z.record(z.string().max(40), answerValue).refine((a) => Object.keys(a).length <= 20, "Too many answers") })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const own = await ownClient(context.supabase, context.userId);
    if (!own || own.service_tier !== "self_serve") throw new Error("Coached athletes check in with their coach");
    const sb = await admin();
    // one check-in at a time: each re-reads their whole history
    const { data: last } = await sb.from("nutrition_roadmap_checkins").select("submitted_at").eq("client_id", own.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.submitted_at && Date.now() - Date.parse(last.submitted_at) < 5 * 60_000) throw new Error("You just checked in. Your next one is on your roadmap.");
    const { data: c } = await sb.from("clients").select("timezone").eq("id", own.id).maybeSingle();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: c?.timezone || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const { data: open } = await sb.from("nutrition_roadmap_checkins").select("id").eq("client_id", own.id).is("submitted_at", null).lte("due_on", today).order("due_on", { ascending: false }).limit(1).maybeSingle();
    const row = { answers: data.answers, submitted_at: new Date().toISOString(), submitted_by: context.userId };
    const { error } = open?.id
      ? await sb.from("nutrition_roadmap_checkins").update(row).eq("id", open.id)
      : await sb.from("nutrition_roadmap_checkins").upsert({ client_id: own.id, due_on: today, ...row }, { onConflict: "client_id,due_on" });
    if (error) throw new Error(error.message);
    const e = await (await evaluator()).evaluateRoadmap(sb, own.id, { trigger: "checkin", actorUserId: context.userId });
    return {
      status: e.read.progress.status,
      headline: e.read.progress.headline,
      decision: e.read.decision.headline,
      action: e.read.decision.action,
      nextOn: e.read.checkin.on,
      update: !!e.created && e.created.status === "proposed",
      autoApplied: e.autoApplied,
    };
  });

/** The words for the roadmap in effect (a model's, checked; the engine's own words stand in until then). */
export const explainRoadmapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.extend({ clientId: z.string().uuid().nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const clientId = data.clientId ?? (await resolvePovClientId(context.supabase, context.userId, data));
    if (!clientId) return null;
    if (data.clientId) await requireCoachOf(context.supabase, context.userId, clientId);
    // the caller can see this roadmap (their own, or as its coach): the server writes the words once
    const { data: row } = await (context.supabase as any).from("nutrition_roadmaps").select("client_id").eq("client_id", clientId).maybeSingle();
    if (!row) return null;
    return (await server()).explainActive(await admin(), clientId);
  });

export const roadmapBoardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BoardRow[]> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    return (await server()).roadmapBoard(context.supabase);
  });
