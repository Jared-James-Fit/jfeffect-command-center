import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { messagePreviewText } from "@/lib/message-preview";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { PinTile } = await import("@/components/messages/inbox-parts");

const tile = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(PinTile, { name: "Coach Jared", avatar: createElement("span"), unread: true, onOpen: () => {}, ...props } as any));

describe("pinned chat's unread look, like iMessage", () => {
  it("the bubble comes out of the face (tail touching it) and pops in per new message", () => {
    const html = tile({ preview: "getting those two sessions in is a win" });
    expect(html).toContain("data-pin-preview");
    expect(html).toContain("-mb-2 origin-bottom rounded-[18px]");
    expect(html).toContain("animate-in fade-in zoom-in-75 slide-in-from-bottom-2");
  });

  it("the unread badge sits on the face's left edge with a ring, clear of the bubble", () => {
    const html = tile({ preview: "hi" });
    expect(html).toContain("data-pin-unread");
    expect(html).toContain("absolute -left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-primary ring-[3px] ring-card");
    expect(tile({ unread: false, preview: "hi" })).not.toContain("data-pin-unread");
    expect(tile({ live: true, preview: "hi" })).not.toContain("data-pin-unread");
  });

  it("a pin alone in its row gets a wider bubble; three in a row stay in their tile", () => {
    expect(tile({ preview: "hi", alone: true })).toContain("w-max max-w-[13.5rem]");
    expect(tile({ preview: "hi" })).toContain("max-w-full");
    const pane = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    expect(pane).toContain("alone={pinnedRows.length === 0}");
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
