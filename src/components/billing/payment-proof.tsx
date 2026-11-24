/**
 * Money that came in by hand, for staff: where it went (a saved deposit
 * account, by name and last 4 only), its proof (a screenshot of the
 * e-transfer or a photo of the cheque in the private payment-proofs bucket,
 * admins and finance only, never shown to the client) and one sheet that says
 * everything about a payment. payment-proof.ts holds the rules.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, ExternalLink, FileText, Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { attachPaymentProof } from "@/lib/billing.functions";
import { billingDay } from "@/lib/date-range";
import type { PaymentRow } from "@/lib/sale-money";
import {
  depositLabel,
  needsAccount,
  paymentHow,
  pickableAccounts,
  proofPath,
  proofProblem,
  type DepositAccount,
} from "@/lib/payment-proof";

export const DEPOSIT_ACCOUNTS_KEY = ["deposit-accounts"] as const;

export function useDepositAccounts(enabled = true) {
  return useQuery({
    queryKey: DEPOSIT_ACCOUNTS_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("deposit_accounts").select("id, label, institution, last4, is_default, archived_at").order("created_at");
      if (error) return [] as DepositAccount[];
      return (data ?? []) as DepositAccount[];
    },
  });
}

/** Where it went: one tap on a saved account, or add one (name + last 4 digits, never the full number). */
export function DepositAccountPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const qc = useQueryClient();
  const { data: all = [] } = useDepositAccounts();
  const accounts = pickableAccounts(all);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);

  // The default account is picked to start with.
  useEffect(() => {
    if (value === null && accounts.length > 0) onChange(accounts[0].id);
  }, [accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const name = label.trim();
    const digits = last4.replace(/\D/g, "");
    if (!name) return toast.error("Name the account, like Simplii Chequing.");
    if (digits && (digits.length < 3 || digits.length > 4)) return toast.error("Just the last 4 digits.");
    setBusy(true);
    try {
      const { data, error } = await (supabase as any)
        .from("deposit_accounts")
        .insert({ label: name, last4: digits || null, is_default: accounts.length === 0 })
        .select("id")
        .single();
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: DEPOSIT_ACCOUNTS_KEY });
      onChange(data.id);
      setAdding(false);
      setLabel("");
      setLast4("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add the account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-deposit-picker>
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => (
          <Button
            key={a.id}
            type="button"
            variant="outline"
            className={cn("h-11", value === a.id && "border-foreground bg-secondary")}
            onClick={() => onChange(a.id)}
            aria-pressed={value === a.id}
          >
            {depositLabel(a)}
          </Button>
        ))}
        {!adding && (
          <Button type="button" variant="ghost" className="h-11 text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add account
          </Button>
        )}
      </div>
      {adding && (
        <div className="grid grid-cols-[1fr_6rem] gap-2 rounded-xl border border-border p-2.5">
          <Input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="Bank and account (Simplii Chequing)" className="h-11 text-base" aria-label="Account name" />
          <Input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="Last 4" className="h-11 text-base" aria-label="Last 4 digits" />
          <p className="col-span-2 text-[12px] text-muted-foreground">Only the last 4 digits are kept, never the full account number.</p>
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" className="h-10" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="outline" className="h-10" onClick={() => void save()} disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Upload a proof as soon as it's picked; the caller saves the path with the payment. */
export function ProofPicker({ clientId, value, onChange, date, hideThumb }: { clientId: string; value: string | null; onChange: (path: string | null) => void; date: string; hideThumb?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = proofProblem({ type: file.type || "image/jpeg", size: file.size });
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const path = proofPath(clientId, file.type || "image/jpeg", date, Math.random().toString(36).slice(2, 12));
      const { error } = await supabase.storage.from("payment-proofs").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (error) throw error;
      onChange(path);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't upload it. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div data-proof-picker>
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <div className="flex items-start gap-3">
          {!hideThumb && <ProofImage path={value} className="h-20 w-20" />}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted-foreground">Attached. Only you and finance see it.</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => input.current?.click()} disabled={busy}>Replace</Button>
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => onChange(null)} disabled={busy}><X className="mr-1 h-4 w-4" />Remove</Button>
            </div>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="h-11 w-full justify-start" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {busy ? "Uploading…" : "Add a screenshot or photo"}
        </Button>
      )}
    </div>
  );
}

/** A proof file, read through a short-lived signed link (the bucket is private). */
export function ProofImage({ path, className, full }: { path: string; className?: string; full?: boolean }) {
  const proof = useQuery({
    queryKey: ["payment-proof-url", path],
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 600);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
  const url = proof.data;
  const pdf = path.toLowerCase().endsWith(".pdf");
  if (!url && (proof.isError || proof.isSuccess)) {
    // couldn't sign a link: say so with Try again, never a placeholder that pulses forever
    return (
      <button
        type="button"
        onClick={() => void proof.refetch()}
        className={cn("grid place-items-center rounded-lg border border-dashed border-border p-2 text-center text-[12px] text-muted-foreground", className)}
      >
        {proof.isFetching ? "Loading…" : "Couldn't load the proof · Try again"}
      </button>
    );
  }
  if (!url) return <div className={cn("jf-skeleton rounded-lg bg-muted", className)} aria-busy />;
  if (pdf) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cn("flex items-center justify-center gap-1.5 rounded-lg border border-border text-[13px]", className)}>
        <FileText className="h-4 w-4" /> PDF
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block" aria-label="Open the proof">
      <img src={url} alt="Proof of payment" className={cn("rounded-lg border border-border bg-muted object-cover", full && "max-h-[50dvh] w-full object-contain", className)} />
    </a>
  );
}

/** Everything about one payment: how, into where, its reference and proof; attach a proof to one recorded by hand. */
export function PaymentDetailSheet({ row, label, money, open, onOpenChange, canEdit }: {
  row: PaymentRow;
  label: string | null;
  money: (c: number) => string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useDepositAccounts(open);
  const attach = useServerFn(attachPaymentProof);
  const [proof, setProof] = useState<string | null>(row.proofPath);
  const [account, setAccount] = useState<string | null>(row.depositAccountId);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setProof(row.proofPath);
    setAccount(row.depositAccountId);
  }, [row.id, row.proofPath, row.depositAccountId]);
  const changed = proof !== row.proofPath || account !== row.depositAccountId;
  const save = async () => {
    setBusy(true);
    try {
      await attach({ data: { ledger_id: row.id, proof_path: proof, deposit_account_id: account } });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["client-billing"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save it");
    } finally {
      setBusy(false);
    }
  };
  const how = paymentHow({ method: row.methodKey, source: row.byHand ? "manual" : "stripe", deposit_account_id: row.depositAccountId }, accounts);
  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="bottom" hideCloseButton className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-payment-detail>
        <SheetHeader className="min-h-0 shrink-0 space-y-0.5 px-5 pb-2 pt-5 text-left">
          <SheetTitle className="text-[22px] tabular-nums">{row.kind === "refund" ? "−" : ""}{money(row.cents)}</SheetTitle>
          <p className="text-[14px] text-muted-foreground">{row.voided ? "Voided · " : ""}{row.kind === "refund" ? "Refund" : "Payment"} · {billingDay(row.date, { year: "always" }) ?? "No date"}</p>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <dl className="divide-y divide-border rounded-xl border border-border text-[14px]">
            <Line k="For">{label ?? "Payment"}</Line>
            <Line k="How">{how}</Line>
            {row.kind === "payment" && <Line k="Tax">{row.taxCents > 0 ? `${money(row.taxCents)} included` : "None"}</Line>}
            {row.byHand && row.reference ? <Line k="Reference">{row.reference}</Line> : null}
            <Line k="Recorded">{row.byHand ? "By you" : "By Stripe"}</Line>
            {row.receiptUrl ? (
              <Line k="Receipt"><a href={row.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">Stripe receipt <ExternalLink className="h-3 w-3" /></a></Line>
            ) : null}
          </dl>
          {row.byHand && (
            <>
              {canEdit && needsAccount(String(row.methodKey ?? "")) && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Paid into</Label>
                  <DepositAccountPicker value={account} onChange={setAccount} />
                </div>
              )}
              <div className="space-y-1.5" data-payment-proof>
                <Label className="text-[13px] text-muted-foreground">Proof</Label>
                {proof ? <ProofImage path={proof} full /> : !canEdit ? <p className="text-[14px] text-muted-foreground">None attached.</p> : null}
                {canEdit && row.clientId ? (
                  <ProofPicker clientId={row.clientId} value={proof} onChange={setProof} hideThumb date={String(row.date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10)} />
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 space-y-2 border-t border-border px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
          {canEdit && row.byHand && changed ? (
            <Button className="h-12 w-full text-[16px]" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          ) : null}
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
