/**
 * What someone agrees to when they make a JF Effect account, and the words
 * they tick. One place for the sign-up screen and the server that records it
 * (legal-signup.server.ts), so the record always says exactly what was shown.
 *
 * The box starts unticked: agreeing is something they do, never something
 * assumed by tapping "Create my account".
 */
export const SIGNUP_LEGAL_SLUGS = ["terms-of-service", "privacy-policy"] as const;
export type SignupLegalSlug = (typeof SIGNUP_LEGAL_SLUGS)[number];

/** The words beside the box (links are drawn by the screen around "Terms" and "Privacy Policy"). */
export const SIGNUP_ACK_TEXT = "I agree to the JF Effect Terms of Service and Privacy Policy.";

/** What the screen says when they tap Create without ticking it. */
export const SIGNUP_ACK_MISSING = "Tick the box to agree to the Terms and Privacy Policy.";
