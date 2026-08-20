/**
 * The editor is a constrained flex column: header/footer never shrink while
 * exactly one inner region owns vertical scrolling. This keeps Radix's
 * background scroll lock separate from the modal-body scroll container.
 */
export const BIRTHDAY_EDITOR_DIALOG_CLASS =
  "birthday-card-editor-dialog flex w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]";

export const BIRTHDAY_EDITOR_SCROLL_REGION_CLASS =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6";

export const BIRTHDAY_EDITOR_FOOTER_CLASS =
  "shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6";

export const BIRTHDAY_EDITOR_HEADER_CLASS =
  "shrink-0 border-b border-border px-4 py-3 sm:px-6 sm:py-4";
export const BIRTHDAY_EDITOR_BACK_ROW_CLASS = "birthday-card-editor-back-row";
export const BIRTHDAY_EDITOR_DESCRIPTION_CLASS = "birthday-card-editor-description";
export const BIRTHDAY_EDITOR_MOBILE_SAFE_VIEWPORT =
  "calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)))";

export const BIRTHDAY_EDITOR_TABS_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden";

export const BIRTHDAY_EDITOR_TABS_LIST_CLASS =
  "mx-4 mt-3 shrink-0 grid w-fit grid-cols-2 sm:mx-6";

export const BIRTHDAY_EDITOR_PREVIEW_CLASS =
  `${BIRTHDAY_EDITOR_SCROLL_REGION_CLASS} py-6`;

export const BIRTHDAY_EDITOR_EDIT_CONTENT_CLASS =
  `${BIRTHDAY_EDITOR_SCROLL_REGION_CLASS} mt-0 data-[state=inactive]:hidden`;

export const BIRTHDAY_EDITOR_PREVIEW_CONTENT_CLASS =
  `${BIRTHDAY_EDITOR_SCROLL_REGION_CLASS} mt-0 data-[state=inactive]:hidden`;

