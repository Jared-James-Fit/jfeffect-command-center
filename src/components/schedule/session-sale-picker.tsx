import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { listSessionSaleProducts, sellSessions } from "@/lib/session-sale.functions";
import { money, parseDollars, saleQuote, type SaleProduct, type SaleQuote } from "@/lib/session-sale";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { PlusTax } from "@/components/billing/plus-tax";

/** What the coach picked to charge, before the booking is saved. */
export type SaleDraft = {
  on: boolean;
  /** A product, or null for a typed price. */
  productId: string | null;
  /** The typed price per session, as typed ("30", "$100"). */
  custom: string;
  /** Post the payment card in the client's chat. */
  send: boolean;
  /** The coach changed something, so loading defaults leaves it alone. */
  touched: boolean;
};

export const EMPTY_SALE: SaleDraft = { on: false, productId: null, custom: "", send: true, touched: false };

export function useSaleProducts(enabled: boolean) {
  const listFn = useServerFn(listSessionSaleProducts);
  return useQuery<SaleProduct[]>({
    queryKey: ["session-sale-products"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => ((await listFn()) as any).products ?? [],
  });
}

export function quoteFor(draft: SaleDraft, count: number, products: SaleProduct[], title?: string): SaleQuote | null {
  if (!draft.on) return null;
  return saleQuote({ productId: draft.productId, customCents: draft.productId ? null : parseDollars(draft.custom) }, count, products, title);
}

/**
 * "Charge for it" on a booking: one tap on a product the coach made (a single
 * session, a pack) or a typed price, and whether the link goes in the chat.
 */
export function SessionSalePicker({
  value, onChange, products, loading, count, first, title, hint,
}: {
  value: SaleDraft;
  onChange: (d: SaleDraft) => void;
  products: SaleProduct[];
  loading?: boolean;
  count: number;
  first: string;
  title?: string;
  /** Under the switch while it's off (what happens to the credit without a sale). */
  hint?: string;
}) {
  const set = (patch: Partial<SaleDraft>) => onChange({ ...value, ...patch, touched: true });
  const quote = quoteFor(value, count, products, title);
  const typed = value.productId === null && value.custom.trim() !== "";
  const who = first || "them";

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3" data-session-sale>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="flex items-center gap-1.5 text-sm font-semibold">
            <CreditCard className="h-4 w-4 text-primary" /> Charge for it
          </Label>
          <p className="text-[11px] text-muted-foreground">
            {value.on
              ? `Booked now, paid or not. ${who === "them" ? "They pay" : `${who} pays`} by a secure Stripe link.`
              : hint ?? "Sell this session: a product or your own price."}
          </p>
        </div>
        <Switch checked={value.on} onCheckedChange={(on) => set({ on })} aria-label="Charge for it" />
      </div>

      {value.on && (
        <>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What to charge">
            {products.map((p) => (
              <Chip key={p.id} selected={value.productId === p.id} onClick={() => set({ productId: p.id })}>
                {p.name} <span className="font-bold">{money(p.price_cents, p.currency)}</span><PlusTax />
              </Chip>
            ))}
            <Chip selected={value.productId === null} onClick={() => set({ productId: null })}>Custom price</Chip>
            {loading && !products.length && <span className="self-center text-[11px] text-muted-foreground">Loading products…</span>}
          </div>

          {value.productId === null && (
            <div className="flex items-center gap-2">
              <div className="relative w-36">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground">$</span>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={value.custom}
                  onChange={(e) => set({ custom: e.target.value.replace(/[^\d.,$]/g, "").slice(0, 10) })}
                  className="h-11 pl-7 text-base"
                  aria-label="Price per session"
                />
              </div>
              <span className="text-xs text-muted-foreground">{count > 1 ? "per session" : "for the session"} + tax</span>
            </div>
          )}

          <p className={cn("text-xs", quote ? "text-foreground" : typed ? "text-destructive" : "text-muted-foreground")}>
            {quote
              ? <>
                  <strong>{money(quote.totalCents)}</strong> + tax · {quote.sessions} session{quote.sessions === 1 ? "" : "s"}
                  {quote.sessions > count ? ` (${count} booked, the rest to book)` : ""}
                  {quote.uncovered > 0 ? ` · covers ${count - quote.uncovered} of ${count}; the rest show as owed` : ""}
                </>
              : typed ? "Type a price between $0.50 and $10,000" : "Pick a product or type a price"}
          </p>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2">
            <Label className="text-xs">Send the payment link in {first ? `${first}'s` : "their"} chat</Label>
            <Switch checked={value.send} onCheckedChange={(send) => set({ send })} />
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        selected ? "border-primary bg-primary/15 text-foreground" : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Sells the sessions just booked and says how it went. Never throws: the
 * booking stands whatever happens, and a failed sale offers Try again.
 */
export async function runSessionSale(
  sellFn: (a: { data: any }) => Promise<any>,
  qc: QueryClient,
  args: { clientId: string; sessionIds: string[]; draft: SaleDraft; first: string },
): Promise<void> {
  const { clientId, sessionIds, draft, first } = args;
  const customCents = draft.productId ? null : parseDollars(draft.custom);
  const attempt = async () => {
    try {
      const res = await sellFn({
        data: {
          clientId, sessionIds, productId: draft.productId, customCents,
          origin: window.location.origin, sendInChat: draft.send,
        },
      });
      if (res?.messageId) {
        void import("@/lib/push/events.functions")
          .then(({ notifyNewMessage }) => notifyNewMessage({ data: { messageId: res.messageId } }))
          .catch(() => {});
      }
      invalidatePtSessionCaches(qc, clientId);
      qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
      qc.invalidateQueries({ queryKey: ["messages"] });
      const price = money(res.totalCents ?? 0);
      if (res?.linkError) {
        toast.warning(`Booked and sold (${price}), but the link didn't go out`, {
          description: `${res.linkError} Share it from their Billing tab.`,
        });
      } else if (res?.messageId) {
        toast.success(`Booked · ${price} link sent in ${first ? `${first}'s` : "their"} chat`, {
          description: "It shows Paid there once Stripe confirms.",
        });
      } else {
        if (res?.url) {
          try { await navigator.clipboard.writeText(res.url); } catch { /* copy is a bonus */ }
        }
        toast.success(`Booked · ${price} link ${res?.url ? "copied" : "made"}`, {
          description: draft.send ? "Their payment card was already in the chat." : "Paste it wherever you're talking to them.",
        });
      }
    } catch (e: any) {
      toast.error("Booked, but the sale didn't go through", {
        description: e?.message ?? "Try again.",
        action: { label: "Try again", onClick: () => { void attempt(); } },
        duration: 15_000,
      });
    }
  };
  await attempt();
}

export function useSellSessions() {
  return useServerFn(sellSessions);
}
