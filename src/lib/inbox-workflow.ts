import type { Message, MessageAttachment } from "@/lib/messages";

export type InboxWorkflowState = "your_turn" | "waiting_on_client" | "active" | "resolved" | "archived";

export type InboxWorkflowItem = {
  state: InboxWorkflowState;
  badge: string | null;
  isFormOrCheckin: boolean;
};

function attachments(message?: Pick<Message, "attachments"> | null): MessageAttachment[] {
  return Array.isArray(message?.attachments) ? message.attachments : [];
}

export function deriveInboxWorkflow(input: {
  lastMessage?: Pick<Message, "sender_role" | "message_type" | "attachments"> | null;
  storedStatus?: string | null;
  pendingLiftReview?: boolean;
  pendingForm?: boolean;
  pendingCheckin?: boolean;
  overdue?: boolean;
}): InboxWorkflowItem {
  if (input.storedStatus === "archived") return { state: "archived", badge: null, isFormOrCheckin: false };
  if (input.storedStatus === "resolved") return { state: "resolved", badge: "Resolved", isFormOrCheckin: false };
  if (input.pendingCheckin) return { state: "your_turn", badge: input.overdue ? "Check-in overdue" : "Check-in submitted", isFormOrCheckin: true };
  if (input.pendingForm) return { state: "your_turn", badge: input.overdue ? "Form overdue" : "Form submitted", isFormOrCheckin: true };
  if (input.pendingLiftReview) return { state: "your_turn", badge: "Lift review", isFormOrCheckin: true };

  const last = input.lastMessage;
  const kinds = attachments(last).map((attachment) => attachment.kind).filter(Boolean);
  if (kinds.includes("checkin_submission")) return { state: "your_turn", badge: "Check-in submitted", isFormOrCheckin: true };
  if (last?.sender_role === "client") {
    const badge = last.message_type === "Check-In" ? "Check-in submitted" : "Question";
    return { state: "your_turn", badge, isFormOrCheckin: last.message_type === "Check-In" };
  }
  if (last?.sender_role === "admin") {
    const expectsClient = kinds.includes("checkin_request") || kinds.includes("form_request") || kinds.includes("signature_request");
    return { state: "waiting_on_client", badge: "Waiting on client", isFormOrCheckin: expectsClient };
  }
  return { state: "active", badge: null, isFormOrCheckin: false };
}
