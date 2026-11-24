/**
 * The Cardio tab's and the check-in card's server functions (Nov 23 2026).
 * Every one checks that the signed-in staff member reaches the client (the
 * admin, or the client's own coach) before the service role reads or writes
 * anything; Cleo runs on the OpenAI key only. Nothing here changes a live plan
 * except publishCardioPlanFn, which is the coach's own Publish.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CardioProposal, CardioWorkspaceView, PublishResult, RecommendationRow } from "@/lib/cardio/types";
import type { QualityScore } from "@/lib/plan-quality";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertReach(supabase: any, userId: string, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sessions = z.array(z.record(z.string(), z.unknown())).max(14);

export const getCardioWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<CardioWorkspaceView> => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
    return loadCardioWorkspace(await admin(), data.clientId);
  });

export const saveCardioDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: uuid, sessions, effectiveDate: date.nullable(), note: z.string().max(1000).nullable(), baseHash: z.string().max(40).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { saveCardioDraft } = await import("@/lib/cardio/publish.server");
    return saveCardioDraft(await admin(), { ...data, userId: context.userId });
  });

export const discardCardioDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { discardCardioDraft } = await import("@/lib/cardio/publish.server");
    return discardCardioDraft(await admin(), data.clientId);
  });

export const publishCardioPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: uuid,
        sessions,
        effectiveDate: date.nullable(),
        note: z.string().max(1000).nullable(),
        source: z.enum(["coach", "cleo", "restore", "recommendation"]),
        restoredFrom: uuid.nullable(),
        baseHash: z.string().max(40).nullable(),
        quality: z.object({ score: z.number().nullable(), confidence: z.string().max(20) }).nullable(),
        notify: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<PublishResult> => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { publishCardioPlan } = await import("@/lib/cardio/publish.server");
    return publishCardioPlan(await admin(), { ...data, userId: context.userId });
  });

export const restoreCardioVersionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid, versionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { restoreVersionToDraft } = await import("@/lib/cardio/publish.server");
    return restoreVersionToDraft(await admin(), { ...data, userId: context.userId });
  });

export const askCardioCleoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: uuid, instructions: z.string().trim().min(3, "Say what you'd like").max(2000), draft: sessions, scope: z.string().max(200).nullable() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CardioProposal> => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { askCardioCleo } = await import("@/lib/cardio/cleo.server");
    return askCardioCleo(await admin(), { ...data, userId: context.userId });
  });

export const decideCardioProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid, id: uuid, status: z.enum(["applied", "dismissed"]), note: z.string().max(1000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { decideCardioProposal } = await import("@/lib/cardio/cleo.server");
    return decideCardioProposal(await admin(), { ...data, userId: context.userId });
  });

/* ------------------------------------------------------------------ */
/* The check-in's coordinated recommendation                           */

async function recommendationClient(id: string): Promise<string | null> {
  const { data } = await (await admin()).from("client_coaching_recommendations").select("client_id").eq("id", id).maybeSingle();
  return (data?.client_id as string | null) ?? null;
}

export const getCheckinRecommendationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ checkinId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<RecommendationRow | null> => {
    const sb = await admin();
    const { data: c } = await sb.from("messenger_checkins").select("client_id").eq("id", data.checkinId).maybeSingle();
    if (!c) return null;
    await assertReach(context.supabase, context.userId, c.client_id);
    const { recommendationForCheckin } = await import("@/lib/coaching-recommendation/record.server");
    return recommendationForCheckin(sb, data.checkinId);
  });

export const decideRecommendationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, status: z.enum(["edited", "dismissed", "open"]), note: z.string().max(2000).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const clientId = await recommendationClient(data.id);
    if (!clientId) throw new Error("That recommendation wasn't found.");
    await assertReach(context.supabase, context.userId, clientId);
    const { decideRecommendation } = await import("@/lib/coaching-recommendation/record.server");
    return decideRecommendation(await admin(), { ...data, userId: context.userId });
  });

export const applyRecommendationItemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, index: z.number().int().min(0).max(5) }).parse(d))
  .handler(async ({ data, context }) => {
    const clientId = await recommendationClient(data.id);
    if (!clientId) throw new Error("That recommendation wasn't found.");
    await assertReach(context.supabase, context.userId, clientId);
    const { applyRecommendationItem } = await import("@/lib/coaching-recommendation/record.server");
    return applyRecommendationItem(await admin(), { ...data, userId: context.userId });
  });

/* ------------------------------------------------------------------ */
/* Nutrition plan quality                                              */

export const getNutritionQualityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<{ quality: QualityScore | null; planId: string | null }> => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { nutritionQualityFor } = await import("@/lib/nutrition-targets/plan-quality.server");
    return nutritionQualityFor(await admin(), data.clientId);
  });
