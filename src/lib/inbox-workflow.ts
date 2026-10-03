import type { Message, MessageAttachment } from "@/lib/messages";

/**
 * Coach workflow — ONE primary status per conversation, stored server-side
 * (conversation_state.workflow_status) and driven by triggers:
 *   client message / form / check-in / lift video → needs_response
 *   coach reply                                     → waiting_on_client
 *   automated reminder                              → waiting_on_client (never clears needs_response)
 *   coach "Mark Done"                               → done
 * Unread (blue dot) is a separate, per-coach concept and is not derived here.
 */
export type InboxWorkflowState = "needs_response" | "waiting_on_client" | "done" | "archived";

export type InboxWorkflowItem = {
  state: InboxWorkflowState;
  /** Primary label shown in the row, or null for Done. */
  label: string | null;
  /** Optional context for Needs Response ("Check-in submitted"). */
  detail: string | null;
  isFormOrCheckin: boolean;
};

export const WORKFLOW_LABEL: Record<Exclude<InboxWorkflowState, "archived">, string> = {
  needs_response: "Needs Response",
  waiting_on_client: "Waiting on Client",
  done: "Done",
};

function kinds(message?: Pick<Message, "attachments"> | null): string[] {
  const list: MessageAttachment[] = Array.isArray(message?.attachments) ? message!.attachments : [];
  return list.map((a) => a.kind).filter(Boolean) as string[];
}

const REQUEST_KINDS = ["checkin_request", "form_request", "signature_request"];

export function deriveInboxWorkflow(input: {
  workflowStatus?: string | null;
  workflowReason?: string | null;
  lastInboundKind?: string | null;
  storedStatus?: string | null;
  lastMessage?: Pick<Message, "sender_role" | "message_type" | "attachments"> | null;
  pendingLiftReview?: boolean;
}): InboxWorkflowItem {
  if (input.storedStatus === "archived") return { state: "archived", label: null, detail: null, isFormOrCheckin: false };

  const last = input.lastMessage;
  const k = kinds(last);
  let state: Exclude<InboxWorkflowState, "archived">;
  if (input.workflowStatus === "needs_response" || input.workflowStatus === "waiting_on_client" || input.workflowStatus === "done") {
    state = input.workflowStatus;
  } else if (input.storedStatus === "resolved") {
    state = "done";
  } else if (last?.sender_role === "client") {
    state = "needs_response";
  } else if (last?.sender_role === "admin") {
    state = "waiting_on_client";
  } else {
    state = "done";
  }

  let detail: string | null = null;
  if (state === "needs_response") {
    const reason = input.workflowReason;
    if (reason === "checkin_submitted" || input.lastInboundKind === "checkin" || k.includes("checkin_submission")) detail = "Check-in submitted";
    else if (reason === "form_submitted" || input.lastInboundKind === "form") detail = "Form submitted";
    else if (reason === "lift_video_uploaded" || input.lastInboundKind === "lift_video" || input.pendingLiftReview) detail = "Lift review";
  }

  const isFormOrCheckin =
    (state === "needs_response" && (detail === "Check-in submitted" || detail === "Form submitted")) ||
    (state === "waiting_on_client" && k.some((x) => REQUEST_KINDS.includes(x))) ||
    k.includes("checkin_submission");

  return { state, label: state === "done" ? null : WORKFLOW_LABEL[state], detail, isFormOrCheckin };
}

/** "You:", "Auto:" or "" — who produced the latest activity. */
export function previewPrefix(last?: Pick<Message, "sender_role"> & { is_automated?: boolean | null } | null): string {
  if (!last) return "";
  if (last.sender_role === "admin") return last.is_automated ? "Auto: " : "You: ";
  return "";
}
