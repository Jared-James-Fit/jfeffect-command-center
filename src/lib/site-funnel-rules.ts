/**
 * The public site's steps, counted anonymously (Nov 23 2026; pure and tested
 * in coaching-site.test.ts). Each step goes into membership_funnel_events with
 * a random id per browser (join-funnel.ts `visitorId`, never a person), the
 * first place they came from, and a coarse device class. A visitor counts
 * once per step per day, so a refresh never inflates anything.
 *
 * Interest and customers are kept apart on purpose: tapping a package or
 * sending an application is interest; a customer is someone whose
 * application was followed by a sale or a package (coaching_funnel()).
 */

export const SITE_EVENTS = [
  "coaching_view",
  "pricing_view",
  "price_reveal_view",
  "cta_free",
  "cta_coaching",
  "package_select",
  "coaching_apply_start",
  "coaching_apply_step",
  "coaching_apply_submit",
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

export type Device = "phone" | "tablet" | "desktop";

/** A step's detail ("hero", "complete", "goal"): short, lowercase, letters, numbers, ':' '_' '-'. */
export function cleanStep(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40);
}

/** Phone, tablet or desktop from the screen's short side and the pointer, never a fingerprint. */
export function deviceClass(shortSide: number, coarsePointer: boolean): Device {
  if (shortSide < 600) return "phone";
  if (coarsePointer || shortSide < 900) return "tablet";
  return "desktop";
}

/** The admin's read of coaching_funnel(), with every count a number. */
export type CoachingFunnel = {
  landingVisitors: number;
  coachingVisitors: number;
  pricingViews: number;
  /** Saw the home page's price reveal (Coaching Plus, then Complete Online Coaching). */
  revealViews: number;
  ctaFree: number;
  ctaCoaching: number;
  freeStarts: number;
  freeSent: number;
  applyStarts: number;
  applySent: number;
  applySteps: Record<string, number>;
  packageTaps: Record<string, number>;
  applications: number;
  applicationsByPackage: Record<string, number>;
  customers: number;
  customersByPackage: Record<string, number>;
  devices: Array<{ device: string; visitors: number; joinedFree: number; applied: number }>;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const counts = (v: unknown): Record<string, number> =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, n]) => [k, num(n)])) : {};

export function readCoachingFunnel(raw: unknown): CoachingFunnel {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    landingVisitors: num(r.landing_visitors),
    coachingVisitors: num(r.coaching_visitors),
    pricingViews: num(r.pricing_views),
    revealViews: num(r.reveal_views),
    ctaFree: num(r.cta_free),
    ctaCoaching: num(r.cta_coaching),
    freeStarts: num(r.free_starts),
    freeSent: num(r.free_sent),
    applyStarts: num(r.apply_starts),
    applySent: num(r.apply_sent),
    applySteps: counts(r.apply_steps),
    packageTaps: counts(r.package_taps),
    applications: num(r.applications),
    applicationsByPackage: counts(r.applications_by_package),
    customers: num(r.customers),
    customersByPackage: counts(r.customers_by_package),
    devices: Array.isArray(r.devices)
      ? (r.devices as Array<Record<string, unknown>>).map((d) => ({
          device: String(d.device ?? "unknown"),
          visitors: num(d.visitors),
          joinedFree: num(d.joined_free),
          applied: num(d.applied),
        }))
      : [],
  };
}

/** "12%" (or "–" with nothing to divide by): a share said plainly. */
export function rate(part: number, whole: number): string {
  if (!whole) return "–";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}
