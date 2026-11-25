/**
 * Crew promos (placement.ts has the rules): what the signed-in person may be
 * shown, counting what they see, tap and dismiss, and the admin's campaigns.
 * Every read and write goes through the caller's own login (RLS and the
 * SECURITY DEFINER functions decide), never the service role.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Promo } from "./placement";

export const getMyPromos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ promos: Promo[]; shownToday: number }> => {
    const { supabase } = context as any;
    const { data, error } = await supabase.rpc("crew_promos_for_me");
    if (error || !data) return { promos: [], shownToday: 0 };
    const list = Array.isArray(data.campaigns) ? data.campaigns : [];
    return {
      promos: list.map((c: any) => ({ id: String(c.id), headline: String(c.headline), body: c.body ?? null, cta_label: String(c.cta_label), cta_path: String(c.cta_path) })),
      shownToday: Number(data.shown_today ?? 0) || 0,
    };
  });

export const trackPromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ campaignId: z.string().uuid(), event: z.enum(["impression", "click", "dismiss"]), session: z.string().max(64) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    await supabase.rpc("crew_promo_track", { _campaign: data.campaignId, _event: data.event, _session: data.session });
    return { ok: true };
  });

export type PromoCampaign = {
  id: string;
  name: string;
  headline: string;
  body: string | null;
  cta_label: string;
  cta_path: string;
  suppress_for: string[];
  status: "draft" | "active" | "paused" | "ended";
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  stats: { impressions: number; people: number; clicks: number; dismissals: number };
};

/** Admin: every campaign with its numbers (RLS and crew_promo_stats() answer only the admin). */
export const listPromoCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCampaign[]> => {
    const { supabase } = context as any;
    const [{ data: rows, error }, { data: stats }] = await Promise.all([
      supabase.from("crew_ad_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.rpc("crew_promo_stats"),
    ]);
    if (error) throw new Error(error.message);
    const by = new Map(((stats ?? []) as any[]).map((s) => [s.campaign_id, s]));
    return ((rows ?? []) as any[]).map((r) => {
      const s = by.get(r.id) ?? {};
      return {
        ...r,
        suppress_for: r.suppress_for ?? [],
        stats: { impressions: Number(s.impressions ?? 0), people: Number(s.people ?? 0), clicks: Number(s.clicks ?? 0), dismissals: Number(s.dismissals ?? 0) },
      } as PromoCampaign;
    });
  });

const CampaignInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(2).max(80),
  body: z.string().trim().max(240).optional().default(""),
  cta_label: z.string().trim().min(2).max(30),
  cta_path: z.string().trim().regex(/^\/[A-Za-z0-9/_?=&.#-]*$/, "A link inside the app, starting with /").refine((p) => !p.startsWith("//"), "A link inside the app"),
  suppress_for: z.array(z.enum(["coaching", "premium"])).max(2).default([]),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
});

export const savePromoCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CampaignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const row = { name: data.name, headline: data.headline, body: data.body || null, cta_label: data.cta_label, cta_path: data.cta_path, suppress_for: data.suppress_for, status: data.status };
    const q = data.id
      ? supabase.from("crew_ad_campaigns").update(row).eq("id", data.id)
      : supabase.from("crew_ad_campaigns").insert({ ...row, created_by: userId });
    const { data: saved, error } = await q.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("Only the owner can change Crew promos.");
    return { id: saved.id as string };
  });
