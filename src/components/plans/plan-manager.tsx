/**
 * Manage plan: what you're on, what else there is, and exactly what a change
 * means before you make it (what you pay today, what you pay going forward,
 * when it happens, what you gain and lose). The client's page (/portal/plan)
 * and the coach's plan card (client Billing) are this same component with a
 * different `api`.
 *
 * Every number comes from the server (plans.functions.ts): the package's own
 * price, the client's own contracted price, Stripe's prorated preview. Nothing
 * is worked out here except the words.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, CreditCard, History, Info, Loader2, Minus, Plus, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import { billingDay } from "@/lib/date-range";
import { ALWAYS_KEPT, money, quoteLines, type ConfirmResult, type PlanPreview } from "@/lib/plans/plan-engine";
import type { PlanCard, PlanView } from "@/lib/plans/plans.functions";
import { cn } from "@/lib/utils";

export type PlanApi = {
  preview: (toSlug: string) => Promise<PlanPreview>;
  confirm: (toSlug: string, extra: { prorationDate?: number | null; note?: string | null; noCharge?: boolean }) => Promise<ConfirmResult>;
  undo: (changeId: string) => Promise<unknown>;
  keep: () => Promise<unknown>;
  /** Stripe's own page for their card (clients only). */
  updateCard?: ReactNode;
};

const day = (iso: string | null | undefined) => (iso ? billingDay(iso.slice(0, 10)) : null);

function priceLine(cents: number | null, family: string): string {
  if (family === "free") return "Free";
  if (cents == null) return "Set up with your coach";
  return `${money(cents)} a month + tax`;
}

/* ───────────────────────── current plan ───────────────────────── */

function CurrentPlanCard({ view, api, busy, onKeep, who }: { view: PlanView; api: PlanApi; busy: boolean; onKeep: () => void; who: "client" | "admin" }) {
  const c = view.current;
  const [all, setAll] = useState(false);
  const chip =
    c.status === "past_due" ? <StatusChip tone="error">Payment failed</StatusChip>
    : c.status === "ending" ? <StatusChip tone="attention">Ends {day(c.nextBillingDate) ?? "soon"}</StatusChip>
    : c.status === "trialing" ? <StatusChip>Starts {day(c.nextBillingDate) ?? "soon"}</StatusChip>
    : null;
  const shown = all ? c.features : c.features.slice(0, 3);
  return (
    <Card className="space-y-3 p-4" data-plan-current={c.slug ?? c.family}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-muted-foreground">{who === "client" ? "Your plan" : "Plan"}</div>
          <div className="text-xl font-semibold leading-tight">{c.name}</div>
          <div className="mt-1 text-[14px] text-muted-foreground" data-plan-price>
            {priceLine(c.priceCents, c.family)}
            {c.managed === "stripe" && c.nextBillingDate && c.status !== "ending" ? ` · next payment ${day(c.nextBillingDate)}` : ""}
          </div>
          {c.specialPrice ? (
            <div className="mt-0.5 text-[13px] text-muted-foreground">A price you keep while you're on this plan.</div>
          ) : null}
        </div>
        {chip}
      </div>
      {shown.length > 0 && (
        <ul className="space-y-1.5" data-plan-included>
          {shown.map((f) => (
            <li key={f} className="flex gap-2 text-[14px] leading-snug">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {c.features.length > 3 && (
        <button type="button" className="flex h-9 items-center gap-1 text-[13px] font-medium text-muted-foreground" onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : `Everything included (${c.features.length})`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} />
        </button>
      )}
      {c.status === "past_due" && (
        <div className="space-y-2 rounded-xl border border-destructive/30 p-3" data-plan-past-due>
          <p className="text-[14px]">Your last payment didn't go through. Update your card and Stripe tries again.</p>
          {api.updateCard}
        </div>
      )}
      {c.status === "ending" && !view.open && (
        <div className="space-y-2 rounded-xl border border-warning/40 p-3" data-plan-ending>
          <p className="text-[14px]">
            {c.name} ends {day(c.nextBillingDate) ?? "at the end of your paid month"}. You keep everything you logged.
          </p>
          {view.canChange && who === "client" && (
            <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={onKeep}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}Keep my plan
            </Button>
          )}
        </div>
      )}
      {c.managed === "custom" && c.customReason && (
        <p className="text-[13px] text-muted-foreground" data-plan-custom>
          {c.customReason} {who === "client" ? "Pick a plan below to ask." : ""}
        </p>
      )}
    </Card>
  );
}

/* ───────────────────────── a change in flight ───────────────────────── */

function OpenChangeBanner({ view, busy, onUndo }: { view: PlanView; busy: boolean; onUndo: () => void }) {
  const o = view.open;
  if (!o) return null;
  const when = day(o.effectiveAt);
  let text: string;
  let undo = "Undo";
  if (o.status === "scheduled" && o.kind === "cancel") {
    text = `${o.fromLabel ?? "Your plan"} ends ${when ?? "at the end of your paid month"}. Then you're on ${o.toLabel ?? "the free app"}, with everything you logged. Nothing changes until then.`;
    undo = "Keep my plan";
  } else if (o.status === "scheduled") {
    text = `Switching to ${o.toLabel} on ${when ?? "your next billing date"}. Nothing changes until then.`;
  } else if (o.status === "awaiting_payment") {
    text = `Your upgrade to ${o.toLabel} is waiting on the payment. Finish it on Stripe's secure page, or cancel and nothing is charged.`;
    undo = "Cancel upgrade";
  } else if (o.status === "checkout") {
    text = `You started checkout for ${o.toLabel} but didn't finish. Nothing was charged.`;
    undo = "Clear it";
  } else {
    text = `Your change to ${o.toLabel} is going through.`;
  }
  return (
    <Card className="space-y-3 border-warning/40 p-4" data-plan-open={o.status}>
      <p className="text-[14px] leading-snug">{text}</p>
      <div className="flex flex-wrap gap-2">
        {o.payUrl && view.canChange && (
          <Button asChild size="sm" className="h-10">
            <a href={o.payUrl}>
              <CreditCard className="mr-1.5 h-4 w-4" />Finish payment
            </a>
          </Button>
        )}
        {view.canChange && o.status !== "processing" && (
          <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={onUndo} data-plan-undo>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
            {undo}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── the plans ───────────────────────── */

function buttonWord(p: PlanCard, who: "client" | "admin"): string {
  const t = p.transition;
  switch (t.kind) {
    case "start":
      return `Start ${p.name}`;
    case "upgrade":
      return "Upgrade";
    case "downgrade":
      return "Switch";
    case "cancel":
      return p.family === "free" ? "Move to the free app" : "Switch";
    case "request":
      return who === "client" ? "Ask about this plan" : "Requested only";
    default:
      return "Your plan";
  }
}

function PlanOptionCard({ p, onPick, who, canChange }: { p: PlanCard; onPick: () => void; who: "client" | "admin"; canChange: boolean }) {
  const t = p.transition;
  const current = t.kind === "current" && t.blocked === "Your current plan";
  return (
    <Card className={cn("space-y-3 p-4", current && "border-foreground/40")} data-plan-option={p.slug}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{p.name}</h3>
            {current ? <StatusChip>Your plan</StatusChip> : p.recommended ? <StatusChip>Recommended</StatusChip> : null}
          </div>
          {p.tagline ? <p className="mt-0.5 text-[14px] text-muted-foreground">{p.tagline}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-semibold">{p.family === "free" ? "Free" : money(p.priceCents)}</div>
          {p.family !== "free" && <div className="text-[12px] text-muted-foreground">a month + tax</div>}
        </div>
      </div>
      {!current && (p.gain.length > 0 || p.lose.length > 0) && (
        <ul className="space-y-1.5" data-plan-diff>
          {p.gain.slice(0, 4).map((g) => (
            <li key={`g-${g}`} className="flex gap-2 text-[14px] leading-snug">
              <Plus className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="You'd get" />
              <span>{g}</span>
            </li>
          ))}
          {p.gain.length > 4 && <li className="pl-6 text-[13px] text-muted-foreground">+ {p.gain.length - 4} more</li>}
          {p.lose.slice(0, 4).map((l) => (
            <li key={`l-${l}`} className="flex gap-2 text-[14px] leading-snug text-muted-foreground">
              <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-label="You'd lose" />
              <span>{l}</span>
            </li>
          ))}
          {p.lose.length > 4 && <li className="pl-6 text-[13px] text-muted-foreground">and {p.lose.length - 4} more</li>}
        </ul>
      )}
      {!current && (
        <div className="space-y-1.5">
          <Button
            className="h-11 w-full"
            variant="outline"
            disabled={!t.available || !canChange || (t.kind === "request" && who === "admin")}
            onClick={onPick}
            data-plan-pick={p.slug}
          >
            {t.kind === "upgrade" ? <ArrowUp className="mr-1.5 h-4 w-4" /> : t.kind === "downgrade" || t.kind === "cancel" ? <ArrowDown className="mr-1.5 h-4 w-4" /> : null}
            {buttonWord(p, who)}
          </Button>
          {!t.available && t.blocked ? <p className="text-center text-[13px] text-muted-foreground" data-plan-blocked>{t.blocked}</p> : null}
          {t.available && t.timing === "period_end" ? (
            <p className="text-center text-[13px] text-muted-foreground">Happens when your paid month ends</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── confirm ───────────────────────── */

/** One line of the quote: the label over its value (long values never squeeze a label on a phone). */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn("text-[16px] leading-snug", strong && "text-[22px] font-semibold tabular-nums")}>{value}</div>
    </div>
  );
}

function ConfirmSheet({
  target,
  open,
  onOpenChange,
  api,
  who,
  onDone,
}: {
  target: PlanCard | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: PlanApi;
  who: "client" | "admin";
  onDone: (r: ConfirmResult) => void;
}) {
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noCharge, setNoCharge] = useState(false);
  const slug = open ? target?.slug ?? null : null;

  // one preview per open (a fresh proration date each time)
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setPreview(null);
    setError(null);
    setNote("");
    setNoCharge(false);
    setLoading(true);
    api
      .preview(slug)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(e?.message ?? "Couldn't work out the change"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // the api object changes every render; the slug is what a preview is for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const isRequest = target?.transition.kind === "request";
  const q = preview?.quote ?? null;
  const lines = q ? quoteLines(q, (iso) => billingDay(iso)) : null;
  const available = preview ? preview.transition.available : false;

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.confirm(target.slug, { prorationDate: preview?.prorationDate ?? null, note: note.trim() || null, noCharge });
      if (r.result === "failed") {
        setError(r.message);
        return;
      }
      onDone(r);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't change your plan. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  };

  const action = (() => {
    if (!target || !preview) return "Confirm";
    const k = preview.transition.kind;
    if (k === "request") return who === "client" ? "Send to my coach" : "Send";
    if (k === "start") return "Continue to checkout";
    if (k === "upgrade") return noCharge ? "Switch now, no charge" : q?.todayCents ? `Upgrade and pay ${money(q.todayCents)}` : "Upgrade now";
    if (k === "cancel") return `Confirm, ends ${billingDay(q?.effectiveDate ?? null) ?? "then"}`;
    return `Confirm switch on ${billingDay(q?.effectiveDate ?? null) ?? "renewal"}`;
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),1rem)] sm:mx-auto sm:max-w-[520px]"
        data-plan-confirm={target?.slug}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <SheetHeader className="px-5 pb-2 pt-3 text-left">
          <SheetTitle className="text-xl">{preview?.headline ?? (target ? (isRequest ? `Ask about ${target.name}` : target.name) : "")}</SheetTitle>
          <SheetDescription className="text-[14px]">
            {isRequest
              ? "Your plan is set up with your coach, so this goes to them as a message. Nothing changes or gets charged until they set it up."
              : "Here's exactly what happens. Nothing changes until you confirm."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 pb-4">
          {loading && (
            <div className="space-y-2" aria-busy="true">
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
            </div>
          )}

          {lines && (
            <div className="divide-y divide-border rounded-2xl border border-border px-4" data-plan-quote>
              <Row label="Today" value={noCharge ? "$0" : lines.today} strong />
              <Row label="Going forward" value={lines.forward} />
              <Row label="Takes effect" value={noCharge ? "Right away" : lines.when} />
            </div>
          )}

          {preview && !preview.transition.available && preview.transition.blocked && (
            <p className="rounded-xl border border-warning/40 p-3 text-[14px]" data-plan-blocked>
              {preview.transition.blocked}
            </p>
          )}

          {preview && (preview.gain.length > 0 || preview.lose.length > 0) && (
            <div className="space-y-3">
              {preview.gain.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">You'll get</div>
                  <ul className="space-y-1.5">
                    {preview.gain.map((g) => (
                      <li key={g} className="flex gap-2 text-[14px] leading-snug">
                        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.lose.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">You'll no longer have</div>
                  <ul className="space-y-1.5">
                    {preview.lose.map((l) => (
                      <li key={l} className="flex gap-2 text-[14px] leading-snug text-muted-foreground">
                        <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {preview && !isRequest && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden />Always yours, on any plan
              </div>
              <ul className="space-y-1">
                {(preview.keep.length ? preview.keep : ALWAYS_KEPT).map((k) => (
                  <li key={k} className="text-[14px] leading-snug">{k}</li>
                ))}
              </ul>
            </div>
          )}

          {preview && preview.warnings.length > 0 && (
            <ul className="space-y-1.5" data-plan-warnings>
              {preview.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-[14px] leading-snug">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {isRequest && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="Anything your coach should know? (optional)"
              className="min-h-[88px] text-[16px]"
            />
          )}

          {who === "admin" && preview?.transition.kind === "upgrade" && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span className="text-[14px]">
                Switch now, no charge for the rest of this month
                <span className="block text-[13px] text-muted-foreground">Their next renewal is at the new price.</span>
              </span>
              <Switch checked={noCharge} onCheckedChange={setNoCharge} />
            </label>
          )}

          {error && (
            <p className="rounded-xl border border-destructive/40 p-3 text-[14px] text-destructive" role="alert" data-plan-error>
              {error}
            </p>
          )}

          <div className="space-y-2 pt-1">
            <Button className="h-12 w-full text-[15px]" disabled={!preview || !available || busy} onClick={confirm} data-plan-confirm-button>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {action}
            </Button>
            <Button variant="ghost" className="h-11 w-full" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
          </div>
          {preview?.transition.kind === "start" && (
            <p className="text-center text-[12px] text-muted-foreground">Stripe's secure checkout opens next. Tax is added there from your address.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── history ───────────────────────── */

function PlanHistory({ view }: { view: PlanView }) {
  const [open, setOpen] = useState(false);
  if (!view.history.length) return null;
  return (
    <Card className="p-0" data-plan-history>
      <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <History className="h-5 w-5 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-[15px] font-medium">Plan history</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {view.history.map((h) => (
            <li key={h.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium">{h.title}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{day(h.at)}</span>
              </div>
              <div className="text-[13px] text-muted-foreground">
                {h.detail}
                {h.source === "stripe" ? " · in Stripe" : h.source === "admin" ? " · by the coach" : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ───────────────────────── the whole thing ───────────────────────── */

export function PlanManager({ view, api, who, onChanged }: { view: PlanView; api: PlanApi; who: "client" | "admin"; onChanged: () => void }) {
  const [picked, setPicked] = useState<PlanCard | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    if (!view.canChange) {
      toast.info(view.preview ? "Preview only. Only the client can change their plan." : "This plan can't be changed right now.");
      return;
    }
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change the plan");
    } finally {
      setBusy(false);
    }
  };

  const onDone = (r: ConfirmResult) => {
    setPicked(null);
    switch (r.result) {
      case "redirect":
      case "needs_payment":
        window.location.assign(r.url);
        return;
      case "applied":
        toast.success("Your new plan is active");
        break;
      case "scheduled":
        toast.success(`Scheduled for ${billingDay(r.effectiveDate) ?? "your next billing date"}`, { description: "Nothing changes until then. You can undo it any time before." });
        break;
      case "requested":
        toast.success(who === "client" ? "Sent to your coach" : "Request recorded");
        break;
    }
    onChanged();
  };

  const pick = (p: PlanCard) => {
    if (!view.canChange) {
      toast.info(view.preview ? "Preview only. Only the client can change their plan." : "This plan can't be changed right now.");
      return;
    }
    setPicked(p);
  };

  const others = view.options.filter((p) => !(p.transition.kind === "current" && p.transition.blocked === "Your current plan"));
  return (
    <div className="space-y-4" data-plan-manager={who}>
      <CurrentPlanCard view={view} api={api} busy={busy} who={who} onKeep={() => run(api.keep, "You're keeping your plan")} />
      <OpenChangeBanner view={view} busy={busy} onUndo={() => view.open && run(() => api.undo(view.open!.id), "Done. Your plan stays as it was.")} />
      {others.length > 0 && (
        <div className="space-y-3">
          <h2 className="px-1 text-base font-semibold">{who === "client" ? "Other plans" : "Change their plan"}</h2>
          {others.map((p) => (
            <PlanOptionCard key={p.slug} p={p} who={who} canChange={view.canChange} onPick={() => pick(p)} />
          ))}
        </div>
      )}
      <PlanHistory view={view} />
      <ConfirmSheet target={picked} open={!!picked} onOpenChange={(v) => !v && setPicked(null)} api={api} who={who} onDone={onDone} />
    </div>
  );
}
