/**
 * Where member applications reach the coach without another inbox: a row
 * pinned in Messages (under Coaching leads) and a card on Home, both only
 * while someone is waiting, both opening Applications → Members on them.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { UserCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CHAT_ROW_AVATAR, ChatListRow, chatAge } from "@/components/messages/chat-list-row";
import { applicationLine, needsFirstReply } from "@/lib/membership-apply";
import { useMemberApplications } from "@/components/applications/use-member-applications";

export function MemberApplicationsInboxRow() {
  const navigate = useNavigate();
  const { enabled, pending, firstReply } = useMemberApplications();
  if (!enabled || pending.length === 0) return null;
  const latest = firstReply[0] ?? pending[0]!;
  return (
    <ChatListRow
      data-member-applications-row
      avatar={
        <span
          className="flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
          style={{ width: CHAT_ROW_AVATAR, height: CHAT_ROW_AVATAR }}
        >
          <UserCheck className="h-6 w-6" />
        </span>
      }
      name="Member applications"
      preview={`${latest.full_name} applied · ${applicationLine(latest)}`}
      at={latest.created_at}
      unread={firstReply.length > 0}
      unreadLabel={`${pending.length} waiting`}
      after={
        pending.length > 1 ? (
          <span className="text-[13px] font-semibold text-muted-foreground">{pending.length}</span>
        ) : undefined
      }
      onClick={() =>
        navigate({ to: "/admin/leads", search: { tab: "members", app: latest.id } as any })
      }
    />
  );
}

export function NewApplicationsCard() {
  const { enabled, pending } = useMemberApplications();
  if (!enabled || pending.length === 0) return null;
  return (
    <Card className="p-4" data-new-applications>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          {pending.length === 1 ? "1 member application" : `${pending.length} member applications`}
        </h2>
        <Link
          to="/admin/leads"
          search={{ tab: "members" } as any}
          className="shrink-0 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Review →
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {pending.slice(0, 3).map((a) => (
          <li key={a.id}>
            <Link
              to="/admin/leads"
              search={{ tab: "members", app: a.id } as any}
              className="flex items-center gap-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{a.full_name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {applicationLine(a)} · {chatAge(a.created_at)}
                </span>
              </span>
              {needsFirstReply(a) && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                  aria-label="Not messaged yet"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
