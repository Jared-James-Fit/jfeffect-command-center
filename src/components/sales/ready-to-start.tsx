/**
 * The two ways into a package the coach sells straight from the site:
 * "Ready to start" (a short intake, the recurring terms, then Stripe's own
 * checkout) and "Want to talk first" (the application and the discovery call).
 * Rules in coaching-sales/direct-checkout.ts. Nothing here charges or grants
 * anything: the webhook does, once Stripe confirms the payment.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CalendarClock, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { APPLY_GOALS } from "@/lib/apply-form";
import { TAX_NOTE, intervalLabel, priceLabel, type PublicPackage } from "@/lib/coaching-packages/packages";
import { EMPTY_INTAKE, intakeError, type DirectIntake } from "@/lib/coaching-sales/direct-checkout";
import { startDirectCoachingCheckout, type DirectCheckoutOffer } from "@/lib/coaching-sales/direct-checkout.functions";
import { trackSite } from "@/lib/site-funnel";
import { goToPayment } from "@/lib/native-purchases";

export function StartChooser({
  pkg,
  onReady,
  onTalk,
}: {
  pkg: PublicPackage;
  onReady: () => void;
  onTalk: () => void;
}) {
  return (
    <div className="mt-6" data-start-chooser={pkg.slug}>
      <p className="text-[13px] font-semibold text-primary">JF Effect Coaching</p>
      <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em]">How do you want to start?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        {pkg.name}
        {pkg.priceCents ? ` · ${priceLabel(pkg.priceCents)}${intervalLabel(pkg)} · ${TAX_NOTE}` : ""}
      </p>
      <div className="mt-6 grid gap-3">
        <button
          type="button"
          onClick={() => {
            trackSite("coaching_apply_step", "path:ready");
            onReady();
          }}
          className="flex min-h-[72px] w-full flex-col items-start justify-center rounded-2xl bg-primary px-5 py-3 text-left text-primary-foreground shadow-sm transition active:scale-[0.99]"
        >
          <span className="text-[17px] font-semibold">Ready to start</span>
          <span className="text-[14px] opacity-90">A few details, then secure checkout. Setup starts right after.</span>
        </button>
        <button
          type="button"
          onClick={() => {
            trackSite("coaching_apply_step", "path:talk");
            onTalk();
          }}
          className="flex min-h-[72px] w-full flex-col items-start justify-center rounded-2xl bg-muted/60 px-5 py-3 text-left ring-1 ring-border/70 transition hover:bg-muted active:scale-[0.99]"
        >
          <span className="text-[17px] font-semibold">Want to talk first</span>
          <span className="text-[14px] text-muted-foreground">A few questions, then pick a time for a short call. Nothing is charged.</span>
        </button>
      </div>
    </div>
  );
}

export function ReadyToStart({
  pkg,
  offer,
  sourcePage,
  onBack,
  onTalk,
}: {
  pkg: PublicPackage;
  offer: DirectCheckoutOffer;
  sourcePage: string;
  onBack: () => void;
  onTalk: () => void;
}) {
  const start = useServerFn(startDirectCoachingCheckout);
  const [intake, setIntake] = useState<DirectIntake>(EMPTY_INTAKE);
  const [agree, setAgree] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offerCall, setOfferCall] = useState(false);
  const set = (k: keyof DirectIntake, v: string) => {
    setIntake((i) => ({ ...i, [k]: v }));
    setError(null);
  };

  const go = useMutation({
    mutationFn: () =>
      start({
        data: {
          package: pkg.slug,
          ...intake,
          agree: true as const,
          honeypot,
          origin: window.location.origin,
          source_page: sourcePage,
          page_url: window.location.href,
          referrer: document.referrer,
        },
      }),
    onSuccess: (r) => {
      if (r.ok) {
        trackSite("coaching_apply_step", "path:checkout");
        goToPayment(r.url);
        return;
      }
      setError(r.message);
      setOfferCall(!!r.book);
    },
    onError: () => {
      setError("Checkout couldn't be opened. Nothing was charged; please try again.");
      setOfferCall(true);
    },
  });

  const submit = () => {
    const problem = intakeError(intake) ?? (agree ? null : "Tick that you understand the monthly billing, then continue.");
    if (problem) {
      setError(problem);
      return;
    }
    go.mutate();
  };

  const field = "h-14 rounded-2xl bg-background px-4 text-[18px] md:text-[18px]";
  return (
    <div className="mt-2" data-ready-to-start={pkg.slug}>
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-[15px] font-medium text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em]">Start {pkg.name}</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {offer.priceCents ? `${priceLabel(offer.priceCents)}${intervalLabel(pkg)} · ${TAX_NOTE}` : TAX_NOTE}
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mt-6 grid gap-3"
      >
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="hidden"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
        <label className="grid gap-1.5">
          <span className="text-[14px] font-medium">Your name</span>
          <Input className={field} autoComplete="name" value={intake.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="First and last name" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[14px] font-medium">Email</span>
          <Input className={field} type="email" inputMode="email" autoComplete="email" value={intake.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
          <span className="text-[13px] text-muted-foreground">Your account setup goes here.</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[14px] font-medium">Phone (optional)</span>
          <Input className={field} type="tel" inputMode="tel" autoComplete="tel" value={intake.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(204) 555-0123" />
        </label>
        <div className="grid gap-1.5">
          <span className="text-[14px] font-medium" id="ready-goal">What do you want help with?</span>
          <div role="radiogroup" aria-labelledby="ready-goal" className="flex flex-wrap gap-2">
            {APPLY_GOALS.map((g) => {
              const on = intake.main_goal === g.v;
              return (
                <button
                  key={g.v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("main_goal", g.v)}
                  className={cn(
                    "min-h-[44px] rounded-full px-4 text-[15px] font-medium transition active:scale-[0.98]",
                    on ? "bg-primary text-primary-foreground" : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
                  )}
                >
                  {g.l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-muted/60 p-4 ring-1 ring-border/70" data-recurring-terms>
          <p className="text-[14px] font-semibold">Before you pay</p>
          <ul className="mt-2 grid gap-2 text-[14px] leading-relaxed text-muted-foreground">
            {offer.terms.map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-[44px] items-start gap-3 text-[15px]">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
              checked={agree}
              onChange={(e) => {
                setAgree(e.target.checked);
                setError(null);
              }}
            />
            <span>I understand this is a monthly subscription until I cancel, and I agree to the terms above.</span>
          </label>
        </div>

        {error && (
          <p role="alert" className="text-[14px] font-medium text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={go.isPending}
          className="mt-1 inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[17px] font-semibold text-primary-foreground shadow-sm transition active:scale-[0.99] disabled:opacity-70"
        >
          {go.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          Continue to secure checkout
        </button>
        <button
            type="button"
            onClick={onTalk}
            className={cn(
              "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full text-[15px] font-medium transition",
              offerCall ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarClock className="h-4 w-4" aria-hidden /> Rather talk first? Book a call
          </button>
      </form>
    </div>
  );
}
