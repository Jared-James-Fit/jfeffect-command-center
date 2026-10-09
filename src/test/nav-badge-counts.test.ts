import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagesBadgeCount, unreadGroupCount } from "@/lib/nav-badge-counts";
import { shouldPersistQueryKey } from "@/lib/query-persister";

describe("Messages tab badge is always a number", () => {
  it("adds every source into one count", () => {
    expect(messagesBadgeCount({ coachMessages: 2, liftFeedback: 1, directThreads: 1, crewThreads: 0, groupThreads: 3 })).toBe(7);
  });

  it("a lift-feedback-only or chat-only badge is a count of 1, not a bare dot", () => {
    expect(messagesBadgeCount({ coachMessages: 0, liftFeedback: 1, directThreads: 0, crewThreads: 0, groupThreads: 0 })).toBe(1);
    expect(messagesBadgeCount({ coachMessages: 0, liftFeedback: 0, directThreads: 0, crewThreads: 1, groupThreads: 0 })).toBe(1);
  });

  it("nothing waiting means no badge", () => {
    expect(messagesBadgeCount({ coachMessages: 0, liftFeedback: 0, directThreads: 0, crewThreads: 0, groupThreads: 0 })).toBe(0);
    expect(messagesBadgeCount({ coachMessages: NaN, liftFeedback: -1, directThreads: 0, crewThreads: 0, groupThreads: 0 })).toBe(0);
  });
});

describe("coach group unread", () => {
  const me = "me";
  const memberships = [
    { group_id: "g1", last_read_at: "2026-10-01T10:00:00Z" },
    { group_id: "g2", last_read_at: null },
  ];
  it("counts groups (not messages) with something new from someone else", () => {
    expect(unreadGroupCount(memberships, [
      { group_id: "g1", sender_id: "coach", created_at: "2026-10-02T10:00:00Z" },
      { group_id: "g1", sender_id: "coach", created_at: "2026-10-03T10:00:00Z" },
      { group_id: "g2", sender_id: "coach", created_at: "2026-09-01T10:00:00Z" },
    ], me)).toBe(2);
  });
  it("ignores my own messages, old messages and groups I'm not in", () => {
    expect(unreadGroupCount(memberships, [
      { group_id: "g1", sender_id: "me", created_at: "2026-10-05T10:00:00Z" },
      { group_id: "g1", sender_id: "coach", created_at: "2026-09-30T10:00:00Z" },
      { group_id: "gX", sender_id: "coach", created_at: "2026-10-05T10:00:00Z" },
    ], me)).toBe(0);
  });
});

describe("unread state never comes back from the on-device cache", () => {
  it("does not persist thread lists or badge state", () => {
    for (const key of ["direct-threads", "crew-threads", "community-activity", "client-nav-badges"]) {
      expect(shouldPersistQueryKey([key, "x"]), key).toBe(false);
    }
  });

  it("the client hook no longer renders a bare dot on Messages", () => {
    const hook = readFileSync("src/hooks/use-client-nav-badges.ts", "utf8");
    expect(hook).toContain('result["/portal/messages"] = { count: messagesCount }');
    expect(hook).not.toMatch(/\/portal\/messages"\][^\n]*dot: true/);
  });
});
