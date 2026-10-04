import { describe, expect, it } from "vitest";
import { deriveInboxWorkflow, previewPrefix } from "@/lib/inbox-workflow";
import { formatReadReceipt } from "@/lib/read-receipt";

describe("coach workflow status (independent of unread)", () => {
  it("uses the stored server status as the single primary status", () => {
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", lastMessage: { sender_role: "client", message_type: "General", attachments: [] } }))
      .toMatchObject({ state: "needs_response", label: "Needs Response" });
    // Coach read it but has not handled it: still Needs Response even though the last message is old.
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", lastMessage: { sender_role: "admin", message_type: "Check-In", attachments: [{ kind: "checkin_request" } as any] } }).state)
      .toBe("needs_response");
    expect(deriveInboxWorkflow({ workflowStatus: "waiting_on_client" })).toMatchObject({ state: "waiting_on_client", label: "Waiting on Client" });
    expect(deriveInboxWorkflow({ workflowStatus: "done" })).toMatchObject({ state: "done", label: null });
  });

  it("never shows two primary statuses", () => {
    const w = deriveInboxWorkflow({ workflowStatus: "waiting_on_client", workflowReason: "automated_request", lastMessage: { sender_role: "admin", message_type: "Check-In", attachments: [{ kind: "checkin_request" } as any] } });
    expect(w.label).toBe("Waiting on Client");
    expect(w.detail).toBeNull();
    expect(w.isFormOrCheckin).toBe(true);
  });

  it("explains why a response is needed", () => {
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", workflowReason: "checkin_submitted" }).detail).toBe("Check-in submitted");
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", workflowReason: "form_submitted" })).toMatchObject({ detail: "Form submitted", isFormOrCheckin: true });
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", lastInboundKind: "lift_video" }).detail).toBe("Lift review");
    expect(deriveInboxWorkflow({ workflowStatus: "needs_response", workflowReason: "client_message" }).detail).toBeNull();
  });

  it("keeps archived separate and maps legacy resolved to Done", () => {
    expect(deriveInboxWorkflow({ storedStatus: "archived", workflowStatus: "needs_response" }).state).toBe("archived");
    expect(deriveInboxWorkflow({ storedStatus: "resolved" }).state).toBe("done");
  });

  it("labels who produced the latest activity", () => {
    expect(previewPrefix({ sender_role: "admin" })).toBe("You: ");
    expect(previewPrefix({ sender_role: "admin", is_automated: true })).toBe("Auto: ");
    expect(previewPrefix({ sender_role: "client" })).toBe("");
  });
});

describe("read receipts", () => {
  const now = new Date("2026-10-03T18:00:00");
  it("formats real read timestamps compactly", () => {
    expect(formatReadReceipt("2026-10-03T11:47:00", now)).toBe("Read 11:47 AM");
    expect(formatReadReceipt("2026-10-02T20:14:00", now)).toBe("Read yesterday at 8:14 PM");
    expect(formatReadReceipt("2026-09-29T08:05:00", now)).toBe("Read Tue 8:05 AM");
    expect(formatReadReceipt("2026-08-14T08:05:00", now)).toBe("Read Aug 14, 8:05 AM");
  });
});
