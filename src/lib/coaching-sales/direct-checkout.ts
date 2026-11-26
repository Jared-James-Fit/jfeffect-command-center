/**
 * "Ready to start" on the site: a coaching package bought with a short intake
 * and Stripe's own checkout, beside "Want to talk first" (the application and
 * the discovery call). Pure, so the page, the server and the tests share the
 * rules: what's asked, what the visitor agrees to before paying, and when the
 * path is offered at all.
 */
import { APPLY_GOALS, OUTCOME_MAX, clip, emailOk, phoneOk } from "@/lib/apply-form";
import { AGREEMENT_PUBLIC_URL } from "@/lib/coaching-agreement/checkout-notice";
import { priceLabel } from "@/lib/coaching-packages/packages";

export type DirectIntake = {
  full_name: string;
  email: string;
  phone: string;
  main_goal: string;
  target_outcome: string;
};

export const EMPTY_INTAKE: DirectIntake = { full_name: "", email: "", phone: "", main_goal: "", target_outcome: "" };

/** The one problem with the intake to show, else null (the server checks the same). */
export function intakeError(i: DirectIntake): string | null {
  const name = i.full_name.trim();
  if (name.length < 2) return "Add your name.";
  if (!emailOk(i.email)) return "Add an email that works: it's where your account setup goes.";
  if (i.phone.trim() && !phoneOk(i.phone)) return "Add a phone number with the area code, or leave it empty.";
  if (!APPLY_GOALS.some((g) => g.v === i.main_goal)) return "Pick what you want help with.";
  if (i.target_outcome.length > OUTCOME_MAX) return `Keep it under ${OUTCOME_MAX} characters.`;
  return null;
}

/** Trimmed and clipped, the way the server stores it. */
export function cleanIntake(i: DirectIntake): DirectIntake {
  return {
    full_name: clip(i.full_name.trim().replace(/\s+/g, " "), 120),
    email: clip(i.email.trim().toLowerCase(), 200),
    phone: clip(i.phone.trim(), 40),
    main_goal: i.main_goal,
    target_outcome: clip(i.target_outcome.trim(), OUTCOME_MAX),
  };
}

export type TermsPackage = { name: string; priceCents: number | null; currency?: string | null };

/**
 * What a recurring purchase means, said before Pay (the Coaching Agreement 3.0
 * terms the plan system already follows: monthly until cancelled, cancel in the
 * app or by email, it ends at the end of the paid month). Refunds are the
 * agreement's, linked, never restated here.
 */
export function recurringTerms(p: TermsPackage): string[] {
  const price = p.priceCents ? `${priceLabel(p.priceCents)} ${(p.currency || "CAD").toUpperCase()}` : "the listed price";
  return [
    `${p.name} is a monthly subscription: ${price} plus applicable tax today, then the same every month on that date until you cancel.`,
    "Cancel any time in the app (Account → Your plan) or by email. Coaching runs to the end of the month you've paid for and nothing more is charged.",
    "Tax is worked out from your billing address at checkout. Your card is handled by Stripe; JF Effect never sees it.",
    `By paying you agree to the JF Effect Coaching Agreement (${AGREEMENT_PUBLIC_URL}), including its payment, cancellation and refund terms.`,
  ];
}

/** The exact words kept on the purchase as what they agreed to. */
export function consentText(p: TermsPackage): string {
  return `I agree: ${recurringTerms(p).join(" ")}`;
}

export type GateInput = {
  /** The package has direct checkout on, is a listed monthly coaching package. */
  packageOn: boolean;
  /** configProblem for the package (no Stripe price, mismatch…), else null. */
  problem: string | null;
  /** Which kind of key the server would charge with (null = no key). */
  keyMode: "test" | "live" | null;
  /** app_settings 'coaching_direct_checkout.live_enabled' = 'true'. */
  liveEnabled: boolean;
};

export type Gate = { available: true; mode: "test" | "live" } | { available: false; reason: "off" | "not_ready" | "no_stripe" | "live_off" };

/**
 * Whether "Ready to start" is offered. Never without a Stripe key, never for a
 * package that can't be sold, and against live Stripe only once the owner
 * switches it on (a test key always works, for testing end to end).
 */
export function directCheckoutGate(g: GateInput): Gate {
  if (!g.packageOn) return { available: false, reason: "off" };
  if (g.problem) return { available: false, reason: "not_ready" };
  if (!g.keyMode) return { available: false, reason: "no_stripe" };
  if (g.keyMode === "live" && !g.liveEnabled) return { available: false, reason: "live_off" };
  return { available: true, mode: g.keyMode };
}

/** Back from Stripe (`/coaching/apply?checkout=paid|cancelled`): what the page says. It never grants access. */
export function returnState(checkout: string | null | undefined): "paid" | "cancelled" | "none" {
  if (checkout === "paid") return "paid";
  if (checkout === "cancelled") return "cancelled";
  return "none";
}
