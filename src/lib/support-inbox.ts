/**
 * Support messenger: member support tickets and app alerts in one chat-style inbox.
 * Pure helpers (tested) — the screen is src/components/support/support-messenger.tsx.
 */

export type SupportFilter = "needs" | "members" | "alerts" | "done";

export type SupportItem = {
  kind: "ticket" | "alert";
  id: string;
  name: string;
  avatar: string | null;
  title: string;
  preview: string;
  at: string;
  unread: number;
  needsYou: boolean;
  done: boolean;
};

export const SUPPORT_FILTERS: Array<{ value: SupportFilter; label: string }> = [
  { value: "needs", label: "Needs you" },
  { value: "members", label: "Member tickets" },
  { value: "alerts", label: "App alerts" },
  { value: "done", label: "Done" },
];

type Ticket = {
  id: string;
  status: string;
  unread_for_team?: number | null;
  last_member_message_at?: string | null;
  last_team_message_at?: string | null;
  updated_at?: string | null;
  created_at: string;
  member?: { full_name?: string | null; email?: string | null; avatar_url?: string | null } | null;
  last_message?: { body?: string | null; category?: string | null; sender_role?: string | null } | null;
};

type Alert = {
  id: string;
  status: string;
  client_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  clients?: { full_name?: string | null; profile_picture_url?: string | null } | null;
};

const CATEGORY_LABEL: Record<string, string> = { question: "Question", bug: "Bug report", suggestion: "Suggestion" };

export function ticketItem(t: Ticket): SupportItem {
  const last = t.last_message;
  const you = last?.sender_role && last.sender_role !== "member" ? "You: " : "";
  return {
    kind: "ticket",
    id: t.id,
    name: t.member?.full_name?.trim() || t.member?.email || "Member",
    avatar: t.member?.avatar_url ?? null,
    title: CATEGORY_LABEL[last?.category ?? ""] ?? "Support",
    preview: `${you}${(last?.body ?? "").replace(/\s+/g, " ").trim()}` || "New ticket",
    at: [t.last_member_message_at, t.last_team_message_at, t.updated_at, t.created_at]
      .filter(Boolean).sort().pop() as string,
    unread: Math.max(0, t.unread_for_team ?? 0),
    needsYou: t.status === "open" || (t.unread_for_team ?? 0) > 0,
    done: t.status === "closed",
  };
}

export function alertItem(a: Alert, title: string, summary: string): SupportItem {
  return {
    kind: "alert",
    id: a.id,
    name: a.client_id ? a.clients?.full_name?.trim() || "Client" : "System check",
    avatar: a.clients?.profile_picture_url ?? null,
    title,
    preview: summary,
    at: a.updated_at ?? a.created_at,
    unread: 0,
    needsYou: a.status !== "resolved",
    done: a.status === "resolved",
  };
}

export function filterSupportItems(items: SupportItem[], f: SupportFilter): SupportItem[] {
  const keep = items.filter((i) =>
    f === "needs" ? i.needsYou
    : f === "members" ? i.kind === "ticket" && !i.done
    : f === "alerts" ? i.kind === "alert" && !i.done
    : i.done,
  );
  return keep.sort((a, b) => b.at.localeCompare(a.at));
}

export function supportCounts(items: SupportItem[]): Record<SupportFilter, number> {
  return {
    needs: items.filter((i) => i.needsYou).length,
    members: items.filter((i) => i.kind === "ticket" && !i.done).length,
    alerts: items.filter((i) => i.kind === "alert" && !i.done).length,
    done: items.filter((i) => i.done).length,
  };
}

/** `sub` search param for an open conversation: "t:<id>" / "a:<id>". */
export function parseSupportSub(sub: string | undefined): { kind: "ticket" | "alert"; id: string } | null {
  const m = /^(t|a):([0-9a-f-]{36})$/i.exec(sub ?? "");
  return m ? { kind: m[1] === "t" ? "ticket" : "alert", id: m[2] } : null;
}
export const supportSub = (kind: "ticket" | "alert", id: string) => `${kind === "ticket" ? "t" : "a"}:${id}`;
