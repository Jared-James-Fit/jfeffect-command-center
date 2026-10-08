// What "Waiting on Client" should actually mean for managing a busy inbox.
//
// Before: any chat whose last message was mine was "Waiting on Client", so
// ~15 of 16 chats sat in one bucket (including closers like "Perf thanks!"
// that nobody needs to answer) with no sense of who actually owes me a reply
// or for how long.
//
// Now each such chat is one of:
//   - fyi:     my last message needs no reply (a thumbs-up, "thanks", a plain
//              statement). No pill; just a read receipt.
//   - waiting: I asked something / sent a request and it's recent.
//   - overdue: same, but it's been unanswered for 48h+ ("Follow up").
// Presentation only: the stored workflow status is untouched.

export const OVERDUE_HOURS = 48;

type Att = { kind?: string | null; type?: string | null } | null | undefined;

/** Attachments that ask the client to DO something. */
const REQUEST_KINDS = new Set(["checkin_request", "form_request", "signature_request", "payment_request"]);

const ASK_WORDS =
  /\b(let me know|lmk|send me|send over|please|can you|could you|would you|will you|do you|did you|are you|have you|reply|respond|confirm|get back to me|update me|tell me)\b/i;

export type OutboundKind = "expects_reply" | "fyi";

/** Does my last message expect an answer? Deliberately conservative: unknown → fyi stays quiet, a question or request never does. */
export function classifyOutbound(last: { body?: string | null; attachments?: Att[] | null } | null | undefined): OutboundKind {
  if (!last) return "fyi";
  if ((last.attachments ?? []).some((a) => a?.kind && REQUEST_KINDS.has(a.kind))) return "expects_reply";
  const body = (last.body ?? "").trim();
  if (!body) return "fyi";
  if (body.includes("?")) return "expects_reply";
  if (ASK_WORDS.test(body)) return "expects_reply";
  return "fyi";
}

export type WaitingState = "fyi" | "waiting" | "overdue";

export function waitingState(input: {
  last: { body?: string | null; attachments?: Att[] | null; created_at: string } | null | undefined;
  /** Outstanding form/check-in requests also mean I'm waiting, whatever my last text said. */
  hasPendingRequest?: boolean;
  /** The oldest outstanding request's age counts too. */
  oldestPendingSince?: string | null;
  now?: number;
}): WaitingState {
  const now = input.now ?? Date.now();
  const expects = input.hasPendingRequest || classifyOutbound(input.last) === "expects_reply";
  if (!expects) return "fyi";
  const since = [input.last?.created_at, input.oldestPendingSince]
    .filter((x): x is string => !!x)
    .map((x) => new Date(x).getTime())
    .filter((t) => Number.isFinite(t));
  if (!since.length) return "waiting";
  // Overdue is measured from my last message, or from the oldest unanswered request.
  const age = now - Math.min(...since);
  return age >= OVERDUE_HOURS * 3_600_000 ? "overdue" : "waiting";
}
