import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");

describe("clients see the coach's read receipts the way the coach sees theirs", () => {
  it("both sides keep 'Read …' on the latest message the other side has read", () => {
    expect(thread).toContain("const readByThem = role === \"admin\" ? m.read_by_client_at : m.read_by_admin_at;");
    expect(thread).toContain("if (m.sender_role === role && !m.is_internal_note && !m.deleted_at && readByThem) return m.id;");
    // no longer coach-only
    expect(thread).not.toContain('if (role !== "admin") return null;\n    for (let i = visibleMessages.length - 1; i >= 0; i--) {\n      const m = visibleMessages[i];\n      if (m.sender_role === role && !m.is_internal_note && !m.deleted_at && m.read_by_client_at)');
  });

  it("an unread message reads the same on both sides", () => {
    expect(thread).toContain(': "Delivered · not read yet";');
    expect(thread).not.toContain(': "Sent";');
  });

  it("the receipt reads the other side's stamp, and message details show Sent and Read for both", () => {
    expect(thread.match(/const readAt = role === "admin" \? m\.read_by_client_at : m\.read_by_admin_at;/g)?.length).toBe(2);
    expect(thread).toContain("{mine && (m.id === lastOwnMessageId || m.id === lastReadOwnMessageId) && !selectionMode && (() => {");
  });
});
