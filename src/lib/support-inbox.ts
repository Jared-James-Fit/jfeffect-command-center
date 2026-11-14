/**
 * App alerts (Communication → Alerts): a client's app hit a problem, such as a
 * workout that wouldn't load or sync. Pure helpers (tested); the screen is
 * src/components/support/support-messenger.tsx. Members' Support chats are not
 * here: they're rows in 1:1 Chats (member-support.ts).
 */
import { newestFirst } from "@/lib/recency";

export type SupportFilter = "needs" | "done";

export type SupportItem = {
  kind: "alert";
  id: string;
  name: string;
  avatar: string | null;
  title: string;
  preview: string;
  at: string;
  needsYou: boolean;
  done: boolean;
};

export const SUPPORT_FILTERS: Array<{ value: SupportFilter; label: string }> = [
  { value: "needs", label: "Needs you" },
  { value: "done", label: "Resolved" },
];

type Alert = {
  id: string;
  status: string;
  client_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  clients?: { full_name?: string | null; profile_picture_url?: string | null } | null;
};

export function alertItem(a: Alert, title: string, summary: string): SupportItem {
  return {
    kind: "alert",
    id: a.id,
    name: a.client_id ? a.clients?.full_name?.trim() || "Client" : "System check",
    avatar: a.clients?.profile_picture_url ?? null,
    title,
    preview: summary,
    at: a.updated_at ?? a.created_at,
    needsYou: a.status !== "resolved",
    done: a.status === "resolved",
  };
}

export function filterSupportItems(items: SupportItem[], f: SupportFilter): SupportItem[] {
  return items.filter((i) => (f === "needs" ? i.needsYou : i.done)).sort((a, b) => newestFirst(a.at, b.at));
}

export function supportCounts(items: SupportItem[]): Record<SupportFilter, number> {
  return {
    needs: items.filter((i) => i.needsYou).length,
    done: items.filter((i) => i.done).length,
  };
}

/** `sub` search param for an open alert: "a:<id>". (Old "t:<id>" ticket links open the member's chat in 1:1 Chats.) */
export function parseSupportSub(sub: string | undefined): { kind: "alert"; id: string } | null {
  const m = /^a:([0-9a-f-]{36})$/i.exec(sub ?? "");
  return m ? { kind: "alert", id: m[1] } : null;
}
export const supportSub = (id: string) => `a:${id}`;
