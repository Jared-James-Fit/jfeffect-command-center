/**
 * Opening Cleo from anywhere in admin (Nov 24 2026): one small module with no
 * UI in it, so a button anywhere (the shell's bar, Messages' row, a screen's
 * "Ask Cleo") can open the panel without loading it.
 *
 * Events: "summer:open" (detail below), "summer:toggle", "summer:close". The
 * panel fires CLEO_PANEL_OPENED when it opens, so a docked specialty (the
 * program builder's, Nutrition's, Cardio's) folds away and only one Cleo is on
 * screen at a time; a dock opening fires "summer:close".
 */
export type SummerOpenDetail = {
  /** Taxes & Books: the year the books questions are about. */
  year?: number;
  /** Open straight into dictation (the mic on Cleo's row in Messages). */
  dictate?: boolean;
  /** Words put in the box (never sent) so a screen can ask about what's on it. */
  prompt?: string;
  /** Open this conversation. */
  chatId?: string;
  /** Open this client's conversation (else where the coach is). */
  clientId?: string;
  /** Open the general conversation, whatever page this is. */
  general?: boolean;
};

export const CLEO_PANEL_OPENED = "cleo:panel-opened";

export function openSummer(detail: SummerOpenDetail = {}) {
  try {
    window.dispatchEvent(new CustomEvent<SummerOpenDetail>("summer:open", { detail }));
  } catch {
    // SSR or a very old browser
  }
}

export function closeSummer() {
  try {
    window.dispatchEvent(new Event("summer:close"));
  } catch {
    // SSR
  }
}

/** ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere. */
export const CLEO_SHORTCUT_LABEL = "⌘⇧S";
