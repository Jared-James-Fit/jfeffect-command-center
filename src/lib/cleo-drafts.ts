/**
 * What's typed to Cleo and not sent yet stays on the device (Nov 24 2026): per
 * person and per conversation (a new conversation's draft per client, or the
 * general one), so switching pages, closing the panel, refreshing or closing
 * the app never loses it. Kept 30 days, at most 60 drafts. Browser storage is
 * a convenience: everything works without it (private mode).
 */
const PREFIX = "jf.cleo.drafts.v1:";
const MAX_AGE_MS = 30 * 86_400_000;
const MAX_DRAFTS = 60;

type Store = Record<string, { text: string; at: number }>;

/** The draft's place: a conversation, or a new one for a client (or the general one). */
export function draftKey(chatId: string | null | undefined, clientId: string | null | undefined): string {
  return chatId ? `chat:${chatId}` : `new:${clientId ?? "general"}`;
}

function read(userId: string): Store {
  try {
    const raw = window.localStorage.getItem(PREFIX + userId);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Store) : {};
  } catch {
    return {};
  }
}

function write(userId: string, store: Store) {
  try {
    const now = Date.now();
    const kept = Object.entries(store)
      .filter(([, d]) => d && typeof d.text === "string" && d.text.trim() && now - d.at < MAX_AGE_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_DRAFTS);
    if (kept.length) window.localStorage.setItem(PREFIX + userId, JSON.stringify(Object.fromEntries(kept)));
    else window.localStorage.removeItem(PREFIX + userId);
  } catch {
    // private mode or full: the draft lasts the visit
  }
}

export function readDraft(userId: string | null | undefined, key: string): string {
  if (!userId) return "";
  const d = read(userId)[key];
  return d && Date.now() - d.at < MAX_AGE_MS ? d.text : "";
}

export function writeDraft(userId: string | null | undefined, key: string, text: string) {
  if (!userId) return;
  const store = read(userId);
  if (text.trim()) store[key] = { text, at: Date.now() };
  else delete store[key];
  write(userId, store);
}

export function clearDraft(userId: string | null | undefined, key: string) {
  writeDraft(userId, key, "");
}

/** A new conversation's draft moves to the conversation it became. */
export function moveDraft(userId: string | null | undefined, from: string, to: string) {
  if (!userId || from === to) return;
  const store = read(userId);
  if (store[from]) {
    store[to] = store[from];
    delete store[from];
    write(userId, store);
  }
}
