import { describe, expect, it } from "vitest";
import { NotificationPanel } from "@/components/notification-bell";
import {
  initialNotificationView,
  NOTIFICATIONS_PAGE_SHELL_CLASS,
  NOTIFICATIONS_PWA_SAFE_AREA_BOTTOM,
  NOTIFICATIONS_PWA_SAFE_AREA_TOP,
  notificationListScrollClass,
  TOAST_PWA_SAFE_AREA_TOP,
} from "@/lib/notifications-page-layout";

describe("notifications page responsive layout", () => {
  it("keeps the shared panel available for both the bell and full-page route", () => {
    expect(NotificationPanel).toBeTypeOf("function");
  });

  it("uses a standalone safe-area-aware shell instead of relying on the admin route wrapper", () => {
    expect(NOTIFICATIONS_PAGE_SHELL_CLASS).toContain("notifications-page-shell");
    expect(NOTIFICATIONS_PAGE_SHELL_CLASS).toContain("min-w-0");
    expect(NOTIFICATIONS_PWA_SAFE_AREA_TOP).toContain("env(safe-area-inset-top)");
    expect(NOTIFICATIONS_PWA_SAFE_AREA_BOTTOM).toContain("env(safe-area-inset-bottom)");
  });

  it("opens the full page on All while preserving New as the compact bell default", () => {
    expect(initialNotificationView(true)).toBe("all");
    expect(initialNotificationView(false)).toBe("new");
  });

  it("uses natural page scrolling for the full page and bounded scrolling for transient bell surfaces", () => {
    expect(notificationListScrollClass(true)).not.toContain("overflow-y-auto");
    expect(notificationListScrollClass(false)).toContain("overflow-y-auto");
  });

  it("places every mobile toast below the dynamic-island safe area", () => {
    expect(TOAST_PWA_SAFE_AREA_TOP).toContain("env(safe-area-inset-top)");
    expect(TOAST_PWA_SAFE_AREA_TOP).toContain("0.75rem");
  });
});
