import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const submitSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional(),
  goals: z.string().max(2000).optional(),
  training_history: z.string().max(2000).optional(),
  schedule: z.string().max(1000).optional(),
  budget_range: z.string().max(80).optional(),
  timeline: z.string().max(80).optional(),
});

/** Public: submit a coaching application from /coaching/apply. */
export const submitCoachingApplication = createServerFn({ method: "POST" })
  .inputValidator((i: z.infer<typeof submitSchema>) => submitSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("coaching_applications").insert({
      ...data,
      source: "coaching_page",
      status: "New",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

export const listCoachingApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coaching_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const updateCoachingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status?: string; notes_admin?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["New","Contacted","Approved","Rejected"]).optional(),
      notes_admin: z.string().max(4000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...rest } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("coaching_applications").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });