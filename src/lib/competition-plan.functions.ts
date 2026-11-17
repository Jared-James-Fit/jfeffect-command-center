import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The coach's backstop: a competition form that was submitted but has no
 * plan yet (the athlete's phone closed before it said so) gets one when the
 * coach opens it. Staff only: the caller's own login must be able to read
 * the submission (RLS: admins and the client's own coach) and must be staff.
 */
export const ensureCompetitionPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const [{ data: a }, { data: c }, { data: sub }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
      supabase.from("nf_submissions").select("id").eq("id", data.submissionId).maybeSingle(),
    ]);
    if ((!a && !c) || !sub) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordCompetitionPlan } = await import("@/lib/competition-plan.server");
    return recordCompetitionPlan(supabaseAdmin as any, data.submissionId);
  });
