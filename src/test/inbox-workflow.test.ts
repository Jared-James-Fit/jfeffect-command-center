import { describe, expect, it } from "vitest";
import { deriveInboxWorkflow } from "@/lib/inbox-workflow";

describe("inbox action workflow", () => {
  it("puts a client message in Your Turn independently of unread", () => {
    expect(deriveInboxWorkflow({ lastMessage: { sender_role: "client", message_type: "General", attachments: [] } })).toMatchObject({ state: "your_turn", badge: "Question" });
  });

  it("puts staff messages and automated requests in Waiting on Client", () => {
    expect(deriveInboxWorkflow({ lastMessage: { sender_role: "admin", message_type: "General", attachments: [] } }).state).toBe("waiting_on_client");
    expect(deriveInboxWorkflow({ lastMessage: { sender_role: "admin", message_type: "Check-In", attachments: [{ kind: "checkin_request" } as any] } })).toMatchObject({ state: "waiting_on_client", isFormOrCheckin: true });
  });

  it("labels submitted forms, check-ins, and lift reviews", () => {
    expect(deriveInboxWorkflow({ pendingForm: true }).badge).toBe("Form submitted");
    expect(deriveInboxWorkflow({ pendingCheckin: true }).badge).toBe("Check-in submitted");
    expect(deriveInboxWorkflow({ pendingLiftReview: true }).badge).toBe("Lift review");
  });

  it("keeps resolved and archived explicit", () => {
    expect(deriveInboxWorkflow({ storedStatus: "resolved", pendingForm: true }).state).toBe("resolved");
    expect(deriveInboxWorkflow({ storedStatus: "archived", pendingForm: true }).state).toBe("archived");
  });
});