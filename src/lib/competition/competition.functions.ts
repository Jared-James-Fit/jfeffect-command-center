/**
 * Competition Intelligence's server functions (Nov 24 2026). Staff ones check
 * that the signed-in staff member reaches the client (the admin, or the
 * client's own coach) before the service role reads or writes anything; the
 * athlete ones read only that athlete's released updates (the athlete version,
 * never the internal read). Nothing here changes a program, a plan or an
 * official attempt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function assertReach(supabase: any, userId: string, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
}
async function clientOfCompetition(sb: any, competitionId: string): Promise<string> {
  const { data, error } = await sb
    .from("competitions")
    .select("client_id")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Competition not found");
  return data.client_id as string;
}
async function clientOfAssessment(
  sb: any,
  id: string,
): Promise<{ clientId: string; competitionId: string }> {
  const { data, error } = await sb
    .from("competition_assessments")
    .select("client_id, competition_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Assessment not found");
  return { clientId: data.client_id, competitionId: data.competition_id };
}
async function reachCompetition(context: any, competitionId: string) {
  const sb = await admin();
  const clientId = await clientOfCompetition(sb, competitionId);
  await assertReach(context.supabase, context.userId, clientId);
  return { sb, clientId };
}
async function reachAssessment(context: any, id: string) {
  const sb = await admin();
  const ids = await clientOfAssessment(sb, id);
  await assertReach(context.supabase, context.userId, ids.clientId);
  return { sb, ...ids };
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const kgNum = z.number().min(20).max(1500);
const OBJECTIVES = [
  "win",
  "podium",
  "qualify",
  "record",
  "pb_total",
  "first_meet",
  "return",
  "experience",
] as const;
const LEVELS = ["international", "national", "regional", "provincial", "local"] as const;

const fields = z.object({
  name: z.string().trim().min(1).max(160),
  meet_date: date,
  meet_end_date: date.nullable().optional(),
  federation: z.string().trim().max(80).nullable().optional(),
  division: z.string().trim().max(80).nullable().optional(),
  weight_class: z.string().trim().max(20).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  level: z.enum(LEVELS).nullable().optional(),
  objective: z.enum(OBJECTIVES).nullable().optional(),
  objective_note: z.string().trim().max(2000).nullable().optional(),
  target_total_kg: kgNum.nullable().optional(),
  target_place: z.number().int().min(1).max(50).nullable().optional(),
  qualification_total_kg: kgNum.nullable().optional(),
  records_note: z.string().trim().max(1000).nullable().optional(),
  athlete_goal_total_kg: kgNum.nullable().optional(),
  registration: z.enum(["registered", "not_registered", "unknown"]).optional(),
  lifting_start: hhmm.nullable().optional(),
  weigh_in_at: hhmm.nullable().optional(),
  flight: z.string().trim().max(40).nullable().optional(),
  session_label: z.string().trim().max(40).nullable().optional(),
  equipment_event: z.string().trim().max(100).nullable().optional(),
  weigh_in_kg: z.number().min(25).max(300).nullable().optional(),
  release_policy: z.enum(["approve_all", "auto_routine"]).optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
});

/* ------------------------------------------------------------------ */
/* The tab                                                            */

export const getCompetitionWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: uuid, competitionId: uuid.nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { loadWorkspace } = await import("./workspace.server");
    return loadWorkspace(await admin(), data.clientId, data.competitionId ?? null);
  });

/** Lightweight shared event calendar for plan builders. No assessments or AI calls. */
export const getPlanEventsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<Array<{ id: string; name: string; meet_date: string; status: string; is_primary: boolean }>> => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const sb = await admin();
    const { data: rows, error } = await sb
      .from("competitions")
      .select("id,name,meet_date,status,is_primary")
      .eq("client_id", data.clientId)
      .in("status", ["upcoming", "completed"])
      .or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")
      .order("meet_date", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Every competition that needs the coach, read with the caller's own login (RLS: their clients). */
export const getCompetitionOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadOverview } = await import("./workspace.server");
    return loadOverview((context as any).supabase, null);
  });

export const createCompetitionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: uuid,
        prepId: uuid.nullable().optional(),
        source: z.enum(["coach", "prep", "plan", "profile"]).default("coach"),
        fields,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const sb = await admin();
    const { rulesFor } = await import("./rules");
    const { levelFromName } = await import("./workspace.server");
    const { data: primary } = await sb
      .from("competitions")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("status", "upcoming")
      .or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")
      .eq("is_primary", true)
      .limit(1);
    const f = data.fields;
    const { data: row, error } = await sb
      .from("competitions")
      .insert({
        ...f,
        client_id: data.clientId,
        prep_id: data.prepId ?? null,
        level: f.level ?? levelFromName(f.name, f.federation),
        rules: f.rules ?? rulesFor(f.federation),
        is_primary: !primary?.length,
        source: data.source,
        created_by: context.userId,
        schedule_dirty: true,
      })
      .select("id")
      .single();
    if (error)
      throw new Error(
        error.message.includes("competitions_one_per_prep")
          ? "That meet prep already has a competition"
          : error.message,
      );
    const { applySchedule } = await import("./worker.server");
    const { logEvent } = await import("./release.server");
    await logEvent(sb, {
      competitionId: row.id,
      clientId: data.clientId,
      actorId: context.userId,
      actor: "coach",
      action: "created",
      detail: { source: data.source },
    });
    await applySchedule(sb, row.id);
    return { id: row.id };
  });

export const updateCompetitionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ competitionId: uuid, fields: fields.partial() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    const { data: before } = await sb
      .from("competitions")
      .select("*")
      .eq("id", data.competitionId)
      .maybeSingle();
    const patch: Record<string, unknown> = { ...data.fields };
    if (patch.rules) {
      const { readRules } = await import("./rules");
      patch.rules = readRules(patch.rules, (patch.federation as string) ?? before?.federation);
    }
    const { error } = await sb.from("competitions").update(patch).eq("id", data.competitionId);
    if (error) throw new Error(error.message);
    const changed = Object.keys(data.fields).filter(
      (k) =>
        JSON.stringify((before as any)?.[k] ?? null) !==
        JSON.stringify((data.fields as any)[k] ?? null),
    );
    const { logEvent } = await import("./release.server");
    if (changed.length)
      await logEvent(sb, {
        competitionId: data.competitionId,
        clientId,
        actorId: context.userId,
        actor: "coach",
        action: "edited",
        detail: {
          fields: changed,
          before: Object.fromEntries(changed.map((k) => [k, (before as any)?.[k] ?? null])),
        },
      });
    const { applySchedule } = await import("./worker.server");
    await applySchedule(sb, data.competitionId);
    return { ok: true };
  });

export const setCompetitionStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        status: z.enum(["upcoming", "completed", "cancelled", "archived"]).optional(),
        primary: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    if (data.primary) {
      await sb
        .from("competitions")
        .update({ is_primary: false })
        .eq("client_id", clientId)
        .eq("is_primary", true);
      await sb.from("competitions").update({ is_primary: true }).eq("id", data.competitionId);
    }
    if (data.status) {
      const { error } = await sb
        .from("competitions")
        .update({
          status: data.status,
          ...(data.status !== "upcoming" ? { is_primary: false } : {}),
        })
        .eq("id", data.competitionId);
      if (error) throw new Error(error.message);
      const { applySchedule } = await import("./worker.server");
      await applySchedule(sb, data.competitionId);
    }
    const { logEvent } = await import("./release.server");
    await logEvent(sb, {
      competitionId: data.competitionId,
      clientId,
      actorId: context.userId,
      actor: "coach",
      action: data.status ? `status_${data.status}` : "set_primary",
    });
    return { ok: true };
  });

/** Run the current phase's assessment now (the schedule does it by itself; this is for "do it now"). */
export const runMilestoneNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        kind: z
          .enum([
            "recon",
            "foundation",
            "intel",
            "forecast",
            "game_plan",
            "confirm",
            "update",
            "debrief",
          ])
          .nullable()
          .optional(),
        instructions: z.string().trim().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    const { todayWinnipeg } = await import("./load.server");
    const { currentMilestone, daysBetween } = await import("./milestones");
    const { data: comp } = await sb
      .from("competitions")
      .select("meet_date")
      .eq("id", data.competitionId)
      .maybeSingle();
    const today = todayWinnipeg();
    const kind =
      data.kind ?? currentMilestone(daysBetween(today, String(comp?.meet_date))) ?? "debrief";
    const { data: had } = await sb
      .from("competition_milestones")
      .select("id, status, seq")
      .eq("competition_id", data.competitionId)
      .eq("kind", kind)
      .order("seq", { ascending: false })
      .limit(1);
    if (had?.[0] && (had[0].status === "generating" || had[0].status === "waiting_ai"))
      return { id: had[0].id, already: true };
    let id: string;
    if (had?.[0] && kind !== "update") {
      await sb
        .from("competition_milestones")
        .update({
          status: "scheduled",
          due_on: today,
          attempts: 0,
          progress: null,
          last_error: null,
          instructions: data.instructions ?? null,
          why: "Run now by the coach",
        })
        .eq("id", had[0].id);
      id = had[0].id;
    } else {
      const seq = kind === "update" ? (had?.[0]?.seq ?? 0) + 1 : 0;
      const { data: row, error } = await sb
        .from("competition_milestones")
        .insert({
          competition_id: data.competitionId,
          client_id: clientId,
          kind,
          seq,
          due_on: today,
          status: "scheduled",
          instructions: data.instructions ?? null,
          why: "Run now by the coach",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = row.id;
    }
    const { logEvent } = await import("./release.server");
    await logEvent(sb, {
      competitionId: data.competitionId,
      clientId,
      actorId: context.userId,
      actor: "coach",
      action: "run_now",
      detail: { kind },
    });
    return { id, already: false };
  });

/* ------------------------------------------------------------------ */
/* Assessments                                                        */

export const getAssessmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ assessmentId: uuid, markOpened: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachAssessment(context, data.assessmentId);
    const { markOpened } = await import("./release.server");
    const row = data.markOpened
      ? await markOpened(sb, data.assessmentId, context.userId)
      : (await sb.from("competition_assessments").select("*").eq("id", data.assessmentId).maybeSingle()).data;
    if (!row) return row;
    const { data: competition } = await sb
      .from("competitions")
      .select("id, name, meet_date, weight_class, internal_test")
      .eq("id", row.competition_id)
      .maybeSingle();
    return { ...row, competition_context: competition ?? null };
  });

export const assessmentActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        assessmentId: uuid,
        action: z.enum(["review", "request_changes", "approve", "release", "approve_release"]),
        note: z.string().trim().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachAssessment(context, data.assessmentId);
    const r = await import("./release.server");
    if (data.action === "review") await r.markReviewed(sb, data.assessmentId, context.userId);
    else if (data.action === "request_changes")
      await r.requestChanges(sb, data.assessmentId, context.userId, data.note ?? null);
    else if (data.action === "approve") await r.approve(sb, data.assessmentId, context.userId);
    else {
      if (data.action === "approve_release") await r.approve(sb, data.assessmentId, context.userId);
      await r.release(sb, data.assessmentId, { userId: context.userId, kind: "approved" });
    }
    return { ok: true };
  });

/** Where the competition's assessments being written stand (light: polled while one is in flight). */
export const getRewriteProgressFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb } = await reachCompetition(context, data.competitionId);
    const { loadRewrites } = await import("./rewrite.server");
    return loadRewrites(sb, data.competitionId);
  });

/** Start a stopped rewrite again now, keeping what Cleo already finished. */
export const retryRewriteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid, milestoneId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb } = await reachCompetition(context, data.competitionId);
    const { data: m } = await sb
      .from("competition_milestones")
      .select("competition_id")
      .eq("id", data.milestoneId)
      .maybeSingle();
    if (!m || m.competition_id !== data.competitionId) throw new Error("That isn't this competition's");
    const { retryRewrite } = await import("./rewrite.server");
    return retryRewrite(sb, data.milestoneId, context.userId);
  });

export const editAthleteVersionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        assessmentId: uuid,
        title: z.string().trim().min(1).max(120).optional(),
        summary: z.string().trim().max(2000).optional(),
        focus: z.array(z.string().trim().max(300)).max(6).optional(),
        expectations: z.array(z.string().trim().max(300)).max(6).optional(),
        message: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachAssessment(context, data.assessmentId);
    const { editAthleteVersion } = await import("./release.server");
    const { assessmentId, ...patch } = data;
    await editAthleteVersion(sb, assessmentId, context.userId, patch);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* The field                                                          */

const competitorFields = z.object({
  name: z.string().trim().min(2).max(120),
  sex: z.enum(["M", "F"]).nullable().optional(),
  weight_class: z.string().trim().max(20).nullable().optional(),
  federation: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  instagram: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._]{1,30}$/)
    .nullable()
    .optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  bodyweight_kg: z.number().min(25).max(300).nullable().optional(),
});

export const addCompetitorsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        competitors: z
          .array(
            competitorFields.extend({ oplUrl: z.string().trim().max(300).nullable().optional() }),
          )
          .min(1)
          .max(60),
        source: z.enum(["manual", "roster"]).default("manual"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    const { data: comp } = await sb
      .from("competitions")
      .select("federation, weight_class")
      .eq("id", data.competitionId)
      .maybeSingle();
    const { syncCompetitor, linkCompetitorProfile } = await import("./opl.server");
    const { todayWinnipeg } = await import("./load.server");
    const added: Array<{ id: string; name: string; identity: string }> = [];
    const budget = { left: Math.min(30, 6 * data.competitors.length) };
    for (const c of data.competitors) {
      const { oplUrl, ...rest } = c;
      const { data: row, error } = await sb
        .from("competition_competitors")
        .insert({
          ...rest,
          instagram: rest.instagram?.replace(/^@/, "") ?? null,
          federation: rest.federation ?? comp?.federation ?? null,
          weight_class: rest.weight_class ?? comp?.weight_class ?? null,
          competition_id: data.competitionId,
          client_id: clientId,
          source: data.source,
          created_by: context.userId,
        })
        .select("id, name")
        .single();
      if (error) {
        if (/competition_competitors_name/.test(error.message)) continue;
        throw new Error(error.message);
      }
      let identity = "unverified";
      try {
        if (oplUrl)
          identity = (await linkCompetitorProfile(sb, row.id, oplUrl)).error
            ? "unverified"
            : "manual";
        else if (budget.left > 0)
          identity = (await syncCompetitor(sb, row.id, { today: todayWinnipeg(), budget })).status;
      } catch (e) {
        console.warn("[competition] competitor lookup failed", (e as Error)?.message);
      }
      added.push({ id: row.id, name: row.name, identity });
    }
    const { logEvent } = await import("./release.server");
    await logEvent(sb, {
      competitionId: data.competitionId,
      clientId,
      actorId: context.userId,
      actor: "coach",
      action: "competitors_added",
      detail: { count: added.length, source: data.source },
    });
    return { added };
  });

export const updateCompetitorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitorId: uuid,
        fields: competitorFields.partial().optional(),
        oplUrl: z.string().trim().max(300).nullable().optional(),
        archive: z.boolean().optional(),
        resync: z.boolean().optional(),
        /** the coach's read of a suggested entrant: on the start list, likely, or not coming (archive) */
        status: z.enum(["suggested", "confirmed", "registered"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: c } = await sb
      .from("competition_competitors")
      .select("client_id, competition_id")
      .eq("id", data.competitorId)
      .maybeSingle();
    if (!c) throw new Error("Competitor not found");
    await assertReach(context.supabase, context.userId, c.client_id);
    if (data.fields) {
      const { error } = await sb
        .from("competition_competitors")
        .update({
          ...data.fields,
          ...(data.fields.instagram !== undefined
            ? { instagram: data.fields.instagram?.replace(/^@/, "") ?? null }
            : {}),
        })
        .eq("id", data.competitorId);
      if (error) throw new Error(error.message);
    }
    if (data.archive)
      await sb
        .from("competition_competitors")
        .update({ archived: true })
        .eq("id", data.competitorId);
    if (data.status)
      await sb
        .from("competition_competitors")
        .update({ field_status: data.status })
        .eq("id", data.competitorId);
    let result: any = null;
    if (data.oplUrl) {
      const { linkCompetitorProfile } = await import("./opl.server");
      result = await linkCompetitorProfile(sb, data.competitorId, data.oplUrl);
      if (result.error) throw new Error(result.error);
    } else if (data.resync) {
      const { syncCompetitor } = await import("./opl.server");
      const { todayWinnipeg } = await import("./load.server");
      result = await syncCompetitor(sb, data.competitorId, { today: todayWinnipeg() });
    }
    return { ok: true, result };
  });

const observation = z.object({
  date,
  lift: z.enum(["squat", "bench", "deadlift"]).nullable(),
  exercise: z.string().trim().min(1).max(80),
  loadKg: z.number().min(1).max(600),
  reps: z.number().int().min(1).max(30),
  rpe: z.number().min(5).max(10).nullable(),
  standard: z.enum(["competition", "variation", "unclear"]),
  equipment: z.string().trim().max(60).nullable(),
  source: z.enum(["instagram", "video", "screenshot", "link", "manual", "caption"]),
  url: z.string().trim().url().max(500).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().trim().max(200).nullable(),
});

/** Saves the observations the coach confirmed (from a caption, a screenshot or by hand). */
export const saveObservationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitorId: uuid,
        add: z.array(observation).max(30).default([]),
        removeIds: z.array(z.string().max(40)).max(60).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: c } = await sb
      .from("competition_competitors")
      .select("client_id, observations")
      .eq("id", data.competitorId)
      .maybeSingle();
    if (!c) throw new Error("Competitor not found");
    await assertReach(context.supabase, context.userId, c.client_id);
    const kept = (Array.isArray(c.observations) ? c.observations : []).filter(
      (o: any) => !data.removeIds.includes(o.id),
    );
    const added = data.add.map((o) => ({
      ...o,
      id: crypto.randomUUID(),
      added_at: new Date().toISOString(),
      added_by: context.userId,
    }));
    await sb
      .from("competition_competitors")
      .update({ observations: [...kept, ...added].slice(-120) })
      .eq("id", data.competitorId);
    return { ok: true, count: kept.length + added.length };
  });

/** A caption, a screenshot, a roster: read into rows for the coach to confirm (nothing is saved here). */
export const extractCompetitionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        kind: z.enum(["roster", "training", "meet_info"]),
        text: z.string().max(40_000).nullable(),
        image: z
          .object({
            mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
            base64: z.string().max(7_000_000),
          })
          .nullable(),
        url: z.string().trim().url().max(500).nullable().optional(),
      })
      .refine((x) => !!x.text?.trim() || !!x.image, "Paste the text or add a picture")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachCompetition(context, data.competitionId);
    const { extractRoster, extractTraining, extractMeetInfo } = await import("./extract.server");
    const { todayWinnipeg } = await import("./load.server");
    if (data.kind === "meet_info")
      return {
        roster: [],
        lifts: [],
        meet: await extractMeetInfo(sb, { text: data.text?.trim() || null, file: data.image }),
      };
    if (data.kind === "roster")
      return {
        roster: await extractRoster(sb, { text: data.text?.trim() || null, image: data.image }),
        lifts: [],
      };
    return {
      roster: [],
      lifts: await extractTraining(sb, {
        text: data.text?.trim() || null,
        image: data.image,
        today: todayWinnipeg(),
        url: data.url ?? null,
      }),
    };
  });

/* ------------------------------------------------------------------ */
/* Resources                                                          */

export const addResourceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        kind: z.enum([
          "link",
          "note",
          "document",
          "roster",
          "rules",
          "schedule",
          "caption",
          "screenshot",
        ]),
        title: z.string().trim().min(1).max(200),
        url: z
          .string()
          .trim()
          .url()
          .max(2000)
          .regex(/^https?:\/\//i)
          .nullable()
          .optional(),
        body: z.string().max(50_000).nullable().optional(),
        documentId: uuid.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    const { data: row, error } = await sb
      .from("competition_resources")
      .insert({
        competition_id: data.competitionId,
        client_id: clientId,
        kind: data.kind,
        title: data.title,
        url: data.url ?? null,
        body: data.body ?? null,
        document_id: data.documentId ?? null,
        added_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const removeResourceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ resourceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: r } = await sb
      .from("competition_resources")
      .select("client_id")
      .eq("id", data.resourceId)
      .maybeSingle();
    if (!r) return { ok: true };
    await assertReach(context.supabase, context.userId, r.client_id);
    await sb.from("competition_resources").delete().eq("id", data.resourceId);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Meet day                                                           */

export const getMeetDayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    const [{ data: comp }, { data: log }, { data: field }, { data: plan }, { data: client }] =
      await Promise.all([
        sb.from("competitions").select("*").eq("id", data.competitionId).maybeSingle(),
        sb
          .from("competition_meet_log")
          .select(
            "id, entrant, lift, attempt, kg, result, rpe, velocity, note, source, logged_at, updated_at, client_key",
          )
          .eq("competition_id", data.competitionId)
          .order("logged_at"),
        sb
          .from("competition_competitors")
          .select("id, name, bodyweight_kg, meets, identity")
          .eq("competition_id", data.competitionId)
          .eq("archived", false)
          .order("created_at"),
        sb
          .from("competition_assessments")
          .select("id, kind, version, status, internal, athlete, approved_at, released_at")
          .eq("competition_id", data.competitionId)
          .in("kind", ["confirm", "game_plan"])
          .neq("status", "superseded")
          .order("created_at", { ascending: false })
          .limit(4),
        sb
          .from("clients")
          .select("full_name, first_name, preferred_name")
          .eq("id", clientId)
          .maybeSingle(),
      ]);
    const { readRules } = await import("./rules");
    const confirmed =
      (plan ?? []).find((p: any) => p.approved_at || p.released_at) ?? (plan ?? [])[0] ?? null;
    const brief = confirmed?.internal?.engine ?? null;
    // the field's projections from the plan, for the standings before they lift
    return {
      competition: { ...comp, rules: readRules(comp?.rules, comp?.federation) },
      athlete: client?.preferred_name || client?.first_name || client?.full_name || "Athlete",
      log: log ?? [],
      field: (field ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        bodyweight: f.bodyweight_kg ?? null,
        projection: brief?.competitors?.find((x: any) => x.id === f.id)?.read?.projection ?? null,
      })),
      plan: confirmed
        ? {
            id: confirmed.id,
            kind: confirmed.kind,
            version: confirmed.version,
            confirmed: !!(confirmed.approved_at || confirmed.released_at),
            attempts: brief?.attempts ?? null,
            warmups: brief?.warmups ?? null,
            gameDay: brief?.gameDay ?? null,
            forecast: brief?.forecast ?? null,
            objective: comp?.objective ?? null,
          }
        : null,
      serverTime: new Date().toISOString(),
    };
  });

export const logAttemptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        entrant: z.string().min(2).max(40),
        lift: z.enum(["squat", "bench", "deadlift"]),
        attempt: z.number().int().min(1).max(4),
        kg: z.number().min(0).max(600).nullable(),
        result: z.enum(["good", "no_lift", "pending"]),
        rpe: z.number().min(1).max(10).nullable().optional(),
        velocity: z.number().min(0).max(3).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        clientKey: z.string().max(80).nullable().optional(),
        bodyweight: z.number().min(25).max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    if (data.entrant !== "us" && !/^[0-9a-f-]{36}$/i.test(data.entrant))
      throw new Error("Unknown lifter");
    const row = {
      competition_id: data.competitionId,
      client_id: clientId,
      entrant: data.entrant,
      lift: data.lift,
      attempt: data.attempt,
      kg: data.kg,
      result: data.result,
      rpe: data.rpe ?? null,
      velocity: data.velocity ?? null,
      note: data.note ?? null,
      client_key: data.clientKey ?? null,
      logged_by: context.userId,
      source: "manual",
    };
    // the same attempt is one row: a re-send from a phone that lost signal updates it
    const { error } = await sb
      .from("competition_meet_log")
      .upsert(row, { onConflict: "competition_id,entrant,lift,attempt" });
    if (error) throw new Error(error.message);
    if (data.bodyweight != null) {
      if (data.entrant === "us")
        await sb
          .from("competitions")
          .update({ weigh_in_kg: data.bodyweight })
          .eq("id", data.competitionId);
      else
        await sb
          .from("competition_competitors")
          .update({ bodyweight_kg: data.bodyweight })
          .eq("id", data.entrant);
    }
    return { ok: true };
  });

/** The meet's results (typed, or taken from the meet-day log), which schedules the debrief. */
export const saveResultsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        fromLog: z.boolean().default(false),
        results: z
          .object({
            squat: z.number().min(0).max(600).nullable(),
            bench: z.number().min(0).max(600).nullable(),
            deadlift: z.number().min(0).max(600).nullable(),
            place: z.string().max(10).nullable(),
            bodyweight: z.number().min(25).max(300).nullable(),
          })
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, clientId } = await reachCompetition(context, data.competitionId);
    let results: any = null;
    if (data.fromLog) {
      const { data: log } = await sb
        .from("competition_meet_log")
        .select("entrant, lift, attempt, kg, result")
        .eq("competition_id", data.competitionId);
      const { data: comp } = await sb
        .from("competitions")
        .select("weigh_in_kg")
        .eq("id", data.competitionId)
        .maybeSingle();
      const { resultsFromLog } = await import("./debrief");
      results = resultsFromLog((log ?? []) as any, comp?.weigh_in_kg ?? null);
      if (!results) throw new Error("Nothing logged for the athlete yet");
    } else if (data.results) {
      const r = data.results;
      const total = r.squat && r.bench && r.deadlift ? r.squat + r.bench + r.deadlift : null;
      results = { ...r, total, attempts: null, source: "manual" };
    } else throw new Error("No results");
    await sb
      .from("competitions")
      .update({
        results,
        results_at: new Date().toISOString(),
        status: "completed",
        is_primary: false,
      })
      .eq("id", data.competitionId);
    const { logEvent } = await import("./release.server");
    await logEvent(sb, {
      competitionId: data.competitionId,
      clientId,
      actorId: context.userId,
      actor: "coach",
      action: "results_saved",
      detail: { source: results.source, total: results.total },
    });
    const { applySchedule } = await import("./worker.server");
    await applySchedule(sb, data.competitionId);
    return { ok: true, results };
  });

/* ------------------------------------------------------------------ */
/* The athlete                                                        */

/** The athlete's client id: their own (or, staff previewing, the client asked for). */
async function athleteClient(
  context: any,
  clientId: string | null | undefined,
): Promise<{ clientId: string; self: boolean }> {
  if (clientId) {
    const { data: own } = await context.supabase
      .from("clients")
      .select("id, user_id")
      .eq("id", clientId)
      .maybeSingle();
    if (own?.user_id === context.userId) return { clientId, self: true };
    await assertReach(context.supabase, context.userId, clientId);
    return { clientId, self: false };
  }
  const { data } = await context.supabase
    .from("clients")
    .select("id")
    .eq("user_id", context.userId)
    .limit(1);
  if (!data?.[0]) throw new Error("No athlete account");
  return { clientId: data[0].id, self: true };
}

export const getMyCompetitionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid.nullable().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { clientId } = await athleteClient(context, data.clientId);
    const sb = await admin();
    const { data: comps } = await sb
      .from("competitions")
      .select(
        "id, name, meet_date, meet_end_date, location, federation, weight_class, division, status, is_primary, results, lifting_start, weigh_in_at, flight, session_label, equipment_event",
      )
      .eq("client_id", clientId)
      .in("status", ["upcoming", "completed"])
      .or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")
      .order("meet_date", { ascending: false })
      .limit(20);
    const ids = (comps ?? []).map((c: any) => c.id);
    const { data: released } = ids.length
      ? await sb
          .from("competition_assessments")
          .select(
            "id, competition_id, kind, version, athlete, released_at, release_kind, athlete_opened_at, athlete_acknowledged_at, superseded_at",
          )
          .in("competition_id", ids)
          .not("released_at", "is", null)
          .order("released_at", { ascending: false })
      : { data: [] };
    const { needsAcknowledgment, currentPlanId } = await import("./lifecycle");
    // the plan is from their own coach: said by name ("From Jared"), never "your coach"
    const { data: me } = await sb
      .from("clients")
      .select("assigned_coach_id")
      .eq("id", clientId)
      .maybeSingle();
    const { data: coachRow } = (me as any)?.assigned_coach_id
      ? await sb
          .from("coaches")
          .select("first_name, full_name, name")
          .eq("id", (me as any).assigned_coach_id)
          .maybeSingle()
      : { data: null };
    const coach =
      String(
        (coachRow as any)?.first_name ||
          String((coachRow as any)?.full_name || (coachRow as any)?.name || "").split(" ")[0] ||
          "",
      ).trim() || null;
    return {
      coach,
      competitions: (comps ?? []).map((c: any) => {
        const mine = (released ?? []).filter((a: any) => a.competition_id === c.id);
        return {
          ...c,
          currentPlanId: currentPlanId(mine),
          updates: mine.map((a: any) => ({
            id: a.id,
            kind: a.kind,
            version: a.version,
            athlete: a.athlete,
            releasedAt: a.released_at,
            automated: a.release_kind === "automated",
            openedAt: a.athlete_opened_at,
            acknowledgedAt: a.athlete_acknowledged_at,
            superseded: !!a.superseded_at,
            needsAck: needsAcknowledgment(a.kind),
          })),
        };
      }),
    };
  });

export const markMyUpdateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ assessmentId: uuid, what: z.enum(["opened", "acknowledged"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // the athlete's own login only: a coach previewing never opens or acknowledges for them
    const { data: mine } = await (context as any).supabase
      .from("clients")
      .select("id")
      .eq("user_id", context.userId)
      .limit(5);
    const sb = await admin();
    const { data: a } = await sb
      .from("competition_assessments")
      .select("client_id")
      .eq("id", data.assessmentId)
      .maybeSingle();
    if (!a || !(mine ?? []).some((c: any) => c.id === a.client_id)) return { ok: false };
    const { athleteMark } = await import("./release.server");
    await athleteMark(sb, data.assessmentId, a.client_id, context.userId, data.what);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Cleo's calls and the research                                       */

/** Keep one of Cleo's checked calls, or put it back to the engine's number, before release. */
export const decideProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        assessmentId: uuid,
        proposalId: z.string().regex(/^P\d{1,2}$/),
        use: z.enum(["cleo", "engine"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachAssessment(context, data.assessmentId);
    const { decideProposal } = await import("./release.server");
    return decideProposal(sb, data.assessmentId, context.userId, data.proposalId, data.use);
  });

/** Find the likely field from OpenPowerlifting's rankings now (the daily read does it by itself). */
export const discoverFieldFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb } = await reachCompetition(context, data.competitionId);
    const { discoverField } = await import("./research.server");
    return discoverField(sb, data.competitionId, { actorId: context.userId });
  });

/** A public link read by the server into rows for the coach to confirm (nothing is saved here). */
export const readLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitionId: uuid,
        url: z.string().trim().url().max(2000),
        kind: z.enum(["roster", "training", "meet_info"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb } = await reachCompetition(context, data.competitionId);
    const { readLink } = await import("./research.server");
    const page = await readLink(data.url);
    if (!page.ok) return { ok: false as const, error: page.error };
    const { extractRoster, extractTraining, extractMeetInfo } = await import("./extract.server");
    const { todayWinnipeg } = await import("./load.server");
    const text = page.kind === "text" ? page.text : null;
    const file =
      page.kind === "pdf"
        ? { mime: "application/pdf" as const, base64: page.base64, pdf: true as const }
        : null;
    const base = { ok: true as const, url: page.url, title: page.title, pdf: page.kind === "pdf" };
    if (data.kind === "roster")
      return {
        ...base,
        roster: await extractRoster(sb, { text, image: file }),
        lifts: [],
        meet: null,
      };
    if (data.kind === "training")
      return {
        ...base,
        roster: [],
        lifts: await extractTraining(sb, {
          text,
          image: file,
          today: todayWinnipeg(),
          url: page.url,
        }),
        meet: null,
      };
    return { ...base, roster: [], lifts: [], meet: await extractMeetInfo(sb, { text, file }) };
  });
