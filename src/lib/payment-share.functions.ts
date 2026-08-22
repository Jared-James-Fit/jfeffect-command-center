import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveShareLinkForPurchase } from "@/lib/payment-share.server";

const Input = z.object({ purchaseRecordId: z.string().uuid() });

/**
 * Read-only resolver: returns the canonical shareable Stripe URL for a purchase.
 * Never creates a charge, invoice, subscription, customer or ledger row.
 */
export const resolvePaymentShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    return resolveShareLinkForPurchase(supabase, userId, data.purchaseRecordId);
  });

const MintInput = z.object({
  purchaseRecordId: z.string().uuid(),
  origin: z.string().url(),
});

/**
 * Returns the client-facing share URL for a purchase.
 * For client-specific Stripe Checkout Sessions this is a SHORT JF Effect URL
 * (https://…/pay/<token>) so iMessage treats it as a single clickable link.
 * Read-only: never creates a charge, subscription, invoice or ledger row.
 */
export const createPaymentShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MintInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { mintShareLinkForPurchase } = await import("@/lib/payment-share.server");
    return mintShareLinkForPurchase(supabase, userId, data.purchaseRecordId, data.origin);
  });
