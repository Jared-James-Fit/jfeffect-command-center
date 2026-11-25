/**
 * Analytics (/admin/insights): one tab's read per call, admin only. The server checks the role
 * through the caller's own login (has_role, which also needs their two-step), then reads with the
 * service role: the analytics tables have no policies at all, so nobody else can read them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BI_TABS, type BiTab } from "./model";
import { businessDay, checkedRange } from "./period";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admins only.");
}

const Input = z.object({
  tab: z.enum(BI_TABS as unknown as [BiTab, ...BiTab[]]),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  fresh: z.boolean().optional(),
});

export const getBiTabFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof Input>) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const today = businessDay();
    const range = checkedRange(data.from, data.to, today);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadBiTab } = await import("./bi.server");
    const value = await loadBiTab(supabaseAdmin as any, data.tab, range, { fresh: !!data.fresh, today });
    return { tab: data.tab, range, today, generatedAt: new Date().toISOString(), data: value as any };
  });
