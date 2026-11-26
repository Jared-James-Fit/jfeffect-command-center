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

/**
 * The words beside the box (links are drawn by the screen around "Terms of Service", "Crew
 * community guidelines" and "Privacy Policy"). The guidelines are part of the Terms and agreed
 * to here, once, so nothing asks for them in the middle of a comment (Nov 26 2026).
 */
export const SIGNUP_ACK_TEXT = "I agree to the JF Effect Terms of Service, including the Crew community guidelines, and the Privacy Policy.";

/** The Crew community guidelines' version: the database's `crew_rules_version()`, kept in community_rules_acceptances. */
export const CREW_GUIDELINES_VERSION = 1;

/** What the screen says when they tap Create without ticking it. */
export const SIGNUP_ACK_MISSING = "Tick the box to agree to the Terms and Privacy Policy.";
