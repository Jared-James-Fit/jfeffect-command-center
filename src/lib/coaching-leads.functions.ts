/**
 * The coach's Leads (coaching-leads.ts): every application with its AI read
 * and texts, the unfinished ones, and the few things the coach does from a
 * lead (copy, mark texted, follow up, call booked, not a fit, write again).
 * Admin only; the AI itself only ever runs in the background
 * (coaching-leads.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminView } from "@/lib/permissions.server";
import { LEAD_INSTRUCTIONS_MAX, type LeadApplication, type LeadDraft, type LeadReplyRow } from "@/lib/coaching-leads";

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type LeadsList = {
  leads: Array<{ app: LeadApplication; reply: LeadReplyRow | null }>;
  drafts: LeadDraft[];
  bookingUrl: string | null;
};

export const listLeadsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadsList> => {
    await assertAdminView(context as any);
    const sb = await admin();
    const { LEAD_APP_COLUMNS, leadBookingUrl } = await import("@/lib/coaching-leads.server");
    const [{ data: apps, error }, { data: drafts }, bookingUrl] = await Promise.all([
      sb
        .from("coaching_applications")
        .select(LEAD_APP_COLUMNS)
        .or("is_test.is.null,is_test.eq.false")
        .order("created_at", { ascending: false })
        .limit(60),
      sb
        .from("coaching_application_drafts")
        .select("id, full_name, main_goal, target_outcome, email, phone, instagram, step, updated_at, created_at")
        .is("submitted_at", null)
        .is("dismissed_at", null)
        .gte("updated_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order("updated_at", { ascending: false })
        .limit(20),
      leadBookingUrl(sb, null),
    ]);
    if (error) throw new Error(error.message);
    const list = (apps ?? []) as LeadApplication[];
    const { data: replies } = list.length
      ? await sb
          .from("coaching_lead_replies")
          .select("application_id, status, brief, reply, follow_up, instructions, error, attempts, generated_at, copied_at, updated_at")
          .in("application_id", list.map((a) => a.id))
      : { data: [] };
    const byId = new Map(((replies ?? []) as LeadReplyRow[]).map((r) => [r.application_id, r]));
    // A draft whose person applied after all isn't unfinished (same email or phone).
    const key = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase().replace(/[^\da-z@.]/g, "");
    const applied = new Set(list.flatMap((a) => [key(a.email), key(a.phone)]).filter(Boolean));
    return {
      leads: list.map((app) => ({ app, reply: byId.get(app.id) ?? null })),
      drafts: ((drafts ?? []) as any[]).filter((d) => !applied.has(key(d.email)) && !applied.has(key(d.phone))) as LeadDraft[],
      bookingUrl,
    };
  });

/** Write (or rewrite, with the coach's note) a lead's read and texts, in the background. */
export const queueLeadReplyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ applicationId: z.string().uuid(), instructions: z.string().trim().max(LEAD_INSTRUCTIONS_MAX).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { error } = await sb.from("coaching_lead_replies").upsert(
      {
        application_id: data.applicationId,
        status: "pending",
        attempts: 0,
        error: null,
        instructions: data.instructions || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "application_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ACTIONS = ["copied", "texted", "followed_up", "booked", "not_a_fit", "reopen"] as const;
export type LeadAction = (typeof ACTIONS)[number];
/** Follow up a day after the first text if they haven't booked. */
export const FOLLOW_UP_AFTER_MS = 24 * 60 * 60_000;

export const markLeadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), action: z.enum(ACTIONS) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const now = new Date();
    if (data.action === "copied") {
      await sb.from("coaching_lead_replies").update({ copied_at: now.toISOString() }).eq("application_id", data.applicationId);
      return { ok: true };
    }
    const patch: Record<string, unknown> =
      data.action === "texted"
        ? { status: "Contacted", follow_up_at: new Date(now.getTime() + FOLLOW_UP_AFTER_MS).toISOString() }
        : data.action === "followed_up"
          ? { status: "Contacted", follow_up_at: null }
          : data.action === "booked"
            ? { call_status: "booked", follow_up_at: null }
            : data.action === "not_a_fit"
              ? { status: "Rejected", follow_up_at: null }
              : { status: "New", call_status: "not_booked", follow_up_at: null };
    const { error } = await sb
      .from("coaching_applications")
      .update({ ...patch, updated_at: now.toISOString() })
      .eq("id", data.applicationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
