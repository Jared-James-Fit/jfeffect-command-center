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
  className,
}: {
  packages: readonly PublicPackage[];
  from?: string;
  calls?: boolean;
  /** Put the free app first, as one of the options. */
  free?: boolean;
  className?: string;
}) {
  const listed = listedPackages(packages);
  const plans = optionCards(packages, { free: showFree });
  const calls = showCalls ? listed.filter((p) => p.kind === "one_time") : [];
  if (!plans.length && !calls.length) return null;
  const four = plans.length >= 4;
  return (
    <div className={className} data-coaching-packages>
      {plans.length > 0 && (
        <div
          className={cn(
            "mx-auto grid gap-4",
            plans.length === 1 && "max-w-md",
            plans.length === 2 && "max-w-3xl md:grid-cols-2",
            plans.length === 3 && "max-w-md lg:max-w-5xl lg:grid-cols-3",
            four && "max-w-md md:max-w-3xl md:grid-cols-2 xl:max-w-6xl xl:grid-cols-4",
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
