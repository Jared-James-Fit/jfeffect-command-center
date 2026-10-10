import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coach: have Cleo re-read a block now and rewrite her roadmap words (the
 * schedule tick does this on its own a couple of minutes after a change).
 * Never touches the coach's own wording.
 */
export const rewriteBlockRoadmap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ blockId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    // Read through the coach's own session: RLS decides whether it's theirs.
    const { data: block } = await supabase.from("pl_blocks").select("id, client_id").eq("id", data.blockId).maybeSingle();
    if (!block) throw new Error("Block not found.");
    const { canViewClient } = await import("@/lib/client-pov.server");
    if (!(await canViewClient(supabase, userId, block.client_id))) throw new Error("Only the athlete's coach can do this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshBlockRoadmap } = await import("@/lib/training-roadmap.server");
    const result = await refreshBlockRoadmap(supabaseAdmin as any, data.blockId, { force: true });
    await (supabaseAdmin as any).from("pl_roadmap_queue").delete().eq("block_id", data.blockId);
    return result;
  });
