import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The coach's New picture: a fresh made picture for a Saturday post, or for
 * Saturday's next library post (Crew → Posts). Staff only; see
 * post-pictures.server.ts.
 */
export const makePostPicture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ postId: z.string().uuid().optional(), itemId: z.string().uuid().optional() })
      .refine((v) => !!v.postId !== !!v.itemId, "A post or a library post")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) throw new Error("Not allowed");
    const { pictureForItem, pictureForPost } = await import("@/lib/post-pictures.server");
    return data.postId ? pictureForPost(supabaseAdmin as any, data.postId) : pictureForItem(supabaseAdmin as any, data.itemId!);
  });
