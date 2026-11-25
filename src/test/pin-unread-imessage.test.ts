import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { messagePreviewText } from "@/lib/message-preview";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { ChatListRow } = await import("@/components/messages/chat-list-row");

const row = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ChatListRow, { name: "Coach Jared", preview: "hi", avatar: createElement("span"), ...props } as any));

describe("pinned chats are ordinary rows with a pin, like iMessage's list", () => {
  it("a pinned row carries a quiet pin mark beside its unread dot", () => {
    const html = row({ pinned: true, unread: true });
    expect(html).toContain("data-chat-pinned");
    expect(html).toContain('aria-label="Pinned"');
    expect(html).toContain("bg-[#0095F6]");
    expect(row({})).not.toContain("data-chat-pinned");
  });

  it("the coach chat is the first row, pinned, never a big face", () => {
    const pane = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    expect(pane).toContain("data-coach-chat");
    expect(pane).not.toContain("PinTile");
    expect(pane).toContain("{showPinned && !selectMode && coachRow}");
  });

  it("the preview says what was sent when there are no words", () => {
    expect(messagePreviewText("  hey   there ", [])).toBe("hey there");
    expect(messagePreviewText("", [{ type: "image" }])).toBe("📷 Photo");
    expect(messagePreviewText(null, [{ type: "image" }, { type: "image" }])).toBe("📷 2 Photos");
    expect(messagePreviewText("", [{ type: "video" }])).toBe("🎥 Video");
    expect(messagePreviewText("", [{ type: "image" }, { type: "video" }])).toBe("📷 2 Photos & Videos");
    expect(messagePreviewText("", [{ type: "audio" }])).toBe("🎤 Voice memo");
    expect(messagePreviewText("", [{ type: "link", kind: "form_request" }])).toBe("📋 A form to fill in");
    expect(messagePreviewText("", [{ type: "link", kind: "community_post", story: true }])).toBe("Replied to a story");
    expect(messagePreviewText("", [{ type: "pdf" }])).toBe("📄 File");
    expect(messagePreviewText("", null)).toBe("");
    const page = readFileSync("src/routes/_authenticated/portal/messages.tsx", "utf8");
    expect(page).toContain("coachText: coach ? messagePreviewText(coach.body, coach.attachments) : \"\",");
  });
});
