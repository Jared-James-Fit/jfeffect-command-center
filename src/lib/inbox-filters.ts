/**
 * The four filters every Messages list leads with, the coach's and the
 * client's alike (iMessage / Instagram DMs): All, Unread, Groups and 1:1 Chats.
 * Pure, so the coach inbox, the client inbox and their tests read one rule.
 */

export type PrimaryFilter = "all" | "unread" | "groups" | "direct";

export const PRIMARY_FILTERS: ReadonlyArray<{ key: PrimaryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "groups", label: "Groups" },
  { key: "direct", label: "1:1 Chats" },
];

/** A row as the filters see it: a group chat (coach-run or a member's crew) or a 1:1 (the coach chat, a DM, a member's Support chat). */
export type FilterableChat = { kind: "group" | "direct"; unread: boolean };

/** Whether a chat shows under a primary filter. The list and its count read the same rule. */
export function inPrimary(chat: FilterableChat, filter: PrimaryFilter): boolean {
  switch (filter) {
    case "unread": return chat.unread;
    case "groups": return chat.kind === "group";
    case "direct": return chat.kind === "direct";
    default: return true;
  }
}

/** Pinned chats first (in the order given), then the rest as they came (newest first). */
export function pinnedFirst<T>(rows: readonly T[], isPinned: (row: T) => boolean): T[] {
  return [...rows.filter(isPinned), ...rows.filter((r) => !isPinned(r))];
}

/** What a count reads as on a chip: "99+" past 99. */
export function chipCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}
