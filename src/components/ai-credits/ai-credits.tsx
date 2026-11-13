/**
 * AI credits in the app: where they show and how more are bought.
 *
 *   AiCreditsChip     beside an AI action ("12 left"), the moment it matters
 *   AiCreditsSheet    opens from the chip, or by itself when an AI action is
 *                     refused for credits: the balance, when the free ones
 *                     come back, and the packs
 *   AiCreditsPanel    the same content, inside Account → AI credits
 *   AiCreditsReturn   back from Stripe: adds the pack's credits and says so
 *
 * Packs are sold on the web only: the App Store and Play builds never offer
 * a purchase (digital goods sold inside them must go through Apple / Google),
 * and say the free credits' reset date instead. A coach viewing as a client
 * sees that client's credits and can't buy for them.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PlusTax } from "@/components/billing/plus-tax";
import { cn } from "@/lib/utils";
import { isNative } from "@/platform";
import { usePovArgs } from "@/lib/client-pov-args";
import { useViewingAsClient } from "@/lib/client-impersonation";
import {
  confirmAiCreditsCheckout,
  getAiCredits,
  startAiCreditsCheckout,
} from "@/lib/ai-credits.functions";
import {
  CREDIT_PACKS,
  FEATURE_LABEL,
  chipLabel,
  creditsBreakdown,
  creditsNumber,
  packPrice,
  perCredit,
  resetDay,
  resetLine,
  type AiFeature,
  type CreditDetail,
  type CreditPack,
  type CreditState,
} from "@/lib/ai-credits/packs";

export const AI_CREDITS_KEY = "ai-credits";

/** The person's credits (the viewed client's while a coach views as them). */
export function useAiCredits(enabled = true) {
  const pov = usePovArgs();
  const fetchCredits = useServerFn(getAiCredits);
  return useQuery({
    queryKey: [AI_CREDITS_KEY, pov.viewAsUserId ?? "me"],
    queryFn: () =>
      fetchCredits({ data: { viewAsUserId: pov.viewAsUserId ?? null } }) as Promise<CreditDetail>,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Put a fresher state (an AI reply carries one) into the cache, keeping the history the reply doesn't. */
export function useSetCreditState() {
  const qc = useQueryClient();
  const pov = usePovArgs();
  return (state: CreditState | null | undefined) => {
    if (!state) return;
    // An AI reply carries the signed-in person's credits: a coach previewing a
    // client runs it as themselves (never spending the client's), so the
    // client's count on screen stays as it is.
    if (pov.viewAsUserId) return;
    qc.setQueryData(
      [AI_CREDITS_KEY, "me"],
      (old: CreditDetail | undefined) => ({ ...(old ?? {}), ...state }) as CreditDetail,
    );
  };
}

/** "12 left" beside an AI action. Nothing for staff, or before it's known. */
export function AiCreditsChip({
  state,
  onClick,
  className,
}: {
  state: CreditState | null | undefined;
  onClick: () => void;
  className?: string;
}) {
  const label = chipLabel(state);
  if (!label) return null;
  const out = (state?.left ?? 0) <= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      data-ai-credits-chip
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[12px] font-medium tabular-nums",
        out ? "text-warning" : "text-muted-foreground",
        className,
      )}
      aria-label={`AI credits: ${label}`}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

/** The balance, the reset date, and (on the web) the packs. */
export function AiCreditsPanel({
  state,
  out,
  feature,
}: {
  state: CreditDetail | CreditState | null | undefined;
  out?: boolean;
  feature?: AiFeature;
}) {
  const native = isNative();
  const preview = useViewingAsClient();
  const start = useServerFn(startAiCreditsCheckout);
  const [busy, setBusy] = useState<string | null>(null);

  if (!state) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (state.unlimited) {
    return (
      <p className="text-[15px] text-muted-foreground" data-ai-credits-unlimited>
        Staff accounts have unlimited AI credits.
      </p>
    );
  }

  const buy = async (pack: CreditPack) => {
    if (busy) return;
    if (preview) {
      toast("Preview only. You can't buy credits for them.");
      return;
    }
    setBusy(pack.key);
    try {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const { url } = await start({
        data: { pack: pack.key, origin: window.location.origin, returnPath },
      });
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open checkout");
      setBusy(null);
    }
  };

  const detail = state as CreditDetail;
  const used = detail.uses_this_month ?? {};
  const usedLines = (Object.keys(used) as AiFeature[])
    .filter((f) => (used[f] ?? 0) > 0 && FEATURE_LABEL[f])
    .map(
      (f) =>
        `${creditsNumber(used[f]!)} ${used[f] === 1 ? FEATURE_LABEL[f].one : FEATURE_LABEL[f].many}`,
    );
  const history = detail.history ?? [];
  const what = FEATURE_LABEL[feature ?? "meal_estimate"].one;

  return (
    <div className="space-y-5" data-ai-credits-panel>
      <div>
        {out ? (
          <>
            <div className="text-[17px] font-semibold">You've used this month's AI credits</div>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {native || preview
                ? `Your free credits come back ${resetDay(state.resets_on)}.`
                : `Get more below, or your free credits come back ${resetDay(state.resets_on)}.`}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span
                className="text-[34px] font-semibold leading-none tabular-nums"
                data-ai-credits-left
              >
                {creditsNumber(state.left ?? 0)}
              </span>
              <span className="text-[15px] text-muted-foreground">AI credits left</span>
            </div>
            <p className="mt-2 text-[14px] text-muted-foreground">{creditsBreakdown(state)}</p>
          </>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          {resetLine(state)} 1 credit = 1 {what}.
        </p>
      </div>

      {native ? (
        <p className="text-[13px] text-muted-foreground" data-ai-credits-native>
          Purchases aren't available in the app.
        </p>
      ) : (
        <div className="space-y-2" data-ai-credits-packs>
          <div className="text-[15px] font-semibold">Get more credits</div>
          {CREDIT_PACKS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={!!busy}
              onClick={() => void buy(p)}
              data-ai-credits-pack={p.key}
              className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium">
                    {creditsNumber(p.credits)} credits
                  </span>
                  {p.tag && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {p.tag}
                    </span>
                  )}
                </span>
                <span className="block text-[12px] text-muted-foreground">{perCredit(p)}</span>
              </span>
              <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">
                {busy === p.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {packPrice(p)}
                    <PlusTax className="text-[12px]" />
                  </>
                )}
              </span>
            </button>
          ))}
          <p className="text-[12px] text-muted-foreground">
            Paid securely with Stripe. Credits are added as soon as it's paid and never expire.
          </p>
        </div>
      )}

      {(usedLines.length > 0 || history.length > 0) && (
        <div
          className="space-y-1.5 border-t border-border pt-4 text-[13px]"
          data-ai-credits-history
        >
          {usedLines.length > 0 && (
            <div className="text-muted-foreground">This month: {usedLines.join(" · ")}</div>
          )}
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {h.kind === "purchase"
                  ? "Bought"
                  : h.kind === "reversal"
                    ? "Refunded"
                    : h.note || "From your coach"}
                <span className="text-muted-foreground">
                  {" "}
                  · {new Date(h.at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  h.credits > 0 ? "text-success" : "text-muted-foreground",
                )}
              >
                {h.credits > 0 ? "+" : "−"}
                {creditsNumber(Math.abs(h.credits))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The credits as a bottom sheet: from the chip, or by itself when an AI action was refused for credits. */
export function AiCreditsSheet({
  open,
  onOpenChange,
  out,
  feature,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  out?: boolean;
  feature?: AiFeature;
}) {
  const q = useAiCredits(open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88svh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="mb-4 text-left">
          <SheetTitle>AI credits</SheetTitle>
          <SheetDescription className="sr-only">
            Your AI credits and how to get more.
          </SheetDescription>
        </SheetHeader>
        {q.error ? (
          <p className="text-sm text-destructive">
            {String((q.error as any)?.message ?? "Couldn't load your credits")}
          </p>
        ) : (
          <AiCreditsPanel
            state={q.data}
            out={out && !!q.data && !q.data.unlimited && (q.data.left ?? 0) <= 0}
            feature={feature}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Back from Stripe (`?credits=done&cs=…`): add the pack's credits now (the
 * webhook does it too, whichever is first counts once), say so, and tidy the
 * address. `?credits=cancelled` just tidies it.
 */
export function AiCreditsReturn() {
  const confirm = useServerFn(confirmAiCreditsCheckout);
  const qc = useQueryClient();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("credits");
    if (flag !== "done" && flag !== "cancelled") return;
    ran.current = true;
    const sessionId = url.searchParams.get("cs");
    url.searchParams.delete("credits");
    url.searchParams.delete("cs");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (flag !== "done" || !sessionId) return;
    void (async () => {
      try {
        const r = await confirm({ data: { sessionId } });
        if (r.pending)
          toast("Your payment is processing. Your credits show up as soon as it clears.");
        else toast.success(`${creditsNumber(r.credits)} AI credits added`);
      } catch (e: any) {
        toast.error(
          e?.message ??
            "Couldn't add your credits yet. They'll show up once Stripe confirms the payment.",
        );
      } finally {
        void qc.invalidateQueries({ queryKey: [AI_CREDITS_KEY] });
      }
    })();
  }, [confirm, qc]);
  return null;
}
