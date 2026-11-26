import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Browse = z.object({
  kind: z.enum(["gif", "sticker"]),
  q: z.string().max(80).default(""),
  page: z.number().int().min(1).max(50).default(1),
});

/** Trending (no q) or search, from the live provider. `available: false` = use the library. */
export const browseMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Browse.parse(i))
  .handler(async ({ data, context }) => {
    const { klipyBrowse } = await import("@/lib/media/media.server");
    return klipyBrowse({ kind: data.kind, q: data.q, page: data.page, userId: context.userId });
  });

const Share = z.object({
  kind: z.enum(["gif", "sticker"]),
  slug: z.string().min(1).max(200),
  q: z.string().max(80).default(""),
});

/** Fire-and-forget: tells the provider what was sent. */
export const registerMediaShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Share.parse(i))
  .handler(async ({ data, context }) => {
    const { klipyShare } = await import("@/lib/media/media.server");
    void klipyShare({ kind: data.kind, slug: data.slug, q: data.q, userId: context.userId });
    return { ok: true };
  });
