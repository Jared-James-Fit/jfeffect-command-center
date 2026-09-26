import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const messages = readFileSync("src/lib/messages.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260926021000_add_message_replies.sql", "utf8");

describe("direct message replies", () => {
  it("stores a reply relationship and compact preview", () => {
    expect(messages).toContain("replyToMessageId");
    expect(messages).toContain("reply_preview");
    expect(migration).toContain("reply_to_message_id");
    expect(migration).toContain("normalize_message_reply");
  });

  it("exposes Reply from message actions", () => {
    expect(thread).toContain("<Reply className=");
    expect(thread).toContain("Replying to");
    expect(thread).toContain("startReply(m)");
  });

  it("renders quoted replies and lets users jump to the source", () => {
    expect(thread).toContain("m.reply_to_message_id");
    expect(thread).toContain("jumpToReplySource");
    expect(thread).toContain("message-${m.id}");
  });

  it("does not allow client-visible replies to internal notes", () => {
    expect(thread).toContain("message.is_internal_note");
    expect(migration).toContain("Internal notes cannot be quoted into a client-visible message");
  });
});
