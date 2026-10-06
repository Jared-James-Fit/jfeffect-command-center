/**
 * The one-line agreement notice shown above the Pay button on Stripe Checkout.
 *
 * The agreement the client signs in the app is the contract for every purchase, so
 * Checkout only needs to point at it. Stripe renders Markdown links in custom text
 * and allows up to 1200 characters. Pure strings so it can be unit tested.
 */
export const AGREEMENT_PUBLIC_URL = "https://jfeffect.com/coaching-agreement";

export const AGREEMENT_CHECKOUT_NOTICE = `By paying, you agree to the [JF Effect Coaching Agreement](${AGREEMENT_PUBLIC_URL}), including its payment, cancellation and refund terms.`;

/** Form-encoded Stripe params; spread into a Checkout Session body. */
export const AGREEMENT_CHECKOUT_PARAMS: Readonly<Record<string, string>> = {
  "custom_text[submit][message]": AGREEMENT_CHECKOUT_NOTICE,
};
