import { useCallback, useEffect, useState } from "react";
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/platform/notifications";

/**
 * Tracks current notification permission and exposes a request fn.
 * MUST be called from a user gesture handler. Respects denial — never re-prompts.
 */
export function useNotificationPermission() {
  const [state, setState] = useState<NotificationPermissionState>(() =>
    typeof window === "undefined" ? "unsupported" : getNotificationPermission(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVis = () => setState(getNotificationPermission());
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const request = useCallback(async () => {
    const next = await requestNotificationPermission();
    setState(next);
    return next;
  }, []);

  return {
    state,
    canPrompt: state === "default",
    granted: state === "granted",
    denied: state === "denied",
    unsupported: state === "unsupported",
    request,
  };
}