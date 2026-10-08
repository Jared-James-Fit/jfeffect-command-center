import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake "messages" table that behaves like production: the insert trigger
// rebuilds reply_preview from the original's FIRST attachment.
const calls: Array<{ op: string; payload?: any; id?: string }> = [];
let failClipUpdate = false;
function triggerPreview() {
  return { sender_role: "client", body: "", attachment_type: "video", attachment_name: "clip1.mov", is_internal_note: false };
}
function fakeFrom(table: string) {
  if (table !== "messages") {
    return { update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
  }
  return {
    insert: (row: any) => {
      calls.push({ op: "insert", payload: row });
      const saved = { id: "m-new", ...row, reply_preview: row.reply_to_message_id ? triggerPreview() : null };
      return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
    },
    update: (patch: any) => ({
      eq: (_col: string, id: string) => {
        calls.push({ op: "update", payload: patch, id });
        return {
          select: () => ({
            single: () => Promise.resolve(
              failClipUpdate
                ? { data: null, error: { message: "denied" } }
                : { data: { id, reply_to_message_id: "m-src", ...patch }, error: null },
            ),
          }),
        };
      },
    }),
  };
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => fakeFrom(t) } }));
vi.mock("@/lib/push/events.functions", () => ({ notifyNewMessage: () => Promise.resolve() }));

import {
  keepReplyClip, makeReplyPreview, mediaAttachments, replyClipLabel, replyMediaFor, replyPreviewText, sendMessage,
} from "@/lib/messages";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");

// Four clips sent at once, with a caption and a link card in between.
const batch = {
  sender_role: "client" as const,
  body: "Squat sets from today",
  is_internal_note: false,
  attachments: [
    { type: "video", url: "", storage_path: "c1/clip1.mov", thumbnail_storage_path: "c1/clip1-poster.jpg", name: "clip1.mov" },
    { type: "video", url: "", storage_path: "c1/clip2.mov", thumbnail_storage_path: "c1/clip2-poster.jpg", name: "clip2.mov" },
    { type: "link", url: "https://example.com" },
    { type: "image", url: "", storage_path: "c1/photo.jpg", name: "photo.jpg" },
    { type: "video", url: "", storage_path: "c1/clip3.mov", name: "clip3.mov" },
  ],
} as any;

beforeEach(() => {
  calls.length = 0;
  failClipUpdate = false;
});

describe("reply to one clip of several", () => {
  it("lists only photos and videos, keeping their attachment index", () => {
    expect(mediaAttachments(batch).map((x) => x.index)).toEqual([0, 1, 3, 4]);
  });

  it("quotes the chosen clip with its place in the batch", () => {
    const p = makeReplyPreview(batch, 4);
    expect(p).toMatchObject({
      attachment_type: "video",
      attachment_name: "clip3.mov",
      attachment_path: "c1/clip3.mov",
      attachment_index: 4,
      attachment_position: 4,
      attachment_count: 4,
    });
    expect(replyPreviewText(p)).toBe("Video 4 of 4");
    expect(replyPreviewText(makeReplyPreview(batch, 3))).toBe("Photo 3 of 4");
    expect(makeReplyPreview(batch, 1).attachment_poster_path).toBe("c1/clip2-poster.jpg");
  });

  it("keeps whole-message replies exactly as before", () => {
    const whole = makeReplyPreview(batch);
    expect(whole.attachment_index).toBeUndefined();
    expect(whole.attachment_path).toBe("c1/clip1.mov");
    expect(replyPreviewText(whole)).toBe("Squat sets from today");
    expect(replyClipLabel(whole)).toBeNull();
  });

  it("ignores a clip index when there is only one photo/video", () => {
    const single = { ...batch, attachments: [batch.attachments[0]] };
    expect(makeReplyPreview(single, 0).attachment_index).toBeUndefined();
    expect(replyPreviewText(makeReplyPreview(single, 0))).toBe("Squat sets from today");
  });

  it("shows the chosen clip's thumbnail (poster for videos), not the first one", () => {
    const p = makeReplyPreview(batch, 1);
    expect(replyMediaFor(p, batch)).toEqual({ type: "video", path: "c1/clip2.mov", posterPath: "c1/clip2-poster.jpg" });
    // Original not loaded: the preview carries the clip itself.
    expect(replyMediaFor(p, null)).toEqual({ type: "video", path: "c1/clip2.mov", posterPath: "c1/clip2-poster.jpg" });
    // Old replies without an index still use the first attachment.
    expect(replyMediaFor({ sender_role: "client", body: "", attachment_type: "video" }, batch)?.path).toBe("c1/clip1.mov");
  });

  it("keeps the local clip when the realtime row arrives before it is saved", () => {
    const local = { reply_to_message_id: "m-src", reply_preview: makeReplyPreview(batch, 1) };
    const server = { id: "m-new", reply_to_message_id: "m-src", reply_preview: triggerPreview() } as any;
    const merged = keepReplyClip(server, local);
    expect(replyPreviewText(merged.reply_preview)).toBe("Video 2 of 4");
    expect(merged.reply_preview?.attachment_path).toBe("c1/clip2.mov");
    // Different reply target, or the server already knows the clip: server wins.
    expect(keepReplyClip(server, { ...local, reply_to_message_id: "other" })).toBe(server);
    const saved = { ...server, reply_preview: { ...triggerPreview(), attachment_index: 4 } };
    expect(keepReplyClip(saved, local)).toBe(saved);
  });

  it("writes the chosen clip back after the insert trigger rebuilds the quote", async () => {
    const sent = await sendMessage({
      clientId: "c1", senderId: "u1", senderRole: "client", body: "how was depth?",
      replyToMessageId: "m-src", replyPreview: makeReplyPreview(batch, 1),
    });
    expect(calls.map((c) => c.op)).toEqual(["insert", "update"]);
    expect(calls[1].id).toBe("m-new");
    expect(calls[1].payload.reply_preview).toMatchObject({ attachment_index: 1, attachment_position: 2, attachment_name: "clip2.mov" });
    expect(replyPreviewText(sent.reply_preview)).toBe("Video 2 of 4");
  });

  it("doesn't touch normal replies, and a failed write-back still sends", async () => {
    await sendMessage({
      clientId: "c1", senderId: "u1", senderRole: "client", body: "nice",
      replyToMessageId: "m-src", replyPreview: makeReplyPreview(batch),
    });
    expect(calls.map((c) => c.op)).toEqual(["insert"]);

    calls.length = 0;
    failClipUpdate = true;
    const sent = await sendMessage({
      clientId: "c1", senderId: "u1", senderRole: "client", body: "depth?",
      replyToMessageId: "m-src", replyPreview: makeReplyPreview(batch, 1),
    });
    expect(sent.id).toBe("m-new");
    expect(replyPreviewText(sent.reply_preview)).toBe("Video");
  });

  it("lets each clip be held or hovered to reply, and jumps back to that clip", () => {
    expect(thread).toContain("data-media-index={i}");
    expect(thread).toContain("id={`att-${m.id}-${i}`}");
    expect(thread).toContain("tile ? Number(tile.dataset.mediaIndex) : null,");
    expect(thread).toContain("startReply(m, index)");
    expect(thread).toContain("Reply to whole message");
    expect(thread).toContain("jumpToReplySource(m.reply_to_message_id, m.reply_preview?.attachment_index)");
    expect(thread).toContain("makeReplyPreview(replyTarget, replyClip)");
    // A long-press that never produced a click can't swallow the next tap on a video.
    expect(thread).toContain("if (!fromPortal(e)) suppressClickRef.current = false;");
  });
});
