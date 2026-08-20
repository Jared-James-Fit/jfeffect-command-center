export type NotificationPageView = "new" | "all" | "archived";

/**
 * The standalone notifications route does not inherit the admin AppShell, so
 * it owns top and bottom PWA safe-area spacing while retaining natural page
 * scrolling. Desktop spacing is restored by the scoped stylesheet rule.
 */
export const NOTIFICATIONS_PAGE_SHELL_CLASS =
  "notifications-page-shell mx-auto flex w-full max-w-2xl min-w-0 flex-col px-3 sm:px-4 sm:py-6";

/** Full-page notification centers default to a complete, actionable inbox. */
export function initialNotificationView(fullPage: boolean): NotificationPageView {
  return fullPage ? "all" : "new";
}

/** Full-page feeds participate in document scrolling; transient bell surfaces do not. */
export function notificationListScrollClass(fullPage: boolean): string {
  return fullPage ? "flex-1 min-w-0" : "flex-1 min-w-0 overflow-y-auto";
}

export const NOTIFICATIONS_PWA_SAFE_AREA_TOP = "max(0.75rem, env(safe-area-inset-top))";
export const NOTIFICATIONS_PWA_SAFE_AREA_BOTTOM = "calc(1rem + env(safe-area-inset-bottom))";
export const TOAST_PWA_SAFE_AREA_TOP = "calc(max(3.5rem, env(safe-area-inset-top)) + 0.75rem)";
