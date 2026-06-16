// Web Notifications. Capacitor-ready (swap with @capacitor/push-notifications).

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Request notification permission. MUST be called from a user gesture.
 * Returns the resulting permission state. Never auto-prompts on mount.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const current = getNotificationPermission();
  if (current === "unsupported" || current === "granted" || current === "denied") return current;
  try {
    const res = await Notification.requestPermission();
    return res as NotificationPermissionState;
  } catch {
    return "default";
  }
}

export function canShowNotifications(): boolean {
  return getNotificationPermission() === "granted";
}