import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolvePaymentShareLink } from "@/lib/payment-share.functions";
import { createCheckoutSessionForAssignment } from "@/lib/stripe-checkout.functions";
import { sanitizeShareUrl, shareKindLabel } from "@/lib/payment-share-link";
import { share as nativeShare, canShare } from "@/platform/share";

/**
 * Resolves the canonical shareable Stripe URL for a purchase.
 * Never charges: it reads Stripe, and only creates a fresh Checkout Session
 * through the existing server-side assignment flow when the stored one is stale.
 */
export async function getShareablePaymentUrl(
  resolveFn: (a: { data: { purchaseRecordId: string } }) => Promise<any>,
  checkoutFn: (a: { data: { purchaseRecordId: string; discountCodeId: null; origin: string } }) => Promise<any>,
  purchaseId: string,
): Promise<{ url: string; kind: string }> {
  const res = await resolveFn({ data: { purchaseRecordId: purchaseId } });
  if (res.kind === "none") throw new Error(res.reason ?? "No payment link needed for this purchase.");
  if (!res.needsFreshCheckout) {
    const clean = sanitizeShareUrl(res.url);
    if (!clean) throw new Error("Stripe returned an unusable link. Try again.");
    return { url: clean, kind: res.kind };
  }
  const fresh = await checkoutFn({
    data: { purchaseRecordId: purchaseId, discountCodeId: null, origin: window.location.origin },
  });
  const clean = sanitizeShareUrl(fresh?.url);
  if (!clean) throw new Error("Stripe did not return a checkout URL.");
  return { url: clean, kind: "checkout_session" };
}

export function CopyPaymentLinkButton({
  purchaseId,
  size = "sm",
  variant = "outline",
  className,
  label = "Copy payment link",
}: {
  purchaseId: string;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  label?: string;
}) {
  const resolveFn = useServerFn(resolvePaymentShareLink);
  const checkoutFn = useServerFn(createCheckoutSessionForAssignment);
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const run = async (mode: "copy" | "share") => {
    setBusy(true);
    const t = toast.loading("Getting payment link…");
    try {
      const { url, kind } = await getShareablePaymentUrl(resolveFn as any, checkoutFn as any, purchaseId);
      setLastUrl(url);
      if (mode === "share" && canShare({ url })) {
        const result = await nativeShare({ url, title: "Payment link" });
        if (result === "shared") {
          toast.success("Payment link shared", { id: t });
          return;
        }
      }
      await navigator.clipboard.writeText(url);
      toast.success("Payment link copied", { id: t, description: shareKindLabel(kind as any) });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not get a payment link", { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size={size} variant={variant} disabled={busy} onClick={() => void run("copy")}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Working…" : label}
        </Button>
        <Button type="button" size={size} variant="ghost" disabled={busy} onClick={() => void run("share")}>
          <Share2 className="mr-1.5 h-3.5 w-3.5" />Share
        </Button>
        {lastUrl && (
          <a href={lastUrl} target="_blank" rel="noreferrer">
            <Button type="button" size={size} variant="ghost">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open link
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
