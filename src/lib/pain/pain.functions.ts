/**
 * Server functions for pain: what the athlete's review needs (their recent
 * places, for "Same as Nov 16?", and the workout's exercises), the coach's
 * history of a client, the dashboard's list, and the reply the AI drafts for
 * the coach to approve. Nothing here sends anything to a client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPainHistory, areaSummary, type PainEntry } from "@/lib/pain/history";
import type { PainSession } from "@/lib/pain/sessions";

async function isStaffFor(supabase: any, userId: string, clientId: string): Promise<boolean> {
  const [{ data: isAdmin }, { data: isAssigned }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_assigned_coach_for_client", { _client_id: clientId }),
  ]);
  return !!isAdmin || !!isAssigned;
}

async function assertStaff(supabase: any, userId: string, clientId: string) {
  if (!(await isStaffFor(supabase, userId, clientId))) throw new Error("Only the client's coach or an admin can see this.");
}

/**
 * The review's pain step: the athlete's places from the last six weeks (so a
 * place that came up asks one question, not the whole form) and the workout's
 * exercises (for "which exercise?"). A coach previewing a client passes
 * `actAsClientId` and is checked like the review's own save.
 */
export const getPainReportContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      dayId: z.string().uuid().nullable().optional(),
      scheduledWorkoutId: z.string().uuid().nullable().optional(),
      actAsClientId: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    const { loadPainEntries, loadDayExercises, loadRecentExercises, todayIn } = await import("@/lib/pain/load");
    let clientId: string | null = null;
    if (data.actAsClientId) {
      await assertStaff(supabase, userId, data.actAsClientId);
      clientId = data.actAsClientId;
    } else {
      const { data: me } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
      clientId = me?.id ?? null;
    }
    const empty = { clientId: null as string | null, today: todayIn(null), entries: [] as PainEntry[], exercises: [] as { id: string | null; name: string }[], recentExercises: [] as { id: string | null; name: string }[], feedbackId: null as string | null };
    if (!clientId) return empty;
    const { data: client } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
    const tz = client?.timezone ?? null;
    // this workout's own review, if there is one: its places are the ones being edited
    let feedbackId: string | null = null;
    if (data.dayId) {
      let q = supabase.from("pl_day_completions").select("id");
      q = data.scheduledWorkoutId ? q.eq("scheduled_workout_id", data.scheduledWorkoutId) : q.eq("client_id", clientId).eq("day_id", data.dayId).is("scheduled_workout_id", null);
      const { data: comp } = await q.maybeSingle();
      if (comp?.id) {
        const { data: fb } = await supabase.from("pl_workout_feedback").select("id").eq("completion_id", comp.id).maybeSingle();
        feedbackId = fb?.id ?? null;
      }
    }
    const [byClient, exercises, recent] = await Promise.all([
      loadPainEntries(supabase, [clientId], { days: 45, tz: new Map([[clientId, tz]]) }),
      data.dayId ? loadDayExercises(supabase, data.dayId) : Promise.resolve([]),
      // the lifts of the last four weeks, for "my hack squat" on a day without one (never blocks the review)
      loadRecentExercises(supabase, clientId).catch(() => [] as { id: string | null; name: string }[]),
    ]);
    const today = new Set(exercises.map((x) => x.name.toLowerCase()));
    const recentExercises = recent.filter((x) => !today.has(x.name.toLowerCase()));
    return { clientId, today: todayIn(tz), entries: byClient.get(clientId) ?? [], exercises, recentExercises, feedbackId };
  });

/** Everything the coach's pain sheet shows for one client (the sheet works the history out with the same code). */
export const getClientPainFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    await assertStaff(supabase, userId, data.clientId);
    const { loadPainEntries, loadPainSessions, loadGivenSuggestions, todayIn } = await import("@/lib/pain/load");
    const { data: client } = await supabase.from("clients").select("id, full_name, preferred_name, timezone").eq("id", data.clientId).maybeSingle();
    if (!client) throw new Error("Client not found.");
    const tz = client.timezone ?? null;
    const [byClient, sessions, given] = await Promise.all([
      loadPainEntries(supabase, [client.id], { tz: new Map([[client.id, tz]]) }),
      loadPainSessions(supabase, client.id, tz).catch(() => [] as PainSession[]),
      loadGivenSuggestions(supabase, client.id),
    ]);
    return {
      clientId: client.id,
      name: (client.full_name ?? "").trim() || "Client",
      firstName: (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them",
      today: todayIn(tz),
      entries: byClient.get(client.id) ?? [],
      sessions,
      given: given.given,
      reviewedAt: given.reviewedAt,
      draft: given.draft,
    };
  });

export type PainWatchItem = {
  clientId: string;
  name: string;
  /** The places that want the coach, most pressing first. */
  areas: { region: string; label: string; summary: string; reasons: string[] }[];
  latestAt: string;
  redFlag: boolean;
};

/**
 * Home's "Pain to look at": coaching clients with a place that wants the coach
 * (history.ts `reasons`: a warning sign, severe, a stopped session, worse,
 * persistent, changing sessions, the same exercise each time) and a report
 * since the coach last looked. One-off and mild reports never make the list.
 */
export const listPainWatchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainWatchItem[]> => {
    const { userId } = context;
    const supabase = context.supabase as any;
    const [{ data: isAdmin }, { data: coached }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("coached_client_ids"),
    ]);
    let q = supabase.from("clients").select("id, full_name, timezone").eq("service_tier", "coaching").eq("archived", false).limit(500);
    if (!isAdmin) {
      const ids = ((coached ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.coached_client_ids ?? r?.id)).filter(Boolean);
      if (!ids.length) return [];
      q = q.in("id", ids);
    }
    const { data: clients } = await q;
    const list = (clients ?? []) as { id: string; full_name: string | null; timezone: string | null }[];
    if (!list.length) return [];
    const { loadPainEntries, todayIn } = await import("@/lib/pain/load");
    const tz = new Map(list.map((c) => [c.id, c.timezone]));
    const byClient = await loadPainEntries(supabase, list.map((c) => c.id), { tz });
    const withPain = list.filter((c) => (byClient.get(c.id) ?? []).length > 0);
    if (!withPain.length) return [];
    const { data: reviews } = await supabase
      .from("pain_coach_reviews")
      .select("client_id, kind, through_at, created_at")
      .in("client_id", withPain.map((c) => c.id))
      .in("kind", ["reviewed", "used"])
      .order("created_at", { ascending: false })
      .limit(1000);
    const reviewed = new Map<string, string>();
    for (const r of (reviews ?? []) as any[]) if (!reviewed.has(r.client_id)) reviewed.set(r.client_id, r.through_at ?? r.created_at);

    const out: PainWatchItem[] = [];
    for (const c of withPain) {
      const h = buildPainHistory(byClient.get(c.id) ?? [], todayIn(c.timezone));
      if (!h.flagged.length || !h.latestAt) continue;
      // looked at since the latest report: wait for something new
      const seen = reviewed.get(c.id);
      if (seen && seen >= h.latestAt) continue;
      out.push({
        clientId: c.id,
        name: (c.full_name ?? "").trim() || "Client",
        areas: h.flagged.slice(0, 3).map((a) => ({ region: a.region, label: a.label, summary: areaSummary(a), reasons: a.reasons })),
        latestAt: h.latestAt,
        redFlag: h.flagged.some((a) => a.reasons.includes("red_flag")),
      });
    }
    return out.sort((a, b) => Number(b.redFlag) - Number(a.redFlag) || b.latestAt.localeCompare(a.latestAt));
  });

/**
 * A reply about the client's pain for the coach to edit and send himself
 * (Assist: every coach and admin, for their own clients). Written by
 * pain-draft.server.ts; in the owner's own voice only for the owner. Kept as
 * a draft so opening the sheet again doesn't ask again until a new report.
 */
export const draftPainReplyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    await assertStaff(supabase, userId, data.clientId);
    const { assertCallerFeature, callerHasFeature } = await import("@/lib/cleo-capabilities.server");
    await assertCallerFeature(supabase, userId, "assist.message_drafts", "Drafts aren't part of your plan.");
    // the owner's own voice and examples are the owner's; anyone else gets a plain coach voice
    const voice = await callerHasFeature(supabase, userId, "owner.voice").catch(() => false);
    const { writePainDraft } = await import("@/lib/pain/pain-draft.server");
    const d = await writePainDraft(supabase, { clientId: data.clientId, voice, automatic: false });
    const { error } = await supabase.from("pain_coach_reviews").insert({
      client_id: data.clientId,
      kind: "draft",
      through_at: d.history.latestAt,
      regions: d.history.flagged.map((a) => a.region),
      suggestion_keys: d.used,
      draft: d.message,
      insights: d.insights,
      model: d.model,
      created_by: userId,
    });
    if (error) console.error("[pain] draft not kept", error.message);
    return { message: d.message, insights: d.insights, suggestionKeys: d.used, model: d.model, warnings: d.warnings, redFlags: d.redFlags };
  });
