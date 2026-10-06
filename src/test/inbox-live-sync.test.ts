import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMessageChange, belongsInInbox, resolveOptimistic, upsertRow } from "@/lib/inbox-cache";
import type { Message } from "@/lib/messages";

const m = (id: string, at: string, extra: Partial<Message> = {}): Message =>
  ({ id, client_id: "c1", sender_id: "u", sender_role: "client", body: id, attachments: [], created_at: at, ...extra } as unknown as Message);

const list = [m("c", "2026-10-06T10:03:00Z"), m("b", "2026-10-06T10:02:00Z"), m("a", "2026-10-06T10:01:00Z")];

describe("inbox cache patching", () => {
  it("puts a new message first so the preview, time and sort update instantly", () => {
    const next = applyMessageChange(list, { eventType: "INSERT", new: m("d", "2026-10-06T10:04:00Z") })!;
    expect(next.map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("keeps newest-first order for a message that lands out of order", () => {
    const next = upsertRow(list, m("x", "2026-10-06T10:02:30Z"));
    expect(next.map((x) => x.id)).toEqual(["c", "x", "b", "a"]);
  });

  it("replaces on update (edit, read receipt, delete placeholder) without duplicating", () => {
    const next = applyMessageChange(list, { eventType: "UPDATE", new: m("b", "2026-10-06T10:02:00Z", { body: "edited" }) })!;
    expect(next.filter((x) => x.id === "b")).toHaveLength(1);
    expect(next.find((x) => x.id === "b")!.body).toBe("edited");
  });

  it("drops deleted rows and rows that become hidden (internal notes, not yet delivered)", () => {
    expect(applyMessageChange(list, { eventType: "DELETE", old: { id: "c" } })!.map((x) => x.id)).toEqual(["b", "a"]);
    expect(applyMessageChange(list, { eventType: "UPDATE", new: m("c", "2026-10-06T10:03:00Z", { is_internal_note: true }) })!.map((x) => x.id)).toEqual(["b", "a"]);
    expect(belongsInInbox(m("z", "2026-10-06T10:05:00Z", { delivery_status: "scheduled" } as any))).toBe(false);
    expect(belongsInInbox(m("z", "2026-10-06T10:05:00Z", { is_internal_note: true }))).toBe(false);
  });

  it("returns the same array when nothing relevant changed, and ignores events before the first load", () => {
    expect(applyMessageChange(list, { eventType: "DELETE", old: { id: "nope" } })).toBe(list);
    expect(applyMessageChange(undefined, { eventType: "INSERT", new: m("d", "2026-10-06T10:04:00Z") })).toBeUndefined();
  });

  it("swaps an optimistic row for the saved one, and removes it if the send failed", () => {
    const withTemp = upsertRow(list, m("optimistic-1", "2026-10-06T10:05:00Z"));
    const saved = resolveOptimistic(withTemp, "optimistic-1", m("real-1", "2026-10-06T10:05:01Z"))!;
    expect(saved.map((x) => x.id)).toEqual(["real-1", "c", "b", "a"]);
    // realtime may deliver the real row first: still exactly one copy afterwards
    const early = upsertRow(withTemp, m("real-1", "2026-10-06T10:05:01Z"));
    expect(resolveOptimistic(early, "optimistic-1", m("real-1", "2026-10-06T10:05:01Z"))!.filter((x) => x.id === "real-1")).toHaveLength(1);
    expect(resolveOptimistic(withTemp, "optimistic-1", null)!.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("inbox wiring", () => {
  const route = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
  const thread = readFileSync("src/components/message-thread.tsx", "utf8");
  it("patches the list from realtime and no longer re-downloads it on every message event", () => {
    expect(route).toContain("applyMessageChange(");
    expect(route).not.toMatch(/table: "messages" \}, \(\) => \{\s*scheduleInvalidate\(\["last-messages"/);
  });
  it("patches the group list preview from realtime inserts too", () => {
    const groups = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    expect(groups).toContain('payload?.eventType === "INSERT"');
    expect(groups).toContain("qc.setQueriesData");
  });
  it("updates the inbox the instant an admin sends, and keeps relative times ticking", () => {
    expect(thread).toContain("resolveOptimistic(");
    expect(route).toContain("setInterval(");
  });
});
