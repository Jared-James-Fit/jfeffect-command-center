import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Goal & Performance Intelligence, the coach's side (docs/GOAL_INTELLIGENCE.md).
 * Every call checks the signed-in staff member reaches the client through their
 * own login (assertStaffReachesClient: the admin, or the client's own coach),
 * then works with the service role; the database's sync triggers keep the
 * competition, bodyweight and long-term goal fields in step. Nothing here
 * changes a program or a plan: a programming recommendation hands its words to
 * Adjust program, which shows and applies it. The only message is the client
 * update, which waits out the review window in the outbox.
 */

const uuid = z.string().uuid();
const unit = z.enum(["kg", "lb"]);
const approach = z.enum(["easy", "conservative", "moderate", "high", "very_aggressive", "extreme"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const caller = (context: unknown) => context as { supabase: any; userId: string };

async function reach(context: unknown, clientId: string) {
  const { supabase, userId } = caller(context);
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { sb: supabaseAdmin as any, userId };
}

async function reachGoal(context: unknown, goalId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { clientIdOfGoal } = await import("./goals.server");
  const clientId = await clientIdOfGoal(supabaseAdmin as any, goalId);
  return { ...(await reach(context, clientId)), clientId };
}

/** One client's goals (read again when an hour old), the waiting update and recent history. */
export const getClientGoalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid, refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb } = await reach(context, data.clientId);
    const { goalsView } = await import("./goals.server");
    return goalsView(sb, data.clientId, { refresh: data.refresh });
  });

const decision = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    value: z.number().positive().max(3000).nullable().optional(),
    unit: unit.nullable().optional(),
    approach: approach.nullable().optional(),
    deadline: day.nullable().optional(),
    text: z.string().trim().max(600).nullable().optional(),
    clientFacing: z.boolean().nullable().optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("client_facing"), clientFacing: z.boolean() }),
  z.object({ action: z.literal("result"), result: z.enum(["achieved", "missed"]), actualValue: z.number().positive().max(3000).nullable().optional(), unit: unit.nullable().optional() }),
]);

/** Approve (as said, an approach, or edited), dismiss, close, or record how it went. */
export const decideGoalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ goalId: uuid, decision }).parse(d))
  .handler(async ({ data, context }) => {
    const { sb, userId } = await reachGoal(context, data.goalId);
    const { decideGoal } = await import("./goals.server");
    return decideGoal(sb, data.goalId, data.decision as any, { userId, kind: "coach" });
  });

/** A goal the coach sets directly: approved at once. */
export const addGoalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: uuid,
        kind: z.enum(["lift", "total", "bodyweight", "physique", "performance", "event"]),
        lift: z.enum(["squat", "bench", "deadlift"]).nullable().optional(),
        value: z.number().positive().max(3000).nullable().optional(),
        unit: unit.nullable().optional(),
        deadline: day.nullable().optional(),
        competitionId: uuid.nullable().optional(),
        text: z.string().trim().max(600).nullable().optional(),
        clientFacing: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, userId } = await reach(context, data.clientId);
    const { addGoal } = await import("./goals.server");
    return addGoal(sb, data.clientId, data, { userId, kind: "coach" });
  });

/** Approve, dismiss, or keep the plan on Cleo's recommendation. */
export const decideGoalRecommendationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ goalId: uuid, action: z.enum(["approve", "dismiss", "maintain"]), value: z.number().positive().max(3000).nullable().optional(), unit: unit.nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, userId } = await reachGoal(context, data.goalId);
    const { decideRecommendation } = await import("./goals.server");
    return decideRecommendation(sb, data.goalId, data, { userId, kind: "coach" });
  });

/** The waiting client update: edit, hold, resume, cancel or send now. */
export const goalUpdateActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        outboxId: uuid,
        clientId: uuid,
        action: z.discriminatedUnion("action", [
          z.object({ action: z.literal("edit"), body: z.string().max(2000) }),
          z.object({ action: z.literal("hold") }),
          z.object({ action: z.literal("resume") }),
          z.object({ action: z.literal("cancel") }),
          z.object({ action: z.literal("send_now") }),
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sb, userId } = await reach(context, data.clientId);
    const { data: o } = await sb.from("client_update_outbox").select("client_id").eq("id", data.outboxId).maybeSingle();
    if (!o || o.client_id !== data.clientId) throw new Error("That update wasn't found.");
    const { outboxAction } = await import("./goals.server");
    return outboxAction(sb, data.outboxId, data.action as any, { userId, kind: "coach" });
  });

/** The review window and automatic sending (the admin). */
export const setGoalUpdateSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reviewMinutes: z.number().int().min(5).max(1440), autoSend: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = caller(context);
    const { data: admin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!admin) throw new Error("Only the admin can change this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("app_settings").upsert({ key: "goal_updates", value: { review_minutes: data.reviewMinutes, auto_send: data.autoSend } }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Read a meeting's analysis for goals now (after the coach adds or re-reads one). */
export const extractMeetingGoalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await (supabaseAdmin as any).from("coaching_sessions").select("client_id").eq("id", data.sessionId).maybeSingle();
    if (!s) throw new Error("That meeting wasn't found.");
    const { sb } = await reach(context, s.client_id);
    const { extractFromMeeting, assessClient } = await import("./goals.server");
    const r = await extractFromMeeting(sb, data.sessionId);
    await assessClient(sb, s.client_id, { force: true }).catch(() => null);
    return r;
  });
