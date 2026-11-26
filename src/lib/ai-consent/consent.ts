/**
 * Permission to send someone's personal data to outside AI services (pure,
 * tested in ai-consent.test.ts). App Store guideline 5.1.2(i) (Nov 2025):
 * disclose where personal data goes to third-party AI and get explicit
 * permission first. One answer per login (`ai_data_consents`, set only by
 * `ai_consent_set`), asked before the first use and changed any time in
 * Account → Privacy & data. The server checks it (consent.server.ts) before
 * any of that person's data reaches a model: their own AI features, and the
 * coach-side drafting that reads their records.
 */

/** Raise when the wording below changes what is shared or with whom: everyone is asked again. */
export const AI_CONSENT_VERSION = 1;

/** Who receives the data, in the words the person reads. Keep in step with src/lib/ai/routing.ts and voice-transcribe. */
export const AI_PROVIDERS = [
  {
    name: "OpenAI",
    uses: "meal estimates, reading programs and meal plans you import, turning a pain report you say into text and reading one you type, and the drafts your coach (and Cleo, the coach's assistant) prepare from your training, check-ins and nutrition before anything reaches you",
  },
  {
    name: "Google (Gemini)",
    uses: "turning voice memos in your coach chat into text",
  },
] as const;

export const AI_PROVIDER_NAMES = AI_PROVIDERS.map((p) => p.name).join(" and ");

export const AI_CONSENT_COPY = {
  title: "Allow AI services to process your data?",
  intro: `Some features send what you enter to outside AI services so they can do their job. Nothing is sent until you allow it.`,
  shared:
    "What's sent is only what that feature needs: the meal you described, a file you imported, or the training logs, check-ins and notes (including health notes) your coach is working from.",
  abroad: "These providers may process it outside Canada.",
  ifNot: "If you don't allow it, those features stay off for you and your coach does that work by hand. Everything else works the same.",
  change: "You can change this any time in Account → Privacy & data.",
  allow: "Allow",
  decline: "Don't allow",
  /** The optional, unticked box at account creation (never part of agreeing to them). */
  checkboxLead: "Enable AI features (optional).",
  checkboxBody:
    "Allow OpenAI and Google to process meal estimates, imports, voice notes and coaching data (including health notes). Data may be processed outside Canada.",
  checkboxNote: "Change this anytime in Account → Privacy & data. JF Effect works without it.",
  /** Someone who said no, at a feature that needs it: a state, never a request. */
  off: "AI processing is off for your account, so this isn't available.",
} as const;

/** Server-side "seen" key for the one-time in-flow request (feature_announcement_views). */
export const AI_CONSENT_ONCE_KEY = `ai_consent_once:v${AI_CONSENT_VERSION}`;

/**
 * What a box left unticked in an agreement flow records: a yes when ticked;
 * when unticked, a no only if there was no answer to the current wording (so
 * they're not asked again), never over an existing answer.
 */
export function checkboxDecision(checked: boolean, row: AiConsentRow): boolean | null {
  if (checked) return aiConsentAllows(row) ? null : true;
  return aiConsentNeedsAsking(row) ? false : null;
}

export type AiConsentRow = { granted: boolean; text_version: number; decided_at?: string | null } | null | undefined;
export type AiConsentState = "granted" | "declined" | "unasked" | "outdated";

export function aiConsentState(row: AiConsentRow): AiConsentState {
  if (!row) return "unasked";
  if (!row.granted) return "declined";
  return (row.text_version ?? 0) >= AI_CONSENT_VERSION ? "granted" : "outdated";
}

/** True only for an explicit yes to the current wording. */
export function aiConsentAllows(row: AiConsentRow): boolean {
  return aiConsentState(row) === "granted";
}

/** Ask (prompt on open, or before a feature) only when there's no answer to the current wording. */
export function aiConsentNeedsAsking(row: AiConsentRow): boolean {
  const s = aiConsentState(row);
  return s === "unasked" || s === "outdated";
}

/** Tags a server refusal the person can fix themselves (the app shows its inline request beside the action). */
export const AI_CONSENT_MARKER = "[ai-consent]";

export function selfConsentMessage(): string {
  return `${AI_CONSENT_MARKER} This uses ${AI_PROVIDERS[0].name}. Allow AI processing in Account → Privacy & data to use it.`;
}

/** What a coach reads when the client's data can't go to a model. */
export function coachConsentMessage(name: string | null | undefined): string {
  const who = name?.trim() || "This client";
  return `${who} hasn't allowed their data to be sent to AI services (${AI_PROVIDER_NAMES}), so this can't be drafted for them. Do it by hand, or ask them to allow it in Account → Privacy & data.`;
}

/** True for the coach's refusal above: asking again can't help until the client allows it. */
export function isCoachConsentMessage(text: string | null | undefined): boolean {
  return !!text && text.includes("hasn't allowed their data to be sent to AI services");
}

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? "");
  return "";
}

export function isAiConsentError(e: unknown): boolean {
  return messageOf(e).includes(AI_CONSENT_MARKER);
}

/** The message without its marker, for a toast. */
export function consentErrorWords(e: unknown): string {
  return messageOf(e).replace(AI_CONSENT_MARKER, "").trim();
}
