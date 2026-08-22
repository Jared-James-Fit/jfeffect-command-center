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
