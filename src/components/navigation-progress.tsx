import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Slim top progress bar shown while a route navigation/loader is pending.
 * Appears only after 150ms so instant transitions never flicker, and never
 * replaces the current screen — the app shell, header, and bottom nav stay
 * fully visible underneath.
 */
export function NavigationProgress() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      aria-hidden
    >
      <div className="h-0.5 w-full overflow-hidden bg-primary/15">
        <div className="h-full w-1/3 animate-nav-progress rounded-full bg-primary" />
      </div>
    </div>
  );
}