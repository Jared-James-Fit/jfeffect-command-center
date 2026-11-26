/**
 * Deactivate, reactivate and delete, for the person (Account, the gate) and
 * their coach or an admin (the client's page). Every sheet shows what it
 * means for this account first (getAccountReview: only what applies, the
 * same figures as Billing), and the server acts on its own reading of the
 * same review (lifecycle.functions.ts).
 */
import { isNative } from "@/platform";
import { useState, type ReactNode } from "react";
import { useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, CircleDollarSign, History, Info, Loader2, PauseCircle, Power, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { billingDay } from "@/lib/date-range";
import type { AccountReview, ReviewLine } from "@/lib/account-review";
import {
  deactivateAccount,
  getAccountHistory,
  getAccountReview,
  reactivateAccount,
  requestAccountDeletion,
  withdrawAccountDeletion,
  type AccountLifecycleView,
} from "@/lib/lifecycle.functions";
import { DEACTIVATION_REASONS } from "@/lib/client-deactivation.functions";
import { RESTORE_DAYS, restoreGateCopy } from "@/lib/recently-deleted";

const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);
const PREVIEW = "Preview only: this is how it looks to them.";

/* ---------------- the review ---------------- */

const TONE: Record<ReviewLine["tone"], { icon: typeof Info; cls: string }> = {
  stop: { icon: XCircle, cls: "text-muted-foreground" },
  keep: { icon: CheckCircle2, cls: "text-success" },
  owed: { icon: CircleDollarSign, cls: "text-warning" },
  info: { icon: Info, cls: "text-muted-foreground" },
};

export function ReviewLines({ review }: { review: AccountReview }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border" data-lifecycle-review={review.kind}>
      {review.lines.map((l) => {
        const t = TONE[l.tone];
        const Icon = t.icon;
        return (
          <li key={l.key} className="flex gap-3 px-3.5 py-3" data-review-line={l.key}>
            <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", t.cls)} aria-hidden />
            <div className="min-w-0">
              <div className="text-[15px] font-medium leading-snug">{l.title}</div>
              {l.body ? <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{l.body}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 jf-skeleton rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function useReview(
  opts: { clientId?: string; kind: "deactivate" | "delete" | "reactivate"; when?: "now" | "paid_through"; stopAutoPay?: boolean },
  enabled: boolean,
) {
  const fn = useServerFn(getAccountReview);
  return useQuery({
    queryKey: ["account-review", opts.clientId ?? "me", opts.kind, opts.when ?? "now", !!opts.stopAutoPay],
    enabled,
    staleTime: 15_000,
    queryFn: () => fn({ data: opts }) as Promise<AccountLifecycleView>,
  });
}

function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  busy?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]"
      >
        <SheetHeader className="min-h-0 shrink-0 space-y-1 px-5 pb-3 pt-5 text-left">
          <SheetTitle className="text-[18px]">{title}</SheetTitle>
          {description ? <SheetDescription className="text-[14px]">{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">{children}</div>
        <div className="shrink-0 space-y-2 border-t border-border px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}

function WhenChoice({
  paidThrough,
  value,
  onChange,
  self,
}: {
  paidThrough: string;
  value: "now" | "paid_through";
  onChange: (v: "now" | "paid_through") => void;
  self: boolean;
}) {
  const opts = [
    { v: "paid_through" as const, title: `When the paid month runs out (${billingDay(paidThrough)})`, sub: self ? "Keep coaching until then." : "They keep coaching until then." },
    { v: "now" as const, title: "Now", sub: "The rest of the paid month isn't refunded by itself." },
  ];
  return (
    <div className="space-y-2" role="radiogroup" aria-label="When">
      <div className="text-[13px] font-medium text-muted-foreground">When</div>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "flex min-h-12 w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
            value === o.v ? "border-foreground bg-secondary" : "border-border hover:bg-muted/40",
          )}
        >
          <span className={cn("mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border", value === o.v ? "border-foreground" : "border-muted-foreground/50")}>
            {value === o.v ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
          </span>
          <span>
            <span className="block text-[15px] font-medium">{o.title}</span>
            <span className="block text-[13px] text-muted-foreground">{o.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const invalidateAll = (qc: ReturnType<typeof useQueryClient>, clientId?: string) => {
  qc.invalidateQueries({ queryKey: ["account-lifecycle-status"] });
  qc.invalidateQueries({ queryKey: ["account-review"] });
  qc.invalidateQueries({ queryKey: ["account-history"] });
  if (clientId) {
    qc.invalidateQueries({ queryKey: ["client", clientId] });
    qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
  }
  qc.invalidateQueries({ queryKey: ["clients"] });
};

/* ---------------- the person: deactivate ---------------- */

export function DeactivateMySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [when, setWhen] = useState<"now" | "paid_through">("paid_through");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useReview({ kind: "deactivate", when }, open);
  const deactivate = useServerFn(deactivateAccount);
  const r = q.data?.review;
  const effectiveWhen = r?.paidThrough ? when : "now";

  const confirm = async () => {
    setBusy(true);
    try {
      const res: any = await deactivate({ data: { when: effectiveWhen, reason: reason.trim() || undefined } });
      onOpenChange(false);
      if (res.state === "scheduled") toast.success(`Your account deactivates ${billingDay(String(res.at ?? "").slice(0, 10)) ?? "when your paid month runs out"}.`);
      else toast.success("Your account is deactivated. Come back any time.");
      invalidateAll(qc);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't deactivate it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Deactivate your account"
      description="Take a break without losing anything. Nothing is deleted, and you can reactivate any time."
      footer={
        <>
          <Button className="h-12 w-full text-[16px]" disabled={!r || busy} onClick={() => void confirm()} data-lifecycle-confirm="deactivate">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {effectiveWhen === "paid_through" && r?.paidThrough ? `Deactivate on ${billingDay(r.paidThrough)}` : "Deactivate now"}
          </Button>
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep my account
          </Button>
        </>
      }
    >
      {r?.paidThrough ? <WhenChoice paidThrough={r.paidThrough} value={when} onChange={setWhen} self /> : null}
      <div className="space-y-2">
        <div className="text-[13px] font-medium text-muted-foreground">What it means for you</div>
        {q.isError ? (
          <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Couldn't load it."}</p>
        ) : r ? (
          <ReviewLines review={r} />
        ) : (
          <ReviewSkeleton />
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deactivate-reason" className="text-[13px] text-muted-foreground">
          Anything you want your coach to know? (optional)
        </Label>
        <Textarea
          id="deactivate-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          className="min-h-[72px] text-base"
        />
      </div>
    </BottomSheet>
  );
}

/** Account → Deactivate account: what it is, the scheduled day when there is one, and the sheet. */
export function DeactivateAccountPanel() {
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = useLifecycleStatus();
  const reactivate = useServerFn(reactivateAccount);
  const scheduled = status.data?.deactivation?.state === "scheduled" ? status.data.deactivation : null;

  if (scheduled) {
    return (
      <div className="space-y-3" data-deactivation-scheduled>
        <p className="text-sm text-muted-foreground">
          Your account deactivates on {billingDay(String(scheduled.at ?? "").slice(0, 10))}. Until then everything works as usual.
        </p>
        <Button
          variant="outline"
          className="h-10"
          disabled={busy}
          onClick={async () => {
            if (isImpersonating) return toast.message(PREVIEW);
            setBusy(true);
            try {
              await reactivate({ data: {} });
              toast.success("Your account stays active. Your subscription's end date doesn't change; ask your coach to keep it going.");
              invalidateAll(qc);
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't change it. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Keep my account active
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Taking a break? Deactivating keeps everything (your training, progress and messages) and stops any coaching subscription from charging again. Reactivate any time.
      </p>
      <Button variant="outline" className="h-10" onClick={() => (isImpersonating ? toast.message(PREVIEW) : setOpen(true))} data-open-deactivate>
        <PauseCircle className="mr-2 h-4 w-4" aria-hidden /> Deactivate my account
      </Button>
      {open && <DeactivateMySheet open={open} onOpenChange={setOpen} />}
    </div>
  );
}

/* ---------------- the person: delete ---------------- */

export function DeleteMySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useReview({ kind: "delete" }, open);
  const request = useServerFn(requestAccountDeletion);
  const r = q.data?.review;
  const ready = typed.trim().toUpperCase() === "DELETE";

  const confirm = async () => {
    setBusy(true);
    try {
      await request({ data: { reason: reason.trim() || undefined, confirm: "DELETE" } });
      onOpenChange(false);
      toast.success(`Your account is in Recently deleted. Sign back in within ${RESTORE_DAYS} days to restore it.`, { duration: 10000 });
      await signOut();
      navigate({ to: "/auth", replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete your account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Delete your account"
      description={`It waits in Recently deleted for ${RESTORE_DAYS} days first: sign back in before then to restore it. After that it's deleted for good.`}
      footer={
        <>
          <Button
            variant="destructive"
            className="h-12 w-full text-[16px]"
            disabled={!ready || busy || (!r && !q.isError)}
            onClick={() => void confirm()}
            data-lifecycle-confirm="delete"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Delete my account
          </Button>
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep my account
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="text-[13px] font-medium text-muted-foreground">What it means for you</div>
        {q.isError ? (
          <p className="text-sm text-muted-foreground">Your training, progress and messages are deleted after {RESTORE_DAYS} days.</p>
        ) : r ? (
          <ReviewLines review={r} />
        ) : (
          <ReviewSkeleton />
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Only taking a break? <span className="font-medium text-foreground">Deactivate</span> instead (Account → Deactivate account): nothing is deleted.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="delete-reason" className="text-[13px] text-muted-foreground">
          Why are you leaving? (optional)
        </Label>
        <Textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} className="min-h-[64px] text-base" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="delete-confirm" className="text-[13px] text-muted-foreground">
          Type DELETE to confirm
        </Label>
        <Input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          className="h-11 text-base"
          data-delete-confirm-input
        />
      </div>
    </BottomSheet>
  );
}

export function DeleteAccountPanel() {
  const { isImpersonating } = useClientImpersonation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3" id="delete-account-panel">
      <div className="text-[15px] font-medium">Delete my account</div>
      <p className="text-sm text-muted-foreground">
        Deletes your training, nutrition, progress and health info for good after {RESTORE_DAYS} days. Payment and session records are kept, as the law requires.
      </p>
      <Button
        variant="outline"
        className="h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => (isImpersonating ? toast.message(PREVIEW) : setOpen(true))}
        data-open-delete
      >
        Delete my account
      </Button>
      {open && <DeleteMySheet open={open} onOpenChange={setOpen} />}
    </div>
  );
}

/* ---------------- the gate over the app ---------------- */

type LifecycleStatus = {
  deletion: { id: string; purge_after: string; requested_at: string; source: "self" | "admin" } | null;
  deactivation: {
    client_id: string;
    state: "deactivated" | "scheduled";
    source: "self" | "staff";
    since: string | null;
    at: string | null;
    tier: string;
    coach: string | null;
  } | null;
};

export function useLifecycleStatus() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  return useQuery({
    queryKey: ["account-lifecycle-status", user?.id ?? ""],
    enabled: !!user?.id && !isImpersonating,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LifecycleStatus | null> => {
      const { data, error } = await rpc("account_lifecycle_status");
      if (error) return null; // never lock anyone out on a failed read
      return (data ?? null) as LifecycleStatus | null;
    },
  });
}

/** Screens a deactivated account can still open: what they owe and their receipts. */
const OPEN_WHILE_DEACTIVATED = /^\/portal\/purchases(\/|$)/;

/**
 * Signed in to an account that's in Recently deleted or deactivated: one
 * screen over the whole app (never in View as client, and nothing until it
 * knows). Recently deleted: Restore (their own deletion) or Contact support.
 * Deactivated by themselves: Reactivate; by their coach: ask the coach. Both
 * can still open Purchases & payments to see and pay what they owe.
 */
export function AccountLifecycleGate() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [busy, setBusy] = useState(false);
  const { data } = useLifecycleStatus();
  const reactivate = useServerFn(reactivateAccount);
  const withdraw = useServerFn(withdrawAccountDeletion);
  if (!data || isImpersonating) return null;
  const deletion = data.deletion;
  const deact = data.deactivation?.state === "deactivated" ? data.deactivation : null;
  if (!deletion && !deact) return null;
  if (!deletion && deact && OPEN_WHILE_DEACTIVATED.test(pathname)) return null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const out = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  let title: string;
  let body: string;
  let primary: ReactNode = null;
  if (deletion) {
    const copy = restoreGateCopy(deletion as any);
    title = copy.title;
    body = copy.body;
    primary =
      deletion.source === "self" ? (
        <Button
          className="h-12 w-full text-[16px]"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r: any = await withdraw();
              if (!r?.ok) throw new Error("There's nothing to restore. Contact support if your account is missing.");
            }, "Welcome back. Your account is restored.")
          }
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Restore my account
        </Button>
      ) : (
        <Button asChild className="h-12 w-full text-[16px]">
          <a href="mailto:support@jfeffect.com?subject=My%20JF%20Effect%20account">Contact support</a>
        </Button>
      );
  } else if (deact!.source === "self") {
    title = "Your account is deactivated";
    body = "Nothing was deleted. Reactivate to pick up where you left off. Nothing restarts and nothing is charged when you do.";
    primary = (
      <Button
        className="h-12 w-full text-[16px]"
        disabled={busy}
        onClick={() => void run(() => reactivate({ data: {} }), "Welcome back. Your account is active again.")}
        data-gate-reactivate
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        Reactivate my account
      </Button>
    );
  } else {
    const coach = deact!.coach || "Your coach";
    title = "Your account is paused";
    body = `${coach} paused your account. Your training and messages are kept. Ask ${deact!.coach ? deact!.coach : "them"} to turn it back on.`;
    primary = (
      <Button asChild className="h-12 w-full text-[16px]">
        <a href="mailto:support@jfeffect.com?subject=My%20JF%20Effect%20account">Contact support</a>
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-lifecycle-title"
      data-account-lifecycle-gate={deletion ? "deletion" : `deactivated-${deact!.source}`}
      data-account-deletion-gate={deletion ? "" : undefined}
    >
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted">
          {deletion ? <History className="h-6 w-6" aria-hidden /> : <Power className="h-6 w-6" aria-hidden />}
        </div>
        <div className="space-y-2">
          <h1 id="account-lifecycle-title" className="text-xl font-semibold">
            {title}
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
        <div className="space-y-2">
          {primary}
          {/* the iPhone app opens no billing page (native-purchases.ts) */}
          {!deletion && deact!.tier === "coaching" && !isNative() ? (
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to="/portal/purchases">Purchases & payments</Link>
            </Button>
          ) : null}
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => void out()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the coach / an admin ---------------- */

export function ClientLifecycleSheet({
  clientId,
  kind,
  open,
  onOpenChange,
}: {
  clientId: string;
  kind: "deactivate" | "reactivate";
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [when, setWhen] = useState<"now" | "paid_through">("paid_through");
  const [reason, setReason] = useState<string>("Coaching ended");
  const [note, setNote] = useState("");
  const [stopAutoPay, setStopAutoPay] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useReview({ clientId, kind, when, stopAutoPay }, open);
  const deactivate = useServerFn(deactivateAccount);
  const reactivate = useServerFn(reactivateAccount);
  const v = q.data;
  const r = v?.review;
  const first = v?.firstName ?? "They";
  const effectiveWhen = r?.paidThrough ? when : "now";
  const scheduled = kind === "reactivate" && v?.state === "scheduled";

  const confirm = async () => {
    setBusy(true);
    try {
      if (kind === "deactivate") {
        const res: any = await deactivate({
          data: { clientId, when: effectiveWhen, reason: reason || undefined, note: note.trim() || undefined, stopAutoPay },
        });
        toast.success(res.state === "scheduled" ? `${first}'s account deactivates ${billingDay(String(res.at ?? "").slice(0, 10))}` : `${first}'s account is deactivated`);
      } else {
        const res: any = await reactivate({ data: { clientId } });
        toast.success(res.withdrawn ? `${first}'s account stays active` : `${first}'s account is active again`);
      }
      onOpenChange(false);
      invalidateAll(qc, clientId);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const title =
    kind === "deactivate" ? `Deactivate ${first}'s account` : scheduled ? `Keep ${first}'s account active` : `Reactivate ${first}'s account`;
  const action =
    kind === "deactivate"
      ? effectiveWhen === "paid_through" && r?.paidThrough
        ? `Deactivate on ${billingDay(r.paidThrough)}`
        : "Deactivate now"
      : scheduled
        ? "Cancel the deactivation"
        : "Reactivate";

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={title}
      description={
        kind === "deactivate"
          ? "Nothing is deleted. They come off your lists and every job, and you can reactivate any time."
          : scheduled
            ? `It was set to deactivate ${billingDay(String(v?.at ?? "").slice(0, 10))}. Their subscription's end date doesn't change.`
            : "They get the app back as it was. Nothing restarts and nothing is charged."
      }
      footer={
        <>
          <Button className="h-12 w-full text-[16px]" disabled={!r || busy} onClick={() => void confirm()} data-lifecycle-confirm={kind}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {action}
          </Button>
          <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      {kind === "deactivate" && r?.paidThrough ? <WhenChoice paidThrough={r.paidThrough} value={when} onChange={setWhen} self={false} /> : null}
      <div className="space-y-2">
        <div className="text-[13px] font-medium text-muted-foreground">What it means for {first}</div>
        {q.isError ? <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Couldn't load it."}</p> : r ? <ReviewLines review={r} /> : <ReviewSkeleton />}
      </div>
      {kind === "deactivate" && (r?.autoPay || stopAutoPay) ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
          <div>
            <div className="text-[15px] font-medium">Stop the payment plan too</div>
            <div className="text-[13px] text-muted-foreground">Only if you've agreed to. What's owed stays owed.</div>
          </div>
          <Switch checked={stopAutoPay} onCheckedChange={setStopAutoPay} aria-label="Stop the payment plan too" />
        </div>
      ) : null}
      {kind === "deactivate" ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-muted-foreground">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEACTIVATION_REASONS.map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deactivate-note" className="text-[13px] text-muted-foreground">
              Note (only your team sees it)
            </Label>
            <Textarea id="deactivate-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} className="min-h-[64px] text-base" />
          </div>
        </>
      ) : null}
      {open ? <AccountHistory clientId={clientId} /> : null}
    </BottomSheet>
  );
}

const EVENT_WORDS: Record<string, string> = {
  deactivation_scheduled: "Set to deactivate",
  deactivation_withdrawn: "Deactivation cancelled",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
  subscription_cancelled: "Coaching subscription stopped",
  auto_pay_stopped: "Payment plan stopped",
  sessions_cancelled: "Booked sessions cancelled",
  deletion_requested: "Deletion requested",
  deletion_withdrawn: "Deletion taken back",
  deletion_completed: "Deleted for good",
};

const ROLE_WORDS: Record<string, string> = { self: "by them", coach: "by their coach", admin: "by an admin", system: "automatically" };

/** The account's history, newest first: what happened, by whom, when. */
export function AccountHistory({ clientId, defaultOpen = false }: { clientId: string; defaultOpen?: boolean }) {
  const fn = useServerFn(getAccountHistory);
  const [open, setOpen] = useState(defaultOpen);
  const q = useQuery({
    queryKey: ["account-history", clientId],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => fn({ data: { clientId } }),
  });
  const rows = q.data
    ? [
        ...q.data.events.map((e) => ({
          id: e.id,
          at: e.created_at,
          what: EVENT_WORDS[e.event] ?? e.event,
          who: e.actor_name ? `by ${e.actor_name}` : ROLE_WORDS[e.actor_role] ?? "",
          why: typeof e.details?.reason === "string" ? (e.details.reason as string) : typeof e.details?.name === "string" ? (e.details.name as string) : null,
        })),
        ...(q.data.activatedAt ? [{ id: "activated", at: q.data.activatedAt, what: "Activated", who: "", why: null }] : []),
        ...(q.data.createdAt ? [{ id: "created", at: q.data.createdAt, what: "Account created", who: "", why: null }] : []),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];
  return (
    <div className="rounded-xl border border-border" data-account-history>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[15px] font-medium" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
        Account history
        <span className="ml-auto text-[13px] font-normal text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <ul className="divide-y divide-border border-t border-border">
          {q.isLoading ? (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">Loading…</li>
          ) : rows.length === 0 ? (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">Nothing yet.</li>
          ) : (
            rows.map((row) => (
              <li key={row.id} className="flex items-baseline gap-3 px-3.5 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-muted-foreground">{billingDay(row.at) ?? ""}</span>
                <span className="min-w-0">
                  <span className="font-medium">{row.what}</span>
                  {row.who ? <span className="text-muted-foreground"> {row.who}</span> : null}
                  {row.why ? <span className="block text-[13px] text-muted-foreground">{row.why}</span> : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** The client page's banner while an account is deactivated or set to be. */
export function ClientLifecycleBanner({
  clientId,
  status,
  deactivatedAt,
  deactivateAt,
  reason,
  note,
  source,
  onReactivate,
}: {
  clientId: string;
  status: string | null | undefined;
  deactivatedAt?: string | null;
  deactivateAt?: string | null;
  reason?: string | null;
  note?: string | null;
  source?: string | null;
  onReactivate: () => void;
}) {
  const deactivated = status === "Deactivated";
  if (!deactivated && !deactivateAt) return null;
  const by = source === "self" ? "by them" : "by your team";
  const line = deactivated
    ? `Deactivated ${by}${deactivatedAt ? ` on ${billingDay(deactivatedAt)}` : ""}`
    : `Deactivates ${billingDay(String(deactivateAt).slice(0, 10))} (when the month they've paid for runs out), ${source === "self" ? "as they asked" : "as your team set"}`;
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card px-4 py-3" data-client-lifecycle-banner={deactivated ? "deactivated" : "scheduled"}>
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{deactivated ? "Account deactivated" : "Account set to deactivate"}</div>
          <div className="text-sm text-muted-foreground">
            {line}
            {reason ? ` · ${reason}` : ""}
          </div>
          {note ? <div className="mt-1 text-[13px] text-muted-foreground">Note: {note}</div> : null}
        </div>
        <Button variant="outline" className="h-10" onClick={onReactivate} data-banner-reactivate>
          {deactivated ? "Reactivate" : "Cancel it"}
        </Button>
      </div>
      <AccountHistory clientId={clientId} />
    </div>
  );
}

/**
 * A JF member's page: their own (self-serve) record's lifecycle, the same
 * banner, sheets and history as a coaching client's.
 */
export function MemberLifecycle({ userId }: { userId: string | null | undefined }) {
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const q = useQuery({
    queryKey: ["client", "by-user", userId ?? ""],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () =>
      (
        await (supabase as any)
          .from("clients")
          .select("id, status, deactivated_at, deactivate_at, deactivation_reason, deactivation_note, deactivation_source")
          .eq("user_id", userId)
          .order("created_at")
          .limit(1)
          .maybeSingle()
      ).data as any,
  });
  const c = q.data;
  if (!c || c.status === "Deleted") return null;
  const off = c.status === "Deactivated" || !!c.deactivate_at;
  return (
    <div className="mb-4" data-member-lifecycle>
      {off ? (
        <ClientLifecycleBanner
          clientId={c.id}
          status={c.status}
          deactivatedAt={c.deactivated_at}
          deactivateAt={c.deactivate_at}
          reason={c.deactivation_reason}
          note={c.deactivation_note}
          source={c.deactivation_source}
          onReactivate={() => setReactivateOpen(true)}
        />
      ) : (
        <Button variant="outline" size="sm" className="h-9" onClick={() => setDeactivateOpen(true)} data-member-deactivate>
          <PauseCircle className="mr-1.5 h-4 w-4" aria-hidden /> Deactivate account
        </Button>
      )}
      {deactivateOpen && <ClientLifecycleSheet clientId={c.id} kind="deactivate" open={deactivateOpen} onOpenChange={setDeactivateOpen} />}
      {reactivateOpen && <ClientLifecycleSheet clientId={c.id} kind="reactivate" open={reactivateOpen} onOpenChange={setReactivateOpen} />}
    </div>
  );
}
