import type { AgreementStateResponse } from "@/lib/coaching-agreement.functions";
import type { ExemptKind } from "@/lib/coaching-agreement/rules";

export type AgreementPrompt = {
  title: string;
  body: string;
  /** A note from the coach, shown when they sent the agreement themselves. */
  note: string | null;
  tone: "first" | "update" | "requested";
};

/**
 * One place for the wording the popup, dashboard card, checklist and account page
 * share, so a client never sees three different explanations of the same thing.
 */
export function agreementPrompt(state: AgreementStateResponse | undefined): AgreementPrompt {
  const needs = state?.state?.state === "needs_signature" ? state.state : null;
  const hadLegacy = !!state?.legacy.signed;

  if (needs?.reason === "admin_request") {
    return {
      tone: "requested",
      title: "Your coach sent you the agreement",
      body: "Please review and sign it. It takes about 2 minutes, and your earlier signed copy stays on file.",
      note: needs.requestNote,
    };
  }
  if (needs?.reason === "new_version" || (needs?.reason === "never_signed" && hadLegacy)) {
    return {
      tone: "update",
      title: "We've updated our Coaching Agreement",
      body: "Please review the update and sign it once. Your earlier signed agreement stays on file.",
      note: needs?.requestNote ?? null,
    };
  }
  return {
    tone: "first",
    title: "Sign your Coaching Agreement",
    body: "Every client signs one agreement. It covers every service and purchase, so you only need to do this once.",
    note: needs?.requestNote ?? null,
  };
}

export function formatSignedDate(iso: string, timeZone = "America/Winnipeg"): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone }).format(new Date(iso));
}

export function formatSignedDateTime(iso: string, timeZone = "America/Winnipeg"): string {
  const text = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
  return timeZone === "America/Winnipeg" ? `${text} CT` : text;
}

/** How an admin exemption reads in the roster and the client's panel. */
export const EXEMPT_LABEL: Record<ExemptKind, string> = {
  offline_signed: "Signed on paper",
  not_required: "Not required",
};
