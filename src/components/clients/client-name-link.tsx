import { forwardRef, type MouseEvent, type ReactNode } from "react";
import { useOpenClientProfile, type ClientProfileTab } from "@/lib/open-client-profile";
import { cn } from "@/lib/utils";

type Props = {
  clientId: string;
  tab?: ClientProfileTab;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
  /** When true, render an anchor that supports ⌘-click / new-tab open. Defaults to true. */
  anchor?: boolean;
  onClick?: (e: MouseEvent) => void;
};

/**
 * Opens the client profile in the overlay workspace on plain left-click,
 * but preserves ⌘-click / middle-click / right-click "open in new tab"
 * behavior by rendering a real anchor pointing at the standalone route.
 */
export const ClientNameLink = forwardRef<HTMLAnchorElement, Props>(function ClientNameLink(
  { clientId, tab, className, children, ariaLabel, title, onClick },
  ref,
) {
  const open = useOpenClientProfile();
  const href = tab
    ? `/admin/clients/${clientId}?tab=${encodeURIComponent(tab)}`
    : `/admin/clients/${clientId}`;
  return (
    <a
      ref={ref}
      href={href}
      title={title}
      aria-label={ariaLabel}
      className={cn(className)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        open(clientId, { tab, event: e });
      }}
    >
      {children}
    </a>
  );
});