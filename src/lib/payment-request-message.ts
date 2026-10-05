/**
 * The personal chat message that goes out automatically when a coach/admin
 * assigns a product to a client. Pure so the copy is testable.
 */

export type PaymentRequestMessageInput = {
  clientFirstName?: string | null;
  offerName?: string | null;
  amount?: number | null;
  currency?: string | null;
  paymentStructure?: string | null;
  paymentFrequency?: string | null;
  isRecurring?: boolean | null;
  url: string;
};

/** "/month", "every 2 weeks", "/week", "/year", or null for one-time. */
export function billingCadence(i: Pick<PaymentRequestMessageInput, "paymentStructure" | "paymentFrequency" | "isRecurring">): string | null {
  const text = `${i.paymentFrequency ?? ""} ${i.paymentStructure ?? ""}`.toLowerCase();
  if (/one[- ]?time|paid in full|pay in full/.test(text) && !i.isRecurring) return null;
  if (/bi-?weekly|every 2 weeks/.test(text)) return " every 2 weeks";
  if (/week/.test(text)) return "/week";
  if (/year|annual/.test(text)) return "/year";
  if (i.isRecurring || /month|subscription|recurring/.test(text)) return "/month";
  return null;
}

export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount ?? 0);
  const whole = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = (currency ?? "CAD").toUpperCase();
  return cur === "CAD" || cur === "USD" ? `$${whole}` : `${whole} ${cur}`;
}

export function buildPaymentRequestMessage(i: PaymentRequestMessageInput): string {
  const first = (i.clientFirstName ?? "").trim().split(/\s+/)[0];
  const hey = first ? `Hey ${first}! 👋` : "Hey! 👋";
  const product = (i.offerName ?? "").trim() || "coaching";
  const cadence = billingCadence(i);
  const price = Number(i.amount ?? 0) > 0 ? `${formatMoney(i.amount, i.currency)}${cadence ?? ""} + applicable tax` : null;

  const lines = [
    `${hey} Your ${product} is all set up and ready to go.`,
    "",
    cadence
      ? `Here's your secure link to start your subscription${price ? ` (${price})` : ""}:`
      : `Here's your secure link to complete your payment${price ? ` (${price})` : ""}:`,
    "",
    i.url,
    "",
    "Takes about a minute. Once that's done you're all set!! 💪",
  ];
  return lines.join("\n");
}

/**
 * Client-side: post the auto message for a just-assigned product and push
 * the client. Never throws — the sale/link must not fail because of chat.
 */
export async function autoMessageClientAboutPurchase(
  sendFn: (args: { data: { purchaseId: string } }) => Promise<any>,
  purchaseId: string,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const r = await sendFn({ data: { purchaseId } });
    if (r?.sent && r.messageId) {
      void import("@/lib/push/events.functions")
        .then(({ notifyNewMessage }) => notifyNewMessage({ data: { messageId: r.messageId } }))
        .catch(() => {});
    }
    return { sent: !!r?.sent, reason: r?.reason };
  } catch (e: any) {
    return { sent: false, reason: e?.message ?? "failed" };
  }
}
