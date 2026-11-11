import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Book ahead" on a client's Sessions tab: their next sessions on their usual
 * days and times, or the coach's own (see session-prebook.ts). Admin only (it
 * reads the coach's Google Calendar). Booking re-plans on the server with the
 * same count and days and books only planned days the coach kept ticked.
 */
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r: any) => r.role === "admin")) throw new Error("Only an admin can book the rest");
}

const Options = z.object({
  client_id: z.string().uuid(),
  count: z.number().int().min(0).max(200).nullish(),
  pattern: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }))
    .min(1)
    .max(7)
    .nullish(),
});

export const previewSessionPrebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Options.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewPrebook } = await import("@/lib/session-prebook.server");
    return previewPrebook({ admin: supabaseAdmin as any, staff: supabase }, data.client_id, { count: data.count, pattern: data.pattern });
  });

export const applySessionPrebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Options.extend({ dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyPrebook } = await import("@/lib/session-prebook.server");
    return applyPrebook({ admin: supabaseAdmin as any, staff: supabase }, data.client_id, data.dates, { count: data.count, pattern: data.pattern });
  });
