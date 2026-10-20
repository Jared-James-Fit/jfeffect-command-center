import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestOf, newestFirst, timeOf } from "@/lib/recency";
import { filterSupportItems, type SupportItem } from "@/lib/support-inbox";

describe("every conversation list is newest first (iMessage / Instagram DMs)", () => {
  it("compares times, not strings: 'Z', '+00:00' and fractions sort by the moment", () => {
    const rows = [
      { id: "4 days", at: "2026-10-16T02:00:00Z" },
      { id: "a minute ago", at: "2026-10-20T00:01:00.5+00:00" },
      { id: "same second, earlier", at: "2026-10-20T00:01:00Z" },
      { id: "never", at: null },
      { id: "3 days", at: "2026-10-17 02:00:00+00" },
    ];
    expect(rows.sort((a, b) => newestFirst(a.at, b.at)).map((r) => r.id))
      .toEqual(["a minute ago", "same second, earlier", "3 days", "4 days", "never"]);
    expect(timeOf("not a date")).toBe(0);
    // Postgres text form, which Safari's Date.parse refuses as-is
    expect(timeOf("2026-10-17 02:00:00.123456+00")).toBe(Date.UTC(2026, 9, 17, 2, 0, 0, 123));
  });

  it("latestOf picks the newest activity", () => {
    expect(latestOf(null, "2026-10-01T00:00:00Z", "2026-10-03T00:00:00+00:00", undefined)).toBe("2026-10-03T00:00:00+00:00");
    expect(latestOf(null, undefined)).toBeNull();
  });

  it("the coach inbox: newest first in every filter, no status-first order", () => {
    const route = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
    expect(route).toContain(".sort((a, b) => newestFirst(\n        latestOf(a.last?.created_at, a.liftReview?.latestAt),");
    expect(route).not.toContain('filter === "Follow Up" ? at.localeCompare(bt)');
  });

  it("the client / member inbox and Groups: one newest-first list (the coach stays pinned on top)", () => {
    const pane = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    expect(pane).toContain("return rows.sort((a, b) => newestFirst(a.at, b.at));");
    expect(pane).not.toContain("localeCompare(a.at)");
  });

  it("Support: newest first too", () => {
    const item = (id: string, at: string): SupportItem => ({ kind: "ticket", id, name: id, avatar: null, title: "", preview: "", at, unread: 0, needsYou: true, done: false });
    const sorted = filterSupportItems([item("old", "2026-10-01T00:00:00Z"), item("new", "2026-10-19T23:59:00.123+00:00")], "needs");
    expect(sorted.map((i) => i.id)).toEqual(["new", "old"]);
  });
});
