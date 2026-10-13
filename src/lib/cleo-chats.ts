/**
 * Cleo's chats (summer_chats): what a chat is called, when a fresh one
 * starts, and how History groups them. Pure, shared by the server and the UI.
 */

/** After this long with no messages, opening Cleo starts a fresh chat (the old one is in History). */
export const CHAT_GAP_MS = 6 * 60 * 60_000;
/** Chats with no activity for this long are cleared (prune_cleo_chats, daily). */
export const CHAT_RETENTION_DAYS = 365;

export type CleoChat = { id: string; title: string; preview: string | null; created_at: string; last_message_at: string };

/** Still the chat you're in: the latest one, if it had a message in the last 6 hours. */
export function isCurrentChat(lastMessageAt: string, now = Date.now()): boolean {
  const t = Date.parse(lastMessageAt);
  return Number.isFinite(t) && now - t < CHAT_GAP_MS;
}

const GREETING = /^(?:(?:hey|hi|hello|yo|ok(?:ay)?|so)[\s,!.]+)?(?:cleo|summer)\b[\s,!.:-]*/i;

/** A chat's name: its first question, without "Hey Cleo,", cut at a word near 60 characters. */
export function chatTitle(message: string): string {
  let t = String(message ?? "").replace(/\s+/g, " ").trim().replace(GREETING, "").trim();
  if (!t) return "New chat";
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const space = cut.lastIndexOf(" ");
    t = `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** History's sections: Today, Yesterday, Previous 7 days, Previous 30 days, then by month. */
export function groupChats<T extends { last_message_at: string }>(chats: T[], now = new Date(), timeZone = "America/Winnipeg"): Array<{ label: string; chats: T[] }> {
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const today = dayKey(now);
  const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86_400_000;
  const todayN = dayNumber(today);
  const out: Array<{ label: string; chats: T[] }> = [];
  const push = (label: string, chat: T) => {
    const last = out[out.length - 1];
    if (last && last.label === label) last.chats.push(chat);
    else out.push({ label, chats: [chat] });
  };
  for (const c of [...chats].sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))) {
    const d = new Date(c.last_message_at);
    const ago = todayN - dayNumber(dayKey(d));
    const label =
      ago <= 0 ? "Today"
      : ago === 1 ? "Yesterday"
      : ago < 7 ? "Previous 7 days"
      : ago < 30 ? "Previous 30 days"
      : d.toLocaleDateString("en-CA", { timeZone, month: "long", year: "numeric" });
    push(label, c);
  }
  return out;
}
