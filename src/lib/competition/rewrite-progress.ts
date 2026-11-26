/**
 * Where a Competition assessment Cleo is (re)writing stands, and about how long is left
 * (Nov 25 2026). Pure: the server hands over the milestone's state (rewrite.server.ts
 * `liveOf`), the screens read this.
 *
 * The steps are the worker's own (worker.server.ts `processMilestone`):
 *   Sent     the coach asked (`requestChanges` puts the milestone back on today's schedule)
 *   Reading  the worker has claimed it and is reading the records (no model call yet)
 *   Writing  Cleo's draft, a background OpenAI call ("write")
 *   Checking every number is checked against the records; a draft that fails goes back for a
 *            second pass ("write2")
 *   Ready    the new version is saved and the coach is told
 *
 * The time left is what's usually left: each model step's median from the calls on file
 * (ai_call_log, `typical`), the hand-overs measured from how the worker runs (a claim within a
 * minute, a 40 s poll every minute or so). A step past its usual length is said to be slow with
 * how long it's been going, never given a made-up time; the bar is the share of the usual total
 * that's behind it, never full until it's done (run-eta.ts's rule).
 */

import { isCoachConsentMessage } from "@/lib/ai-consent/consent";

export type RewriteStepKey = "sent" | "reading" | "writing" | "checking" | "ready";

export const REWRITE_STEPS: ReadonlyArray<{ key: RewriteStepKey; label: string }> = [
  { key: "sent", label: "Sent" },
  { key: "reading", label: "Reading" },
  { key: "writing", label: "Writing" },
  { key: "checking", label: "Checking" },
  { key: "ready", label: "Ready" },
];

/** What the server says about one milestone in flight (no answers' text, only where it stands). */
export type LiveRewrite = {
  milestoneId: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  why: string | null;
  updatedAt: string | null;
  lockedAt: string | null;
  /** Model calls already answered ("write", "write2"). */
  done: string[];
  /** The call being waited on, if any. */
  pending: {
    key: string;
    model: string | null;
    /** OpenAI's own state: "queued" (waiting for a slot) or "in_progress". */
    phase: string | null;
    /** When it was sent (ms). */
    submittedAt: number | null;
    /** When OpenAI started on it (ms). */
    startedAt: number | null;
  } | null;
  /** The version being replaced, when this run is a change the coach asked for. */
  request: {
    assessmentId: string;
    version: number;
    note: string | null;
    at: string | null;
  } | null;
};

/** Usual lengths (ms) of the two model calls: medians from ai_call_log, else these (Nov 25 2026's 6 + 3 calls). */
export type RewriteTypical = { write: number; write2: number };
export const DEFAULT_TYPICAL: RewriteTypical = { write: 160_000, write2: 245_000 };

/** The worker is woken every minute while something's due, so a request waits half a minute on average. */
export const CLAIM_MS = 35_000;
/** Reading the records and the brief before the first call. */
export const READ_MS = 20_000;
/** After the model answers: the next 40 s poll sees it (one runs about every minute), checks, saves. */
export const FINISH_MS = 40_000;
/** A step this many times its usual length is "taking longer than usual". */
export const SLOW_FACTOR = 1.3;
/** A failed run is tried again by itself this long after it stopped (competition_milestone_claim). */
export const RETRY_AFTER_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
/** The bar never reaches the end before it's done. */
const BAR_MAX = 0.95;

export type RewritePhase =
  | "queued"
  | "reading"
  | "openai_queue"
  | "writing"
  | "checking"
  | "second_pass"
  | "waiting_ai"
  | "failed"
  | "no_consent"
  | "stopped";

export type RewriteView = {
  phase: RewritePhase;
  /** The step that's on now. */
  step: RewriteStepKey;
  steps: Array<{ key: RewriteStepKey; label: string; state: "done" | "now" | "todo" }>;
  /** One line: what Cleo is doing right now. */
  doing: string;
  /** One line: time left, or how long it's been when it's slow or stuck. */
  time: string | null;
  /** 0..0.95, or null when nothing can be said (waiting for AI, failed). */
  share: number | null;
  slow: boolean;
  /** The reason it stopped, in the worker's words. */
  error: string | null;
  /** It tries again by itself at this time (ms), when it will. */
  retryAt: number | null;
  /** The coach can start it again now. */
  canRetry: boolean;
  /** Since the coach asked (ms), when known. */
  sinceAsked: number | null;
};

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** "about 6 min", "under a minute". */
export function leftWords(msLeft: number): string {
  if (msLeft < 60_000) return "Under a minute left";
  return `About ${Math.round(msLeft / 60_000)} min left`;
}

/** "45 s", "3 min", "1 h 5 min". */
export function sinceWords(msGone: number): string {
  const s = Math.max(0, Math.round(msGone / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Is this a wait for OpenAI itself (down, out of credits), not a failure? */
export function isProviderWait(live: Pick<LiveRewrite, "status" | "lastError">): boolean {
  return live.status === "waiting_ai" && /^Waiting for AI/i.test(live.lastError ?? "");
}

/** A milestone that's being (or about to be) written, as the screens count it. */
export function inFlight(status: string | null | undefined): boolean {
  return (
    status === "scheduled" ||
    status === "generating" ||
    status === "waiting_ai" ||
    status === "failed"
  );
}

function stepsAt(now: RewriteStepKey, asked: boolean): RewriteView["steps"] {
  const at = REWRITE_STEPS.findIndex((s) => s.key === now);
  return REWRITE_STEPS.map((s, i) => ({
    ...s,
    // a run the coach didn't ask for (the schedule, Write it now) starts queued, not sent
    label: s.key === "sent" && !asked ? "Queued" : s.label,
    state: i < at ? "done" : i === at ? "now" : "todo",
  }));
}

/**
 * Where one rewrite stands. `typical` from the calls on file; `now` in ms.
 */
export function rewriteView(
  live: LiveRewrite,
  now: number,
  typical: RewriteTypical = DEFAULT_TYPICAL,
): RewriteView {
  const write = Math.max(30_000, typical.write || DEFAULT_TYPICAL.write);
  const write2 = Math.max(30_000, typical.write2 || DEFAULT_TYPICAL.write2);
  const asked = ms(live.request?.at) ?? null;
  const sinceAsked = asked != null ? Math.max(0, now - asked) : null;
  const secondPass = live.pending?.key === "write2" || live.done.includes("write2");
  const total = CLAIM_MS + READ_MS + write + (secondPass ? write2 : 0) + FINISH_MS;
  const base = { sinceAsked, error: null, retryAt: null, canRetry: false, slow: false };
  const steps = (k: RewriteStepKey) => stepsAt(k, !!live.request);
  const bar = (left: number) => Math.min(BAR_MAX, Math.max(0.03, (total - left) / total));

  if (live.status === "failed" && isCoachConsentMessage(live.lastError)) {
    // the athlete hasn't allowed AI: no attempt is used, the worker looks again every 10 minutes
    // and carries on once they allow it (worker.server.ts), so there's no time to promise
    return {
      ...base,
      phase: "no_consent",
      step: "sent",
      steps: steps("sent"),
      doing: "Waiting for the athlete's permission to use AI",
      time: null,
      share: null,
      error: live.lastError,
      canRetry: true,
    };
  }

  if (live.status === "failed") {
    const stoppedAt = ms(live.updatedAt) ?? now;
    const again = live.attempts < MAX_ATTEMPTS;
    return {
      ...base,
      phase: again ? "failed" : "stopped",
      step: live.done.includes("write") ? "checking" : live.pending ? "writing" : "reading",
      steps: steps(live.done.includes("write") ? "checking" : live.pending ? "writing" : "reading"),
      doing: again ? "Cleo couldn't finish this version" : "Cleo stopped after three tries",
      time: null,
      share: null,
      error: live.lastError,
      retryAt: again ? stoppedAt + RETRY_AFTER_MS : null,
      canRetry: true,
    };
  }

  if (isProviderWait(live)) {
    const since = now - (ms(live.updatedAt) ?? now);
    return {
      ...base,
      phase: "waiting_ai",
      step: live.done.includes("write") ? "checking" : "writing",
      steps: steps(live.done.includes("write") ? "checking" : "writing"),
      doing: "Waiting for OpenAI to come back. Cleo carries on by itself.",
      time: since >= 60_000 ? `Waiting ${sinceWords(since)}` : null,
      share: null,
      error: live.lastError?.replace(/^Waiting for AI:\s*/i, "") ?? null,
    };
  }

  if (live.status === "scheduled") {
    const waited = sinceAsked ?? Math.max(0, now - (ms(live.updatedAt) ?? now));
    const left = Math.max(0, CLAIM_MS - waited) + READ_MS + write + FINISH_MS;
    const slow = waited > CLAIM_MS + 90_000;
    return {
      ...base,
      phase: "queued",
      step: "sent",
      steps: steps("sent"),
      doing: slow
        ? "Waiting for Cleo to pick it up"
        : live.request
          ? "Sent to Cleo. Starting in a moment."
          : "Queued. Cleo starts in a moment.",
      time: slow ? `Waiting ${sinceWords(waited)}` : leftWords(left),
      share: bar(left),
      slow,
    };
  }

  const p = live.pending;
  if (p) {
    const second = p.key === "write2";
    const usual = second ? write2 : write;
    // the medians are measured from when the call was sent (OpenAI's queue included)
    const began = p.submittedAt ?? p.startedAt ?? ms(live.lockedAt) ?? now;
    const gone = Math.max(0, now - began);
    if (p.phase === "queued") {
      const left = usual + FINISH_MS;
      return {
        ...base,
        phase: "openai_queue",
        step: second ? "checking" : "writing",
        steps: steps(second ? "checking" : "writing"),
        doing: "Waiting for a slot at OpenAI",
        time: gone >= 60_000 ? `Waiting ${sinceWords(gone)}` : leftWords(left),
        share: bar(left),
      };
    }
    const slow = gone > usual * SLOW_FACTOR;
    const left = Math.max(0, usual - gone) + FINISH_MS;
    return {
      ...base,
      phase: second ? "second_pass" : "writing",
      step: second ? "checking" : "writing",
      steps: steps(second ? "checking" : "writing"),
      doing: second
        ? "Some numbers didn't match the records. Cleo is correcting them."
        : live.request
          ? "Cleo is writing the new version with your changes"
          : "Cleo is writing it",
      time: slow ? `Taking longer than usual · ${sinceWords(gone)} so far` : leftWords(left),
      share: slow ? BAR_MAX * 0.97 : bar(left),
      slow,
    };
  }

  if (live.done.includes("write")) {
    return {
      ...base,
      phase: "checking",
      step: "checking",
      steps: steps("checking"),
      doing: "Checking every number against the records",
      time: leftWords(FINISH_MS),
      share: bar(FINISH_MS),
    };
  }

  // claimed, reading the records (or between runs before the first call)
  const began = ms(live.lockedAt) ?? ms(live.updatedAt) ?? now;
  const gone = Math.max(0, now - began);
  const left = Math.max(0, READ_MS - gone) + write + FINISH_MS;
  return {
    ...base,
    phase: "reading",
    step: "reading",
    steps: steps("reading"),
    doing: "Reading their training, meets and your note",
    time: leftWords(left),
    share: bar(left),
  };
}

/** The median of the calls given (ms), or null with none. */
export function medianMs(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/** The progress a stored milestone shows (its `progress` is the staged call's state; only where it stands is read). */
export function liveFromProgress(progress: unknown): Pick<LiveRewrite, "done" | "pending"> {
  type Stored = { model?: unknown; phase?: unknown; at?: unknown; startedAt?: unknown };
  const p = (progress ?? {}) as {
    calls?: Record<string, unknown>;
    pending?: Record<string, Stored | null>;
  };
  const done = Object.keys(p.calls ?? {});
  const entries = Object.entries(p.pending ?? {});
  const last = entries[entries.length - 1];
  if (!last) return { done, pending: null };
  const [key, v] = last;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    done,
    pending: {
      key,
      model: typeof v?.model === "string" ? v.model : null,
      phase: typeof v?.phase === "string" ? v.phase : null,
      submittedAt: num(v?.at),
      startedAt: num(v?.startedAt),
    },
  };
}
