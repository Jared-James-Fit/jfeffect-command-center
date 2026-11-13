/**
 * AI credits for the app: where someone's credits stand, buying a pack
 * through Stripe, adding a pack's credits when they come back from paying,
 * and the admin's settings. The rules live in the database
 * (20270313090000_ai_credits.sql) and src/lib/ai-credits/.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CreditDetail, CreditState } from "@/lib/ai-credits/packs";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admins only.");
}

/**
 * The signed-in person's credits, or, while a coach views as a client
 * (`viewAsUserId`), that client's (the database checks the coach may).
 */
export const getAiCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ viewAsUserId: z.string().uuid().nullish() })
      .partial()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<CreditDetail> => {
    const { supabase, userId } = context as any;
    const other = data.viewAsUserId && data.viewAsUserId !== userId ? data.viewAsUserId : null;
    const { data: out, error } = other
      ? await (supabase as any).rpc("ai_credits_for_user", { _user: other })
      : await (supabase as any).rpc("ai_credits_mine");
    if (error) throw new Error(error.message);
    return out as CreditDetail;
  });

/** Start buying a pack: a Stripe Checkout link. Credits are added when it's paid. */
export const startAiCreditsCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        pack: z.enum(["p100", "p300", "p1000"]),
        origin: z.string().url(),
        returnPath: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context as any;
    const { creditStateFor } = await import("@/lib/ai-credits/meter.server");
    const state = await creditStateFor(userId);
    if (state?.unlimited) throw new Error("Staff accounts have unlimited AI credits.");
    const { createCreditsCheckout } = await import("@/lib/ai-credits/stripe.server");
    return createCreditsCheckout({
      userId,
      email: typeof claims?.email === "string" ? claims.email : null,
      packKey: data.pack,
      origin: data.origin,
      returnPath: data.returnPath ?? "/portal/account",
    });
  });

/** Back from Stripe: add the pack's credits now (the webhook does it too; whichever comes first counts, once). */
export const confirmAiCreditsCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z
          .string()
          .min(8)
          .max(255)
          .regex(/^cs_[A-Za-z0-9_]+$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { confirmCreditsSession } = await import("@/lib/ai-credits/stripe.server");
    const r = await confirmCreditsSession(data.sessionId, userId);
    return {
      added: r.added,
      duplicate: r.duplicate,
      pending: r.pending,
      credits: r.credits,
      state: r.state as CreditState | null,
    };
  });

// ---------------------------------------------------------------- admin

export const getAiCreditsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().int().min(1).max(366).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: out, error } = await ((context as any).supabase as any).rpc(
      "ai_credits_overview",
      { _days: data.days ?? 30 },
    );
    if (error) throw new Error(error.message);
    return out as any;
  });

export const setAiCreditAllowances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        member: z.number().int().min(0).max(100000),
        coaching: z.number().int().min(0).max(100000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: out, error } = await ((context as any).supabase as any).rpc(
      "ai_credits_set_allowances",
      { _member: data.member, _coaching: data.coaching },
    );
    if (error) throw new Error(error.message);
    return out as { allowances: { member: number; coaching: number } };
  });

export const grantAiCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        credits: z.number().int().min(-100000).max(100000),
        note: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.credits === 0) throw new Error("Pick a number of credits.");
    const { data: out, error } = await ((context as any).supabase as any).rpc(
      "ai_credits_admin_grant",
      {
        _user: data.userId,
        _credits: data.credits,
        _note: data.note ?? null,
      },
    );
    if (error) throw new Error(error.message);
    return out as CreditState;
  });

/** Admin: people with a login, by name, to give credits to. */
export const searchAiCreditPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().min(2).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const q = data.q.replace(/[%_,()]/g, " ").trim();
    const { data: rows, error } = await ((context as any).supabase as any)
      .from("clients")
      .select("user_id, full_name, service_tier")
      .not("user_id", "is", null)
      .ilike("full_name", `%${q}%`)
      .order("full_name")
      .limit(8);
    if (error) throw new Error(error.message);
    return (
      (rows ?? []) as Array<{
        user_id: string;
        full_name: string | null;
        service_tier: string | null;
      }>
    ).map((r) => ({
      userId: r.user_id,
      name: r.full_name ?? "Unnamed",
      tier: r.service_tier === "coaching" ? "Coaching client" : "Member",
    }));
  });
