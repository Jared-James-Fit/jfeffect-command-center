// Put text into a chat's composer from elsewhere on the page (e.g. "Reply
// about this workout" in the coach's workout peek). The thread for that client
// listens and fills its composer; other threads ignore it.

export const COMPOSER_INSERT_EVENT = "jf:composer-insert";

export type ComposerInsertDetail = { clientId: string; text: string };

export function insertIntoComposer(clientId: string, text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ComposerInsertDetail>(COMPOSER_INSERT_EVENT, { detail: { clientId, text } }));
}

/**
 * Text for a chat that isn't open yet (the pain sheet's drafted reply, used
 * from Home): kept for this tab until that client's thread mounts and takes
 * it. A few minutes at most, so an old draft never surprises anyone.
 */
const QUEUE_KEY = (clientId: string) => `jf:composer-queue:${clientId}`;
const QUEUE_MS = 5 * 60_000;

export function queueComposerInsert(clientId: string, text: string) {
  try {
    sessionStorage.setItem(QUEUE_KEY(clientId), JSON.stringify({ text, at: Date.now() }));
  } catch {
    // private mode: the coach pastes it instead
  }
}

export function takeQueuedComposerInsert(clientId: string): string | null {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY(clientId));
    if (!raw) return null;
    sessionStorage.removeItem(QUEUE_KEY(clientId));
    const v = JSON.parse(raw) as { text?: string; at?: number };
    return v.text && v.at && Date.now() - v.at < QUEUE_MS ? v.text : null;
  } catch {
    return null;
  }
}
