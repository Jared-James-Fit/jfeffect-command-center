/**
 * The Training tab's plan quality (Nov 24 2026): the client's current program
 * scored by program-quality.ts. Checks that the signed-in staff member reaches
 * the client (the admin, or their own coach) before the service role reads
 * anything; it only reads.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { QualityScore } from "@/lib/plan-quality";

export const getProgramQualityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ quality: QualityScore | null; blockId: string | null; pending?: { at: string; count: number } | null }> => {
    const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
    await assertStaffReachesClient(context.supabase, context.userId, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { programQualityFor } = await import("@/lib/program-quality.server");
    return programQualityFor(supabaseAdmin, data.clientId);
  });
