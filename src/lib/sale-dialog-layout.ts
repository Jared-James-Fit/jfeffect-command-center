/**
 * Shared header layout contract for the Add Sale / Custom Sale modal.
 *
 * The old header used `pl-24` to dodge the client-workspace Back pill, which
 * floated over the title. The modal now owns ONE header grid:
 *
 *   [ ← Back ]        Add sale        [ X ]
 *
 * Exported as constants so the responsive rules are regression-testable
 * without rendering the whole workspace.
 */

/** Three-column grid: back / title / close. Never absolute positioning. */
export const SALE_DIALOG_HEADER_CLASS = [
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2",
  "border-b border-border",
  "px-3 py-2 sm:px-6 sm:py-3",
  // PWA / Dynamic Island: the header never sits under the status bar.
  "pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-3",
].join(" ");

/** Back control: real 44px touch target, subordinate to the title. */
export const SALE_DIALOG_BACK_CLASS = [
  "inline-flex h-10 min-h-[44px] shrink-0 items-center gap-1 rounded-full",
  "px-2 sm:px-3 text-sm font-semibold text-muted-foreground",
  "hover:bg-secondary hover:text-foreground",
].join(" ");

/** Title column truncates instead of pushing the close button off-screen at 320px. */
export const SALE_DIALOG_TITLE_CLASS = "min-w-0 truncate text-center text-base font-bold sm:text-lg";

export const SALE_DIALOG_CLOSE_CLASS =
  "inline-flex h-10 min-h-[44px] w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground";

/** Body scrolls; header and footer stay put, footer clears the home indicator. */
export const SALE_DIALOG_BODY_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-3 sm:px-6";

export const SALE_DIALOG_FOOTER_CLASS = [
  "border-t border-border px-3 py-3 sm:px-6",
  "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
].join(" ");

export const SALE_DIALOG_CONTENT_CLASS = [
  "flex w-full flex-col overflow-hidden p-0 gap-0",
  "max-h-[100dvh] h-[100dvh] max-w-none rounded-none",
  "sm:h-auto sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-lg",
  // Above the client-workspace overlay (z-50) so nothing overlaps the header.
  "z-[60]",
].join(" ");
