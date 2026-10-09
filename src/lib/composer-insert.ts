// Put text into a chat's composer from elsewhere on the page (e.g. "Reply
// about this workout" in the coach's workout peek). The thread for that client
// listens and fills its composer; other threads ignore it.

export const COMPOSER_INSERT_EVENT = "jf:composer-insert";

export type ComposerInsertDetail = { clientId: string; text: string };

export function insertIntoComposer(clientId: string, text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ComposerInsertDetail>(COMPOSER_INSERT_EVENT, { detail: { clientId, text } }));
}
