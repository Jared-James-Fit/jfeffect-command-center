/**
 * The public site's steps (site-funnel-rules.ts): one anonymous count per
 * step, and the admin's read of the coaching funnel.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clip } from "@/lib/apply-form";
import { SITE_EVENTS, cleanStep, readCoachingFunnel } from "@/lib/site-funnel-rules";

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse/i;

function coachDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function referrerHost(raw: string | null | undefined): string | null {
  try {
    const host = new URL(String(raw ?? "")).hostname.replace(/^www\./, "");
    return host ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

const optText = (max: number) =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => clip(v ?? "", max) || null);

const TrackInput = z.object({
  visitorId: z.string().uuid(),
  event: z.enum(SITE_EVENTS),
  step: z.string().max(80).optional().nullable(),
  device: z.enum(["phone", "tablet", "desktop"]).optional().nullable(),
  source: optText(80),
  referrer: z.string().max(500).optional().nullable(),
  utm_source: optText(120),
  utm_medium: optText(120),
  utm_campaign: optText(120),
});

/** Count one step (public, never waits on anything that matters, never errors). */
export const trackSiteFunnel = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TrackInput.parse(i))
  .handler(async ({ data }) => {
    if (BOT_UA.test(getRequestHeader("user-agent") ?? "")) return { ok: false };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as any)
        .from("membership_funnel_events")
        .upsert(
          {
            visitor_id: data.visitorId,
            event: data.event,
            step: cleanStep(data.step),
            day: coachDay(),
            device: data.device ?? null,
            source: data.source,
            referrer_host: referrerHost(data.referrer),
            utm_source: data.utm_source,
            utm_medium: data.utm_medium,
            utm_campaign: data.utm_campaign,
          },
          { onConflict: "visitor_id,event,step,day", ignoreDuplicates: true },
        )
        .then(
          () => null,
          () => null,
        );
    } catch {
      /* counting is never worth an error */
    }
    return { ok: true };
  });

/** The coaching funnel for the last N days (admins only). */
export const getCoachingFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: any; userId: string };
    const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Only an admin can see this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: raw, error } = await (supabaseAdmin as any).rpc("coaching_funnel", { _since: since });
    if (error) throw new Error("Couldn't read the funnel.");
    return { days: data.days, since, funnel: readCoachingFunnel(raw) };
  });
