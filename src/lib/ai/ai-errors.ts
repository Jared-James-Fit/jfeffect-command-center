/**
 * What kind of failure a model call hit (Nov 23 2026), so every AI job reacts the same way:
 *
 * - `credits`  OpenAI says the account has no credits / quota left (HTTP 429 insufficient_quota,
 *              "You have no credits remaining"). Nothing will answer until someone adds credits.
 * - `auth`     the key is missing, revoked or wrong (401, invalid_api_key, "not configured").
 * - `rate`     a short-term rate limit (429 that isn't quota): try again in a minute.
 * - `outage`   the provider is down or overloaded (5xx, connection refused, "fetch failed").
 * - `timeout`  no answer in time.
 * - `paused`   our own circuit breaker refused the call while the provider is known to be down
 *              (AiUnavailableError): no request was made, nothing was spent.
 * - `answer`   the model answered but the answer couldn't be used (empty, unreadable, refused).
 * - `other`    anything else (a bad request, a bug).
 *
 * `provider` failures (credits, auth, outage, paused) say nothing about the job itself: a job
 * that hit one must not burn an attempt, must never be replaced by a stand-in, and is redone
 * once the provider answers again. Pure.
 */
export type AiFailureKind =
  | "credits"
  | "auth"
  | "rate"
  | "outage"
  | "timeout"
  | "paused"
  | "answer"
  | "other";

/** Thrown before any request is made while the provider is known to be down (ai-health.server.ts). */
export class AiUnavailableError extends Error {
  constructor(
    public provider: "openai" | "gateway",
    public reason: "credits" | "auth" | "outage",
  ) {
    super(
      reason === "credits"
        ? "AI is paused: OpenAI says the account has no credits left. Add credits at platform.openai.com → Settings → Billing."
        : reason === "auth"
          ? "AI is paused: the OpenAI key was refused. Check OPENAI_API_KEY."
          : "AI is paused: OpenAI isn't answering right now.",
    );
    this.name = "AiUnavailableError";
  }
}

// An HTTP status as our clients word it: "429 {…", "openai:gpt-5-mini: 429 {…", "(503 …" — never a
// number inside the text (a "500 kcal" in an unreadable answer is not an outage).
const status = (codes: string) => new RegExp(`(^|[:(]\\s*)(${codes})(\\s|\\{|$)`);
const CREDITS =
  /insufficient_quota|no credits remaining|no credits left|credits are used up|out of credit|exceeded your current quota|billing_hard_limit|billing hard limit|add credits to continue|credit balance is too low|payment required/i;
const CREDITS_STATUS = status("402");
const AUTH =
  /invalid_api_key|incorrect api key|api key.*(revoked|invalid|deactivated)|is not configured|organization.*(deactivated|disabled)|account_deactivated/i;
const AUTH_STATUS = status("401");
const RATE = /rate[_ ]limit|too many requests/i;
const RATE_STATUS = status("429");
const OUTAGE =
  /server_error|overloaded|service unavailable|bad gateway|fetch failed|econnreset|econnrefused|enotfound|socket hang up|network error|other side closed/i;
const OUTAGE_STATUS = status("500|502|503|504|520|521|522|523|524|529");
const TIMEOUT = /timed? ?out|timeout|aborterror|no answer within|deadline/i;
const ANSWER =
  /empty answer|unreadable|couldn'?t read|didn'?t parse|declined the request|ran out of room|incomplete/i;

/** The kind of failure an error (or its message) describes. */
export function classifyAiError(e: unknown): AiFailureKind {
  if (e instanceof AiUnavailableError) return "paused";
  const msg = errorText(e);
  if (/AI is paused|^Waiting for AI/i.test(msg)) return "paused";
  if (CREDITS.test(msg) || CREDITS_STATUS.test(msg)) return "credits";
  if (AUTH.test(msg) || AUTH_STATUS.test(msg)) return "auth";
  if (RATE.test(msg) || RATE_STATUS.test(msg)) return "rate";
  if (OUTAGE.test(msg) || OUTAGE_STATUS.test(msg)) return "outage";
  if (TIMEOUT.test(msg) || (e as any)?.name === "TimeoutError" || (e as any)?.name === "AbortError")
    return "timeout";
  if (ANSWER.test(msg)) return "answer";
  return "other";
}

export function errorText(e: unknown): string {
  if (e == null) return "";
  if (typeof e === "string") return e;
  const anyE = e as any;
  return String(anyE?.message ?? anyE ?? "");
}

/** A failure that's the provider's, not the job's: never counted as an attempt, redone once AI is back. */
export function isProviderFailure(kind: AiFailureKind): boolean {
  return kind === "credits" || kind === "auth" || kind === "outage" || kind === "paused";
}

/** A failure that stops every call until someone acts (credits added, key fixed). */
export function isAccountFailure(kind: AiFailureKind): boolean {
  return kind === "credits" || kind === "auth";
}

/** Same, read straight from a stored error message (a job's `error` / `last_error` column). */
export function isProviderFailureText(text: string | null | undefined): boolean {
  if (!text) return false;
  return isProviderFailure(classifyAiError(text));
}

/** A short, plain sentence for the coach about why AI didn't answer (never the raw API body). */
export function aiFailureWords(kind: AiFailureKind): string {
  switch (kind) {
    case "credits":
      return "OpenAI credits ran out";
    case "auth":
      return "the OpenAI key was refused";
    case "rate":
      return "OpenAI was busy (rate limit)";
    case "outage":
      return "OpenAI wasn't answering";
    case "timeout":
      return "the AI took too long";
    case "paused":
      return "AI is paused until OpenAI answers again";
    case "answer":
      return "the AI's answer couldn't be used";
    default:
      return "the AI call failed";
  }
}

/**
 * When a job that hit this failure should be tried again (ms from now), or null to stop.
 * Provider failures wait for the health check (`retryAfterProviderMs`) instead of a fixed
 * backoff; rate limits and timeouts back off exponentially; a job only ever gets `max`
 * attempts of its own, so nothing loops forever.
 */
export function retryDelayMs(kind: AiFailureKind, attempt: number, max = 3): number | null {
  if (isProviderFailure(kind)) return null; // parked until AI is back (never counted)
  if (attempt >= max) return null;
  const base =
    kind === "rate" ? 60_000 : kind === "timeout" || kind === "outage" ? 120_000 : 300_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

/** A stored reason that was the provider's fault, in our words (aiFailureWords) or the API's. */
export function isProviderFailureWords(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  return (
    (["credits", "auth", "outage", "paused"] as AiFailureKind[]).some((k) =>
      t.startsWith(aiFailureWords(k)),
    ) || isProviderFailureText(t)
  );
}
