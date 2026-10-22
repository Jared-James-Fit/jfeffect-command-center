import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Book the rest" on a client's Sessions tab: the sessions they still have
 * credits for, on their usual days and times (see session-prebook.ts). Admin
 * only (it reads the coach's Google Calendar). Booking re-plans on the server
 * and books only planned days the coach kept ticked.
 */
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r: any) => r.role === "admin")) throw new Error("Only an admin can book the rest");
}

const Client = z.object({ client_id: z.string().uuid() });

export const previewSessionPrebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Client.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewPrebook } = await import("@/lib/session-prebook.server");
    return previewPrebook({ admin: supabaseAdmin as any, staff: supabase }, data.client_id);
  });

export const applySessionPrebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Client.extend({ dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyPrebook } = await import("@/lib/session-prebook.server");
    return applyPrebook({ admin: supabaseAdmin as any, staff: supabase }, data.client_id, data.dates);
  });
