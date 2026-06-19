import type { ReactElement, MouseEvent } from "react";
import { cloneElement, isValidElement } from "react";
import { toast } from "sonner";
import { useOnlineStatus } from "@/hooks/use-online-status";

type Props = {
  /** Child must accept `disabled` (e.g. a Button, button, or input). */
  children: ReactElement<{
    disabled?: boolean;
    onClick?: (e: MouseEvent) => void;
    title?: string;
    "aria-disabled"?: boolean;
  }>;
  /** Short reason shown in the toast/tooltip when blocked offline. */
  reason?: string;
};

/**
 * Disables a control while the browser is offline and explains why if the
 * user still taps it. Use for anything that REQUIRES a network round-trip
 * to complete safely: payments, signup, messaging, uploads, coach/admin edits.
 *
 * Local-first writes (workout logs, bodyweight, water, etc.) must NOT use
 * this — they fall back to the offline queue instead.
 */
export function RequiresOnline({ children, reason }: Props) {
  const online = useOnlineStatus();
  if (!isValidElement(children)) return children as unknown as ReactElement;
  if (online) return children;
  const message = reason ?? "This action needs an internet connection.";
  return cloneElement(children, {
    disabled: true,
    "aria-disabled": true,
    title: message,
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toast.warning("You're offline", { description: message });
    },
  });
}

/**
 * Imperative variant for code paths that aren't a single child element.
 * Returns `{ online, ensureOnline }` — call `ensureOnline()` in event
 * handlers; if it returns `false`, the toast was already shown.
 */
export function useRequireOnline(reason?: string): {
  online: boolean;
  ensureOnline: () => boolean;
} {
  const online = useOnlineStatus();
  const ensureOnline = () => {
    if (online) return true;
    toast.warning("You're offline", {
      description: reason ?? "This action needs an internet connection.",
    });
    return false;
  };
  return { online, ensureOnline };
}