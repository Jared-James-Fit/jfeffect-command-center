import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ChevronLeft, Pencil, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LiveMark } from "@/components/live-indicator";
import { GroupMessageThread } from "@/components/group-message-thread";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { ManageGroupDialog } from "@/components/manage-group-dialog";
import { useGroupPresence } from "@/hooks/use-group-presence";
import { useAuth } from "@/lib/auth";
import { usePortalUserId } from "@/lib/client-impersonation";
import { groupDisplayName, groupPreview, type GroupLastMessage } from "@/lib/group-row";
import { GroupAvatarCluster } from "@/components/messages/group-avatar";
import { listGroupMemberProfiles, type ChatGroup, type GroupMemberProfile } from "@/lib/group-chats";
import { updateGroupChat } from "@/lib/group-chats.functions";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";

type PresenceRole = "admin" | "coach" | "client" | "member";

export function presenceRoleOf(role: string | null | undefined): PresenceRole {
  return role === "admin" ? "admin" : role === "coach" ? "coach" : "client";
}

/**
 * A coach-run group chat, open: its header (back on a phone, the name,
 * who's here now, Manage for whoever runs it) and the thread. One view for
 * the coach's inbox and the client's.
 */
export function GroupThreadPane({
  group,
  canManage,
  onBack,
}: {
  group: ChatGroup;
  /** Staff, or the group's own admin: rename and Manage. */
  canManage: boolean;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const [manageOpen, setManageOpen] = useState(false);
  const renameGroupFn = useServerFn(updateGroupChat);
  const { liveCount } = useGroupPresence(group.id, presenceRoleOf(role));
  const canPost = !group.archived && (group.permission_mode === "everyone" || (group.permission_mode === "admins_only" && canManage));

  const renameGroup = async () => {
    const next = window.prompt("Rename group chat", group.name)?.trim();
    if (!next || next === group.name) return;
    try {
      await renameGroupFn({ data: { group_id: group.id, name: next } as any });
      toast.success("Group renamed");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not rename group");
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 md:hidden" onClick={onBack} aria-label="All chats">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <GroupCover groupId={group.id} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{group.name}</span>
            {canManage && (
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" title="Rename group" aria-label="Rename group" onClick={renameGroup}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {liveCount > 0 ? (
              <LiveMark className="font-semibold">{liveCount} active now</LiveMark>
            ) : (
              group.description || (group.permission_mode === "read_only" ? "View and react only" : group.permission_mode === "admins_only" ? "Coach posts only" : "Everyone can post")
            )}
          </div>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
            <Settings2 className="mr-1 h-3.5 w-3.5" /> Manage
          </Button>
        )}
      </header>
      <GroupChatErrorBoundary key={`thread-${group.id}`}>
        <GroupMessageThread groupId={group.id} groupName={group.name} canPost={canPost} canManage={canManage} />
      </GroupChatErrorBoundary>
      {canManage && <ManageGroupDialog open={manageOpen} onOpenChange={setManageOpen} group={group} />}
    </>
  );
}

function useGroupMembers(groupId: string) {
  const { data } = useQuery({
    queryKey: ["group-member-profiles", groupId],
    queryFn: () => listGroupMemberProfiles(groupId),
    staleTime: 60_000,
  });
  return Array.isArray(data) ? (data as GroupMemberProfile[]) : [];
}

/**
 * A coach-run group's picture: the other people in it (2–4 faces, "+N" past
 * that), anyone here now with the live ring. Read from the group's own
 * members, so it follows who's in it.
 */
export function GroupCover({ groupId, size = CHAT_ROW_AVATAR }: { groupId: string; size?: number }) {
  const { user, role } = useAuth();
  const me = usePortalUserId() ?? user?.id ?? null;
  const members = useGroupMembers(groupId);
  const { others } = useGroupPresence(groupId, presenceRoleOf(role));
  const live = new Set(others.map((p) => p.user_id));
  const faces = members.filter((m) => m.user_id !== me).map((m) => ({ user_id: m.user_id, name: m.full_name ?? "Member", avatar_url: m.avatar_url }));
  return <GroupAvatarCluster faces={faces} size={size} live={live} />;
}

/**
 * A coach-run group in a list, read like a 1:1 row: its picture, its name,
 * "Marc: 📷 Photo · 5m", the blue dot while there's something new.
 */
export function GroupChatRow({
  group, last, unread, selected, muted, pinned, leading, onClick,
}: {
  group: ChatGroup;
  last: GroupLastMessage & { created_at?: string | null };
  unread: boolean;
  selected?: boolean;
  muted?: boolean;
  pinned?: boolean;
  leading?: ReactNode;
  onClick: () => void;
}) {
  const { user } = useAuth();
  const me = usePortalUserId() ?? user?.id ?? null;
  const members = useGroupMembers(group.id);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.full_name;
  const others = members.filter((m) => m.user_id !== me).map((m) => ({ name: m.full_name }));
  return (
    <ChatListRow
      onClick={onClick}
      selected={selected}
      dim={group.archived}
      unread={unread}
      muted={muted}
      pinned={pinned}
      at={last?.created_at ?? null}
      leading={leading}
      avatar={<GroupCover groupId={group.id} />}
      name={groupDisplayName(group.name, others)}
      preview={groupPreview(last, me, nameOf)}
      after={group.archived ? <Archive className="h-4 w-4 text-muted-foreground" aria-label="Archived" /> : undefined}
      data-group-row={group.id}
    />
  );
}
