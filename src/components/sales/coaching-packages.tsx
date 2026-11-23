import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackSite } from "@/lib/site-funnel";
import {
  APPLY_PATH,
  FREE_JOIN_PATH,
  TAX_NOTE,
  anchorLine,
  callsLine,
  ctaText,
  intervalLabel,
  listedPackages,
  optionCards,
  priceLabel,
  shortPlanName,
  type PublicPackage,
} from "@/lib/coaching-packages/packages";

/**
 * A coaching package as a card: the public pages and the admin toolkit's
 * preview draw the same component, so what the coach previews is what goes
 * live. The recommended package is the one card in the brand's inverted look;
 * the rest are plain. Prices always say CAD plus applicable tax (the public
 * can't ask whether tax applies, and the wording holds either way). The
 * recommended card can carry one honest anchor (`anchor`: how much more it is
 * than the next package on the site, both listed prices), never a crossed-out
 * price or a "worth" number.
 */
export function PackageCard({
  pkg,
  from,
  anchor,
  preview = false,
  compact = false,
  className,
}: {
  pkg: PublicPackage;
  /** Where the click came from (the application's attribution). */
  from?: string;
  /** "$31 more than Nutrition Coaching" (anchorLine), on the recommended card only. */
  anchor?: string | null;
  /** In the admin preview the button goes nowhere. */
  preview?: boolean;
  /** Four side by side: a little tighter, so a whole card fits a phone's screen. */
  compact?: boolean;
  className?: string;
}) {
  const featured = pkg.recommended && pkg.kind !== "free";
  const muted = featured ? "text-background/70" : "text-muted-foreground";
  const calls = callsLine(pkg);
  const showCalls = calls && !pkg.features.some((f) => /call/i.test(f));
  const price = pkg.kind === "free" ? "$0" : pkg.priceCents ? priceLabel(pkg.priceCents) : "No price yet";
  const cta = ctaText(pkg);
  const btn = cn(
    "inline-flex w-full items-center justify-center rounded-2xl px-6 text-[16px] font-semibold transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    compact ? "h-12" : "h-[52px]",
    featured ? "bg-background text-foreground" : "bg-secondary text-foreground hover:bg-secondary/80",
  );
  return (
    <article
      data-package={pkg.slug}
      data-recommended={featured || undefined}
      className={cn(
        "relative flex flex-col rounded-[28px] text-left",
        compact ? "p-6 sm:p-7" : "p-7 sm:p-8",
        featured ? "bg-foreground text-background" : "bg-card text-foreground ring-1 ring-border",
        className,
      )}
    >
      {featured && (
        <span className="mb-3 inline-flex w-fit rounded-full bg-background/15 px-2.5 py-1 text-[12px] font-semibold" data-package-recommended>
          Recommended
        </span>
      )}
      <h3 className={cn("font-semibold leading-tight tracking-[-0.02em]", compact ? "text-[20px]" : "text-[22px]")}>{pkg.name}</h3>
      {pkg.tagline && <p className={cn("mt-2 text-[15px] leading-relaxed", muted)}>{pkg.tagline}</p>}

      <div className={cn("flex items-baseline gap-1", compact ? "mt-5" : "mt-6")} data-package-price>
        <span className={cn("font-semibold leading-none tracking-[-0.035em] tabular-nums", compact ? "text-[44px]" : "text-[48px]")}>{price}</span>
        {intervalLabel(pkg) && <span className={cn("text-[17px] font-medium", muted)}>{intervalLabel(pkg)}</span>}
      </div>
      <p className={cn("mt-2 text-[13px]", muted)} data-package-tax>
        {pkg.kind === "free" ? "No card, nothing to cancel" : TAX_NOTE}
      </p>
      {anchor && (
        <p
          className={cn(
            "mt-4 inline-flex w-fit rounded-full px-3 py-1.5 text-[13px] font-semibold",
            featured ? "bg-background/15 text-background" : "bg-secondary text-foreground",
          )}
          data-package-anchor
        >
          {anchor}
        </p>
      )}

      {(pkg.features.length > 0 || showCalls) && (
        <ul className={cn("text-[15px] leading-snug", compact ? "mt-5 space-y-2.5" : "mt-6 space-y-3")}>
          {pkg.features.map((f) => (
            <li key={f} className="flex items-start gap-3">
              <Check className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", featured ? "text-background" : "text-success")} aria-hidden />
              <span>{f}</span>
            </li>
          ))}
          {showCalls && (
            <li className="flex items-start gap-3">
              <Video className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", featured ? "text-background" : "text-success")} aria-hidden />
              <span>{calls}</span>
            </li>
          )}
        </ul>
      )}

      <div className={cn("mt-auto", compact ? "pt-7" : "pt-8")}>
        {preview ? (
          <span className={btn} aria-hidden>
            {cta}
          </span>
        ) : pkg.kind === "free" ? (
          <Link to={FREE_JOIN_PATH} className={btn} data-package-cta onClick={() => trackSite("cta_free", from ? `package:${from}` : "package")}>
            {cta}
          </Link>
        ) : (
          <Link
            to={APPLY_PATH}
            search={{ package: pkg.slug, ...(from ? { from } : {}) } as never}
            className={btn}
            data-package-cta
            onClick={() => trackSite("package_select", pkg.slug)}
          >
            {cta}
          </Link>
        )}
      </div>
    </article>
  );
}

/** A one-time call, as one row. */
function CallRow({ pkg, from }: { pkg: PublicPackage; from?: string }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-package={pkg.slug}>
      <div>
        <p className="text-[16px] font-semibold">{pkg.name}</p>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          {[pkg.tagline, `${pkg.callMinutes} min`, pkg.priceCents ? `${priceLabel(pkg.priceCents)} ${TAX_NOTE}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <Link
        to={APPLY_PATH}
        search={{ package: pkg.slug, ...(from ? { from } : {}) } as never}
        className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-secondary px-5 text-[15px] font-semibold"
        onClick={() => trackSite("package_select", pkg.slug)}
      >
        {ctaText(pkg)}
      </Link>
    </li>
  );
}

/**
 * Every plan on a phone, as one selection: a switch with each plan's name and
 * price (the comparison at a glance) over a row of the same cards, swiped or
 * picked from the switch. Tablets and computers get the cards side by side
 * instead (CoachingPackagesGrid hides this from md up). It opens on the first
 * plan, the free app, so the plans read in order: free, then each step up.
 */
function PlanChooser({ plans, from }: { plans: PublicPackage[]; from?: string }) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof IntersectionObserver === "undefined") return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-chooser-card]"));
    // the plan lit is the card nearest the row's middle, whichever card last crossed a line
    const pick = () => {
      const r = rail.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      let best = 0;
      let gap = Infinity;
      cards.forEach((c, i) => {
        const b = c.getBoundingClientRect();
        const d = Math.abs(b.left + b.width / 2 - mid);
        if (d < gap) {
          gap = d;
          best = i;
        }
      });
      setActive(best);
    };
    const io = new IntersectionObserver(pick, { root: rail, threshold: [0.2, 0.5, 0.8] });
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [plans.length]);

  const go = (i: number) => {
    const rail = railRef.current;
    const card = rail?.querySelectorAll<HTMLElement>("[data-chooser-card]")[i];
    if (!rail || !card) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2, behavior: still ? "auto" : "smooth" });
    setActive(i);
  };

  return (
    <div className="md:hidden" data-plan-chooser>
      <div
        role="group"
        aria-label="Plans"
        className="mx-auto grid max-w-md gap-1 rounded-2xl bg-muted/70 p-1"
        style={{ gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))` }}
      >
        {plans.map((p, i) => (
          <button
            key={p.slug}
            type="button"
            aria-pressed={active === i}
            aria-controls={`plan-card-${p.slug}`}
            aria-label={`${p.name}, ${p.kind === "free" ? "free" : `${priceLabel(p.priceCents)}${intervalLabel(p)}`}`}
            onClick={() => go(i)}
            className={cn(
              "flex min-h-[58px] flex-col items-center justify-center rounded-xl px-1 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              active === i ? "bg-background text-foreground ring-1 ring-border" : "text-muted-foreground",
            )}
            data-chooser-tab={p.slug}
          >
            <span className="text-[12px] font-medium leading-tight">{shortPlanName(p.name)}</span>
            <span className="mt-0.5 text-[17px] font-semibold leading-none tabular-nums text-foreground">
              {p.kind === "free" ? "$0" : priceLabel(p.priceCents)}
            </span>
          </button>
        ))}
      </div>
      <div
        ref={railRef}
        role="region"
        aria-label="Plan details"
        tabIndex={0}
        className="relative -mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
      >
        {plans.map((p) => (
          <div key={p.slug} id={`plan-card-${p.slug}`} className="flex w-[86%] max-w-[360px] shrink-0 snap-center" data-chooser-card>
            <PackageCard pkg={p} from={from} compact anchor={anchorLine(p, plans)} className="w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The packages on the site, as cards in price order: the monthly packages, and
 * with `free` the free app first, so every way in sits side by side (the
 * landing page's four: Free · Nutrition · Complete · Plus). One-time calls are
 * rows under them unless `calls` is off (the landing page keeps them off so
 * nothing pulls attention from the monthly packages). Four cards are four
 * across on a wide screen, two by two on a tablet and one under another on a
 * phone, a little tighter (`compact`); the recommended one is the inverted
 * card, raised where they sit in one row. Nothing renders when no paid package
 * is listed or they couldn't be read: the page around it still makes sense.
 */
export function CoachingPackagesGrid({
  packages,
  from,
  calls: showCalls = true,
  free: showFree = false,
  chooser = false,
  className,
}: {
  packages: readonly PublicPackage[];
  from?: string;
  calls?: boolean;
  /** Put the free app first, as one of the options. */
  free?: boolean;
  /** On a phone, every plan as one selection (a switch over a row of cards) instead of a stack of cards. */
  chooser?: boolean;
  className?: string;
}) {
  const listed = listedPackages(packages);
  const plans = optionCards(packages, { free: showFree });
  const calls = showCalls ? listed.filter((p) => p.kind === "one_time") : [];
  if (!plans.length && !calls.length) return null;
  const four = plans.length >= 4;
  const choose = chooser && plans.length > 1;
  return (
    <div className={className} data-coaching-packages>
      {choose && <PlanChooser plans={plans} from={from} />}
      {plans.length > 0 && (
        <div
          className={cn(
            "mx-auto grid gap-4",
            plans.length === 1 && "max-w-md",
            plans.length === 2 && "max-w-3xl md:grid-cols-2",
            plans.length === 3 && "max-w-md lg:max-w-5xl lg:grid-cols-3",
            four && "max-w-md md:max-w-3xl md:grid-cols-2 xl:max-w-6xl xl:grid-cols-4",
            choose && "hidden md:grid",
          )}
          data-package-count={plans.length}
        >
          {plans.map((p) => (
            <PackageCard
              key={p.slug}
              pkg={p}
              from={from}
              compact={four}
              anchor={anchorLine(p, plans)}
              className={
                p.recommended && p.kind !== "free"
                  ? four
                    ? "xl:-my-4 xl:py-10"
                    : plans.length === 3
                      ? "lg:-my-4 lg:py-10"
                      : undefined
                  : undefined
              }
            />
          ))}
        </div>
      )}
      {calls.length > 0 && (
        <div className="mx-auto mt-10 max-w-3xl">
          <h3 className="text-[17px] font-semibold">Or book a single call</h3>
          <ul className="mt-1 divide-y divide-border">
            {calls.map((p) => (
              <CallRow key={p.slug} pkg={p} from={from} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
