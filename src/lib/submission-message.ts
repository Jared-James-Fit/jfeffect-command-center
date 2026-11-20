/**
 * Where a submitted check-in or form sits in the client's coach chat, so
 * "Open in chat" lands on that exact message (scrolled to and highlighted,
 * `/admin/messages?client=…&msg=…`), not just the conversation.
 *
 * - A weekly check-in: the client's submission bubble (`checkin_submission`
 *   carrying its id), else the request the coach's card went out as.
 * - A native form: the request card it answers, i.e. the newest `form_request`
 *   for that form sent at or before it was submitted (requestCardSubmission's
 *   rule from the other side: a card shows the answer sent after it), else the
 *   first one after (a form sent before the chat card existed).
 * Nothing found: the chat opens at the latest message, as before.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { REQUEST_CLOCK_SLACK_MS } from "@/lib/form-request-state";

const db = supabase as any;

export type SubmissionRef =
  | { source: "checkin"; id: string; clientId: string }
  | { source: "native"; id: string; clientId: string; formId: string; submittedAt: string | null };

/** The request card a form submission answers (pure, tested). */
export function pickRequestMessage(
  requests: Array<{ id: string; created_at: string }>,
  submittedAt: string | null,
): string | null {
  if (!requests.length) return null;
  const sorted = [...requests].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const t = submittedAt ? Date.parse(submittedAt) : NaN;
  if (!Number.isFinite(t)) return sorted[sorted.length - 1].id;
  let before: string | null = null;
  for (const r of sorted) if (Date.parse(r.created_at) <= t + REQUEST_CLOCK_SLACK_MS) before = r.id;
  return before ?? sorted[0].id;
}

/** jsonb containment needs the JSON text: an array would be sent as a Postgres array literal. */
const contains = (v: unknown) => JSON.stringify(v);

export async function findSubmissionMessage(ref: SubmissionRef): Promise<string | null> {
  if (ref.source === "checkin") {
    const { data } = await db
      .from("messages")
      .select("id")
      .eq("client_id", ref.clientId)
      .contains("attachments", contains([{ kind: "checkin_submission", checkin_submission_id: ref.id }]))
      .order("created_at", { ascending: false })
      .limit(1);
    const hit = (data ?? [])[0]?.id as string | undefined;
    if (hit) return hit;
    const { data: row } = await db.from("messenger_checkins").select("request_message_id").eq("id", ref.id).maybeSingle();
    return (row?.request_message_id as string | null) ?? null;
  }
  const { data } = await db
    .from("messages")
    .select("id, created_at")
    .eq("client_id", ref.clientId)
    .contains("attachments", contains([{ kind: "form_request", form_id: ref.formId }]))
    .order("created_at", { ascending: false })
    .limit(50);
  return pickRequestMessage((data ?? []) as Array<{ id: string; created_at: string }>, ref.submittedAt);
}

/** Read as soon as the submission is on screen, so the tap is instant. */
export function useSubmissionMessage(ref: SubmissionRef | null) {
  return useQuery({
    queryKey: ["submission-message", ref?.source, ref?.id],
    enabled: !!ref,
    staleTime: 5 * 60_000,
    queryFn: () => findSubmissionMessage(ref!),
  });
}

/** The coach's chat with a client, on one message when there is one. */
export function chatSearch(clientId: string, messageId?: string | null): { client: string; msg?: string } {
  return messageId ? { client: clientId, msg: messageId } : { client: clientId };
}
