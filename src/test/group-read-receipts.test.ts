import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStampFor, seenStateFor, seenSummary } from "@/lib/group-read-receipts";

const msg = { created_at: "2026-10-05T12:00:00.000Z", sender_id: "coach" };
const names: Record<string, string> = { a: "Jennifer Merrells", b: "Alyssa Burg", c: "Sam Lee", d: "Dee Ray" };
const nameFor = (id: string) => names[id] ?? "Member";

describe("seenStateFor", () => {
  it("counts members whose last read is at or after the message, newest reader first", () => {
    const state = seenStateFor(msg, [
      { user_id: "a", last_read_at: "2026-10-05T12:00:00.000Z" }, // exactly at send time
      { user_id: "b", last_read_at: "2026-10-05T12:05:00.000Z" },
      { user_id: "c", last_read_at: "2026-10-05T11:59:59.000Z" }, // read just before it arrived
      { user_id: "d", last_read_at: null },
    ], "viewer");
    expect(state.seen.map((s) => s.user_id)).toEqual(["b", "a"]);
    expect(state.notSeen).toEqual(["c", "d"]);
  });

  it("leaves out the sender and the person viewing", () => {
    const state = seenStateFor(msg, [
      { user_id: "coach", last_read_at: "2026-10-05T13:00:00.000Z" },
      { user_id: "viewer", last_read_at: "2026-10-05T13:00:00.000Z" },
      { user_id: "a", last_read_at: null },
    ], "viewer");
    expect(state.seen).toEqual([]);
    expect(state.notSeen).toEqual(["a"]);
  });
});

describe("seenSummary", () => {
  const seen = (ids: string[]) => ids.map((user_id) => ({ user_id, seen_at: msg.created_at }));
  it("reads naturally at every size", () => {
    expect(seenSummary({ seen: [], notSeen: ["a"] }, nameFor)).toBeNull();
    expect(seenSummary({ seen: seen(["a"]), notSeen: ["b"] }, nameFor)).toBe("Seen by Jennifer");
    expect(seenSummary({ seen: seen(["a", "b"]), notSeen: [] }, nameFor)).toBe("Seen by Jennifer and Alyssa");
    expect(seenSummary({ seen: seen(["a", "b", "c", "d"]), notSeen: ["x"] }, nameFor)).toBe("Seen by Jennifer, Alyssa +2");
    expect(seenSummary({ seen: seen(["a", "b", "c"]), notSeen: [] }, nameFor)).toBe("Seen by everyone");
  });
});

describe("readStampFor", () => {
  it("never records a read earlier than the newest message on screen", () => {
    const behindClock = new Date("2026-10-05T11:58:00.000Z");
    expect(readStampFor(msg.created_at, behindClock)).toBe(msg.created_at);
    const now = new Date("2026-10-05T12:10:00.000Z");
    expect(readStampFor(msg.created_at, now)).toBe(now.toISOString());
  });
});

describe("group thread wiring", () => {
  const thread = readFileSync("src/components/group-message-thread.tsx", "utf8");
  it("marks read only while visible and refreshes receipts live", () => {
    expect(thread).toContain('document.visibilityState === "visible"');
    expect(thread).toContain("readStampFor(latestCreatedAt)");
    expect(thread).toContain('table: "chat_group_members", filter: `group_id=eq.${groupId}`');
  });
  it("shows Seen by under the newest message and offers it per message", () => {
    expect(thread).toContain("m.id === latestMessageId || m.id === lastOwnMessageId");
    expect(thread).toContain("setSeenForId(m.id)");
  });
});
