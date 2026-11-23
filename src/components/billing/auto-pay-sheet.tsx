/**
 * Auto-pay on a client's Billing tab (admins): what's charging and on which
 * card, change it (a new amount, schedule or card goes to the client as a
 * setup link in their chat; the current auto-pay keeps going until they
 * finish), set one up where nothing collects a balance, or stop it. A change
 * still waiting shows above the plans with its link and Cancel. Nothing here
 * charges anyone. The rules are auto-pay.ts.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CreditCard, Link2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { billingDay } from "@/lib/date-range";
import { clientTaxRate } from "@/lib/client-billing-summary";
import type { ClientPayments } from "@/lib/payment-schedule";
import {
  autoPayOptions,
  changeProblem,
  changeSentence,
  EVERY_OPTIONS,
  everyWords,
  paceAmount,
  withTax,
  type Every,
} from "@/lib/auto-pay";
import { cancelAutoPayChange, getAutoPayCard, startAutoPayChange, stopAutoPay } from "@/lib/auto-pay.functions";
import { todayLocalISO } from "@/lib/today";

const dollars = (text: string) => {
  const v = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
};

export type PendingChange = {
  id: string;
  sale_id: string;
  each_cents: number;
  every: Every;
  first_charge_date: string | null;
  token: string;
  created_at: string;
  replaces_subscription_id: string | null;
};

export function usePendingAutoPay(clientId: string | undefined) {
  return useQuery({
    queryKey: ["auto-pay-changes", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("auto_pay_changes")
        .select("id, sale_id, each_cents, every, first_charge_date, token, created_at, replaces_subscription_id")
        .eq("client_id", clientId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      // A failed read is not "no setup link out": the coach would be offered a second one.
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as PendingChange | null;
    },
  });
}

const refreshKeys = (clientId: string) => [["client-billing", clientId], ["auto-pay-changes", clientId], ["client-purchases", clientId]];

/** "Waiting for them to set up auto-pay": the link, and Cancel. */
export function PendingAutoPayRow({ clientId, change, money, rate, labels, isAdmin }: {
  clientId: string;
  change: PendingChange;
  money: (c: number) => string;
  rate: number | null;
  labels: Map<string, string>;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const cancel = useServerFn(cancelAutoPayChange);
  const m = useMutation({
    mutationFn: () => cancel({ data: { changeId: change.id } }),
    onSuccess: () => {
      toast.success("Change cancelled. The link no longer works, and the current auto-pay carries on.");
      for (const k of refreshKeys(clientId)) qc.invalidateQueries({ queryKey: k });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't cancel it"),
  });
  const url = `https://jfeffect.com/autopay/${change.token}`;
  return (
    <div className="space-y-2 rounded-xl border border-warning/40 p-3" data-auto-pay-pending>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">New auto-pay waiting to be set up</div>
          <p className="text-[13px] text-muted-foreground">
            {money(withTax(change.each_cents, rate))} {everyWords(change.every)}
            {change.first_charge_date ? ` from ${billingDay(change.first_charge_date)}` : ""}, paying {labels.get(change.sale_id) ?? "their next package"} first. Sent {billingDay(change.created_at)}.
            {change.replaces_subscription_id ? " The current auto-pay keeps going until they finish it." : ""}
          </p>
        </div>
      </div>
      {isAdmin && (
        <div className="flex flex-wrap gap-2 pl-[18px]">
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(
                () => toast.success("Link copied"),
                () => toast.message(url),
              );
            }}
          >
            <Link2 className="mr-1.5 h-4 w-4" /> Copy link
          </Button>
          <Button size="sm" variant="ghost" className="h-9" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Cancelling…" : "Cancel change"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Change, set up or stop auto-pay. */
export function AutoPaySheet({ clientId, p, sales, open, onOpenChange, preferSaleId }: {
  clientId: string;
  p: ClientPayments;
  sales: any[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preferSaleId?: string | null;
}) {
  const qc = useQueryClient();
  const today = todayLocalISO();
  const rate = useMemo(() => clientTaxRate(sales as any), [sales]);
  const opts = useMemo(() => autoPayOptions({ p, sales, rate, today, preferSaleId }), [p, sales, rate, today, preferSaleId]);
  const current = opts.current;
  const money = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: p.currency || "CAD" }).format(c / 100);

  const [target, setTarget] = useState<string | null>(opts.target);
  const [every, setEvery] = useState<Every>(opts.every);
  const [amount, setAmount] = useState(opts.eachWithTaxCents > 0 ? (opts.eachWithTaxCents / 100).toFixed(2) : "");
  const [first, setFirst] = useState(opts.firstDate);
  const [stopping, setStopping] = useState(false);

  const cardFn = useServerFn(getAutoPayCard);
  const card = useQuery({
    queryKey: ["auto-pay-card", current?.saleId],
    enabled: open && !!current,
    staleTime: 5 * 60_000,
    queryFn: () => cardFn({ data: { saleId: current!.saleId } }),
  });

  const targetRow = opts.targets.find((t) => t.saleId === target) ?? null;
  const targetSale = sales.find((s) => s.id === target);
  const pace = targetRow && targetSale
    ? paceAmount({ totalWithTaxCents: withTax(Math.round(Number(targetSale.contract_value_cents ?? 0)), rate), from: targetSale.term_start_date, to: targetSale.term_end_date ?? targetSale.package_expiry_date, every })
    : null;
  const each = dollars(amount);
  const problem = changeProblem({ eachWithTaxCents: each, firstDate: first, today, target: targetRow });
  const sentence = targetRow && !problem ? changeSentence({ eachWithTaxCents: each, every, firstDate: first, today, target: targetRow, current, money }) : null;

  const start = useServerFn(startAutoPayChange);
  const send = useMutation({
    mutationFn: () => start({ data: { clientId, saleId: target!, eachWithTaxCents: each, every, firstDate: first } }),
    onSuccess: () => {
      toast.success("Setup link sent in their chat", { description: current ? "The current auto-pay keeps going until they finish it." : "Nothing is charged until the first payment date." });
      for (const k of refreshKeys(clientId)) qc.invalidateQueries({ queryKey: k });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send it"),
  });
  const stopFn = useServerFn(stopAutoPay);
  const stop = useMutation({
    mutationFn: (when: "now" | "period_end") => stopFn({ data: { saleId: current!.saleId, when } }),
    onSuccess: (_r, when) => {
      toast.success(when === "now" ? "Auto-pay stopped. Nothing more is charged." : "Auto-pay stops at the end of this period.");
      for (const k of refreshKeys(clientId)) qc.invalidateQueries({ queryKey: k });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Stripe didn't stop it. Try again."),
  });
  const busy = send.isPending || stop.isPending;

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="bottom" hideCloseButton onOpenAutoFocus={(e) => e.preventDefault()} className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-auto-pay-sheet>
        <SheetHeader className="min-h-0 shrink-0 space-y-1 px-5 pb-3 pt-5 text-left">
          <SheetTitle className="text-[18px]">{current ? "Auto-pay" : "Set up auto-pay"}</SheetTitle>
          <SheetDescription className="text-[14px]">
            {current
              ? "A new amount, schedule or card goes to them as a setup link in their chat. The current auto-pay keeps going until they finish it."
              : "They get a setup link in their chat. Nothing is charged until the first payment date."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          {current && (
            <div className="rounded-xl border border-border p-3" data-auto-pay-current>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold">{money(current.eachWithTaxCents)} {everyWords(current.every)}</span>
                <span className="text-[13px] text-muted-foreground">{current.ending ? "Ending" : current.failing ? "Failing" : "On"}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <CreditCard className="h-3.5 w-3.5" />
                {card.isLoading ? "Reading the card…" : card.isError ? "Couldn't read the card from Stripe" : card.data?.card ? `${card.data.card.brand[0].toUpperCase()}${card.data.card.brand.slice(1)} ••${card.data.card.last4}${card.data.card.exp ? ` · expires ${card.data.card.exp}` : ""}` : "No card on file in Stripe"}
                {current.next ? <span> · next {billingDay(current.next)}</span> : null}
              </div>
            </div>
          )}

          {opts.targets.length === 0 ? (
            <p className="rounded-xl border border-border p-3 text-[14px] text-muted-foreground" data-auto-pay-nothing>
              Nothing is owed on a package auto-pay could take. Add their next package (Renew) first, then set the new auto-pay on it.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-[13px] text-muted-foreground">Each payment (tax included)</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-12 text-lg tabular-nums" data-auto-pay-amount />
                {pace && pace !== each ? (
                  <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-2" onClick={() => setAmount((pace / 100).toFixed(2))} data-auto-pay-pace>
                    Keep pace with their training: {money(pace)} {everyWords(every)}
                  </button>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] text-muted-foreground">How often</Label>
                <div className="grid grid-cols-3 gap-2">
                  {EVERY_OPTIONS.map((e) => (
                    <Button key={e} type="button" variant="outline" className={cn("h-11", every === e && "border-foreground bg-secondary")} onClick={() => setEvery(e)} aria-pressed={every === e}>
                      {e === "week" ? "Weekly" : e === "2 weeks" ? "Every 2 weeks" : "Monthly"}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto-pay-first" className="text-[13px] text-muted-foreground">First payment</Label>
                <DateField id="auto-pay-first" value={first} onChange={setFirst} min={today} className="h-11" />
              </div>
              {opts.targets.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Pays first</Label>
                  <div className="flex flex-wrap gap-2">
                    {opts.targets.map((t) => (
                      <Button key={t.saleId} type="button" variant="outline" className={cn("h-11", target === t.saleId && "border-foreground bg-secondary")} onClick={() => setTarget(t.saleId)}>
                        {t.label} · {money(t.leftCents)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {sentence ? <p className="rounded-xl bg-muted/60 p-3 text-[14px]" data-auto-pay-preview>{sentence}</p> : problem && amount ? <p className="text-[13px] text-destructive">{problem}</p> : null}
            </>
          )}

          {current && !current.ending && (
            <div className="space-y-2 border-t border-border pt-4">
              {!stopping ? (
                <Button variant="ghost" className="h-11 w-full text-destructive hover:text-destructive" onClick={() => setStopping(true)} disabled={busy}>
                  Stop auto-pay
                </Button>
              ) : (
                <div className="space-y-2 rounded-xl border border-destructive/40 p-3" data-auto-pay-stop>
                  <p className="text-[14px]">Stop charging their card? What's owed stays owed: record what they pay you, or set payment dates.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-11" disabled={busy} onClick={() => stop.mutate("now")}>Stop now</Button>
                    <Button variant="outline" className="h-11" disabled={busy} onClick={() => stop.mutate("period_end")}>After this period</Button>
                  </div>
                  <Button variant="ghost" className="h-10 w-full" disabled={busy} onClick={() => setStopping(false)}>Keep it</Button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 space-y-2 border-t border-border px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
          {opts.targets.length > 0 && (
            <Button className="h-12 w-full text-[16px]" disabled={!!problem || busy} onClick={() => send.mutate()} data-auto-pay-send>
              {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send the setup link
            </Button>
          )}
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
