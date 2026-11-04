/**
 * The Leads row pinned in the coach's Messages (admin, under Cleo): the
 * latest application, the blue dot and a count while anyone is waiting on
 * you. Opens Leads, where each one has the AI's read and a text to send.
 */
import { useNavigate } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";
import { leadLine, leadNeeds } from "@/lib/coaching-leads";
import { useLeads } from "@/components/leads/use-leads";

export function LeadsInboxRow() {
  const navigate = useNavigate();
  const { leads, waiting, enabled } = useLeads();
  if (!enabled || leads.length === 0) return null;
  const latest = waiting[0] ?? leads[0];
  const needs = leadNeeds(latest.app);
  const preview =
    needs === "follow_up"
      ? `Follow up with ${latest.app.full_name ?? "them"}`
      : `${latest.app.full_name ?? "Someone"} applied${leadLine(latest.app) ? ` · ${leadLine(latest.app)}` : ""}`;
  return (
    <ChatListRow
      data-leads-row
      avatar={
        <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground" style={{ width: CHAT_ROW_AVATAR, height: CHAT_ROW_AVATAR }}>
          <UserPlus className="h-6 w-6" />
        </span>
      }
      name="Coaching leads"
      preview={preview}
      at={needs === "follow_up" ? latest.app.follow_up_at : latest.app.created_at}
      unread={waiting.length > 0}
      unreadLabel={`${waiting.length} waiting`}
      after={waiting.length > 1 ? <span className="text-[13px] font-semibold text-muted-foreground">{waiting.length}</span> : undefined}
      onClick={() => navigate({ to: "/admin/leads", search: latest && needs ? { id: latest.app.id } : {} })}
    />
  );
}
