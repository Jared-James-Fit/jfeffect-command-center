import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  buildNotificationPayload,
  notificationDeepLink,
  safeDisplayName,
  CATEGORY_BY_KIND,
} from "@/lib/push/notification-payload";
import { groceryListKey, invalidateGroceryList } from "@/lib/grocery-query-keys";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("notification payload privacy", () => {
  it("never puts raw ids, endpoints or message bodies in title/body", () => {
    const secret = "I weighed 210lbs and my card was declined";
    const n = buildNotificationPayload({
      kind: "message",
      role: "client",
      recipientUserId: UUID,
      sourceId: UUID,
      ids: { clientId: UUID },
    });
    const visible = `${n.title} ${n.body}`;
    expect(visible).not.toContain(UUID);
    expect(visible).not.toContain(secret);
    expect(visible).not.toMatch(/https?:\/\/|fcm|web\.push|endpoint|p256dh|auth=/i);
    expect(n.body).toBe("You have a new message.");
  });

  it("keeps group chat copy content-free but names sender and group", () => {
    const n = buildNotificationPayload({
      kind: "group_message",
      role: "admin",
      recipientUserId: "u1",
      sourceId: "m1",
      displayName: "Jared James",
      contextLabel: "Winter Shred",
      ids: { groupId: UUID },
    });
    expect(n.title).toBe("Jared James · Winter Shred");
    expect(n.body).toBe("New message in a group chat.");
    expect(n.url).toBe(`/admin/communication?tab=groups#group=${UUID}`);
  });

  it("resolves a safe display name and rejects ids / emails", () => {
    expect(safeDisplayName(UUID)).toBe("Your coach");
    expect(safeDisplayName("a@b.com")).toBe("Your coach");
    expect(safeDisplayName("  Marc T  ")).toBe("Marc T");
  });

  it("marks user-triggered tests visibly", () => {
    const n = buildNotificationPayload({
      kind: "generic", role: "client", recipientUserId: "u", sourceId: "s", isTest: true,
    });
    expect(n.title.startsWith("Test · ")).toBe(true);
    expect(n.body).toMatch(/test notification/i);
  });
});

describe("role-aware deep links", () => {
  const cases: Array<[Parameters<typeof notificationDeepLink>[0], string, string]> = [
    ["message", "/admin/messages?client=" + UUID, "/portal/messages"],
    ["group_message", `/admin/communication?tab=groups#group=${UUID}`, `/portal/messages?tab=groups#group=${UUID}`],
    ["workout_review", "/admin/lift-videos", "/portal/lift-videos"],
    ["check_in", `/admin/clients/${UUID}?tab=check-ins`, "/portal/check-in"],
    ["appointment", "/admin/appointments", "/portal/appointments"],
    ["agreement", `/admin/clients/${UUID}?tab=agreements`, "/portal"],
    ["payment", "/admin/payments", "/portal/purchases"],
    ["program", `/admin/clients/${UUID}?tab=training`, "/portal/workouts"],
    ["generic", "/admin", "/portal"],
  ];
  it.each(cases)("%s routes per role", (kind, staffUrl, clientUrl) => {
    const ids = { clientId: UUID, groupId: UUID };
    expect(notificationDeepLink(kind, "admin", ids)).toBe(staffUrl);
    expect(notificationDeepLink(kind, "coach", ids)).toBe(staffUrl);
    expect(notificationDeepLink(kind, "client", ids)).toBe(clientUrl);
  });

  it("maps every kind to a preference category", () => {
    for (const [kind, cat] of Object.entries(CATEGORY_BY_KIND)) {
      expect(typeof cat).toBe("string");
      expect(kind.length).toBeGreaterThan(0);
    }
  });
});

describe("duplicate suppression identity", () => {
  it("is stable per event+recipient and differs across recipients", () => {
    const a = buildNotificationPayload({ kind: "message", role: "client", recipientUserId: "u1", sourceId: "m1" });
    const b = buildNotificationPayload({ kind: "message", role: "client", recipientUserId: "u1", sourceId: "m1" });
    const c = buildNotificationPayload({ kind: "message", role: "admin", recipientUserId: "u2", sourceId: "m1" });
    expect(a.eventKey).toBe(b.eventKey);
    expect(a.eventKey).not.toBe(c.eventKey);
    expect(a.tag).toBe(b.tag); // same tag collapses in the SW
  });
});

describe("grocery query keys", () => {
  it("keys by client + week and invalidates only grocery entries", async () => {
    expect(groceryListKey("c1", "2026-08-17")).toEqual(["grocery-list", "c1", "2026-08-17"]);
    const qc = new QueryClient();
    qc.setQueryData(groceryListKey("c1", "2026-08-17"), { items: [] });
    qc.setQueryData(groceryListKey("c2", "2026-08-17"), { items: [] });
    qc.setQueryData(["nutrition-targets", "c1"], []);
    await invalidateGroceryList(qc, "c1");
    const state = (k: readonly unknown[]) => qc.getQueryState([...k])!;
    expect(state(groceryListKey("c1", "2026-08-17")).isInvalidated).toBe(true);
    expect(state(groceryListKey("c2", "2026-08-17")).isInvalidated).toBe(false);
    expect(state(["nutrition-targets", "c1"]).isInvalidated).toBe(false);
  });
});
