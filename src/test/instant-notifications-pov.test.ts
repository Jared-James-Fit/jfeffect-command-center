import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initialNotificationView } from "@/lib/notifications-page-layout";

describe("instant notification center", () => {
  const source = readFileSync("src/components/notification-bell.tsx", "utf8");

  it("opens on the complete inbox and acknowledges current notifications once", () => {
    expect(initialNotificationView(false)).toBe("all");
    expect(initialNotificationView(true)).toBe("all");
    expect(source).toContain("autoSeenOnceRef");
    expect(source).toContain('rpc("notif_mark_read", toPairs(targets))');
    expect(source).toContain("Mark notifications seen once per center open");
  });

  it("does not let an old read/archive state hide a newer source event", () => {
    expect(source).toContain("readAt >= eventAt && readAt > 0");
    expect(source).toContain("archivedAt >= eventAt && archivedAt > 0");
  });

  it("uses a short realtime debounce and foreground refresh", () => {
    expect(source).toContain("NOTIFICATION_REALTIME_DEBOUNCE_MS = 75");
    expect(source).toContain('refetchOnWindowFocus: "always"');
  });
});

describe("messages client POV shortcuts", () => {
  const messages = readFileSync("src/routes/_authenticated/admin/messages.tsx", "utf8");
  const banner = readFileSync("src/components/client-pov-banner.tsx", "utf8");
  const picker = readFileSync("src/components/client-pov-quick-picker.tsx", "utf8");

  it("offers one-tap profile and POV actions for the selected client", () => {
    expect(messages).toContain("useClientImpersonation");
    expect(messages).toContain("enterSelectedClientPov");
    expect(messages).toContain('title="Open client profile"');
    expect(messages).toContain('title="View client POV"');
    expect(messages).toContain("id, user_id, full_name");
  });

  it("lets the coach switch clients in POV without losing the coach return path", () => {
    expect(banner).toContain("open-client-pov-picker");
    expect(banner).toContain("<span>Switch</span>");
    expect(banner).toContain("<span>Coach</span>");
    expect(picker).toContain("impersonation.isImpersonating && impersonation.returnTo");
  });
});
