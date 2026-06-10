import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { ChevronLeft, Plus, Settings2, Users, Archive, Trash2, CheckSquare, X } from "lucide-react";
import { toast } from "sonner";
import {
  listMyGroups, listAllGroupsForAdmin, listMyGroupMemberships,
  listGroupMemberProfiles, type GroupMemberProfile,
  type ChatGroup,
} from "@/lib/group-chats";
import { deleteGroupChats } from "@/lib/group-chats.functions";
import { GroupMessageThread } from "@/components/group-message-thread";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { ManageGroupDialog } from "@/components/manage-group-dialog";
import { useGroupPresence } from "@/hooks/use-group-presence";
import { LiveDot } from "@/hooks/use-chat-presence";

export function GroupChatsPane({ asAdmin }: { asAdmin: boolean }) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, true>>({});
  const deleteGroupsFn = useServerFn(deleteGroupChats);
  const isAdmin = role === "admin";

  const { data: groups = [] } = useQuery({
    queryKey: ["chat-groups", asAdmin],
    queryFn: () => (asAdmin ? listAllGroupsForAdmin() : listMyGroups()),
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["group-memberships", user?.id],
    enabled: !!user,
    queryFn: () => listMyGroupMemberships(user!.id),
  });
  const groupRows = Array.isArray(groups) ? groups : [];
  const membershipRows = Array.isArray(memberships) ? memberships : [];

  const lastReadByGroup = useMemo(
    () => new Map(membershipRows.map((m) => [m.group_id, m.last_read_at])),
    [membershipRows],
  );

  // Unread counts per group
  const { data: lastMsgByGroup = {} as Record<string, any> } = useQuery({
    queryKey: ["group-last-messages", groupRows.map((g) => g.id).join(",")],
    enabled: groupRows.length > 0,
    queryFn: async () => {
      const ids = groupRows.map((g) => g.id);
      try {
        const { data, error } = await (supabase.from("group_messages") as any)
          .select("group_id, created_at, body, sender_id")
          .in("group_id", ids)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[GroupChat] last-messages query failed", error);
          return {} as Record<string, any>;
        }
        const m: Record<string, any> = {};
        for (const row of (data ?? [])) if (!m[row.group_id]) m[row.group_id] = row;
        return m;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[GroupChat] last-messages threw", e);
        return {} as Record<string, any>;
      }
    },
    refetchInterval: 30_000,
  });

  // Realtime invalidation across groups
  useEffect(() => {
    const ch = supabase
      .channel("groups-pane")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_groups" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
        qc.invalidateQueries({ queryKey: ["group-memberships"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["group-last-messages"] });
        qc.invalidateQueries({ queryKey: ["group-unread"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const visibleGroups = useMemo(() => {
    return groupRows
      .map((g) => {
        const last = (lastMsgByGroup as Record<string, any>)?.[g.id];
        const lastReadStr = lastReadByGroup.get(g.id) ?? null;
        const lastRead = lastReadStr ? new Date(lastReadStr).getTime() : 0;
        const unread = last && new Date(last.created_at).getTime() > lastRead && last.sender_id !== user?.id ? 1 : 0;
        return { group: g, last, unread };
      })
      .sort((a, b) => {
        const at = a.last?.created_at ?? a.group.updated_at ?? "";
        const bt = b.last?.created_at ?? b.group.updated_at ?? "";
        return bt.localeCompare(at);
      });
  }, [groupRows, lastMsgByGroup, lastReadByGroup, user?.id]);

  const selected = groupRows.find((g) => g.id === selectedId);
  const myMembership = selected ? membershipRows.find((m) => m.group_id === selected.id) : undefined;
  const isAdminOfGroup = asAdmin || myMembership?.role === "admin";
  const canPost = (() => {
    if (!selected) return false;
    if (selected.archived) return false;
    if (selected.permission_mode === "everyone") return true;
    if (selected.permission_mode === "admins_only") return isAdminOfGroup;
    return false; // read_only
  })();

  const myPresenceRole: "admin" | "coach" | "client" | "member" =
    role === "admin" ? "admin" : role === "coach" ? "coach" : "client";
  const { liveCount } = useGroupPresence(selected?.id ?? null, myPresenceRole);

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Sidebar list */}
      <aside className={cn(
        "flex w-full flex-col border-r border-border bg-card md:w-[300px] md:shrink-0",
        selected ? "hidden md:flex" : "flex",
      )}>
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-bold tracking-tight">Group chats</div>
          {asAdmin && (
            <div className="flex items-center gap-1">
              {isAdmin && (
                <Button
                  size="sm"
                  variant={selectMode ? "secondary" : "ghost"}
                  onClick={() => { setSelectMode((s) => !s); setChecked({}); }}
                  title={selectMode ? "Cancel selection" : "Select multiple"}
                >
                  {selectMode ? <X className="mr-1 h-3 w-3" /> : <CheckSquare className="mr-1 h-3 w-3" />}
                  {selectMode ? "Cancel" : "Select"}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3 w-3" /> New
              </Button>
            </div>
          )}
        </header>
        {selectMode && isAdmin && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1.5">
            <span className="text-xs font-semibold">
              {Object.keys(checked).length} selected
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={Object.keys(checked).length === 0}
              onClick={async () => {
                const ids = Object.keys(checked);
                if (ids.length === 0) return;
                if (!window.confirm(`Permanently delete ${ids.length} group${ids.length > 1 ? "s" : ""} and all their messages?`)) return;
                try {
                  await deleteGroupsFn({ data: { group_ids: ids } as any });
                  toast.success(`Deleted ${ids.length}`);
                  setChecked({});
                  setSelectMode(false);
                  if (selectedId && ids.includes(selectedId)) setSelectedId(null);
                  qc.invalidateQueries({ queryKey: ["chat-groups"] });
                } catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Delete
            </Button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {asAdmin ? "No groups yet. Create one to get started." : "No group chats yet."}
            </div>
          ) : visibleGroups.map(({ group, last, unread }) => (
            <div
              key={group.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (selectMode) {
                  setChecked((s) => { const n = { ...s }; if (n[group.id]) delete n[group.id]; else n[group.id] = true; return n; });
                } else {
                  setSelectedId(group.id);
                }
              }}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40",
                selectedId === group.id && !selectMode && "bg-secondary/60",
                selectMode && checked[group.id] && "bg-primary/10",
                group.archived && "opacity-60",
              )}
            >
              {selectMode && (
                <Checkbox
                  className="mt-1"
                  checked={!!checked[group.id]}
                  onCheckedChange={(v) => setChecked((s) => { const n = { ...s }; if (v) n[group.id] = true; else delete n[group.id]; return n; })}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <GroupCover groupId={group.id} myRole={myPresenceRole} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>
                    {group.name}
                  </span>
                  {group.archived && <Archive className="h-3 w-3 text-muted-foreground" />}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn("flex-1 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                    {last?.body || "No messages yet"}
                  </span>
                  {unread > 0 && (
                    <Badge className="h-4 min-w-[16px] rounded-full px-1 text-[10px]">{unread}</Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Thread pane */}
      <section className={cn("flex min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
        {selected ? (
          <>
            <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setSelectedId(null)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{selected.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {liveCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LiveDot />
                      <span className="font-semibold text-emerald-600">
                        {liveCount} active now
                      </span>
                    </span>
                  ) : (
                    selected.description || (selected.permission_mode === "read_only" ? "View/react only" : selected.permission_mode === "admins_only" ? "Coach posts only" : "Everyone can post")
                  )}
                </div>
              </div>
              {(asAdmin || isAdminOfGroup) && (
                <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
                  <Settings2 className="mr-1 h-3 w-3" /> Manage
                </Button>
              )}
            </header>
            <GroupMessageThread
              groupId={selected.id}
              groupName={selected.name}
              canPost={canPost}
              canManage={asAdmin || isAdminOfGroup}
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Select a group to start.
          </div>
        )}
      </section>

      {asAdmin && <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {selected && (asAdmin || isAdminOfGroup) && (
        <ManageGroupDialog open={manageOpen} onOpenChange={setManageOpen} group={selected} />
      )}
    </div>
  );
}

/** Stacked member avatars with a green live-now dot if anyone is present. */
function GroupCover({ groupId, myRole }: { groupId: string; myRole: "admin" | "coach" | "client" | "member" }) {
  const { data: rawMembers = [] } = useQuery({
    queryKey: ["group-member-profiles", groupId],
    queryFn: () => listGroupMemberProfiles(groupId),
    staleTime: 60_000,
  });
  const { others } = useGroupPresence(groupId, myRole);
  const members = Array.isArray(rawMembers) ? rawMembers : [];
  const liveIds = new Set(others.map((p) => p.user_id));
  const visible = (members as GroupMemberProfile[]).slice(0, 3);
  const extra = Math.max(0, members.length - visible.length);

  if (visible.length === 0) {
    return (
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Users className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center">
      <div className="flex -space-x-2">
        {visible.map((m) => (
          <div key={m.user_id} className="relative">
            <UserAvatar
              src={m.avatar_url}
              name={m.full_name ?? "Member"}
              size={28}
              tone="neutral"
              expandable={false}
              className="border-2 border-card"
            />
            {liveIds.has(m.user_id) && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
            )}
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-1 text-[10px] font-semibold text-muted-foreground">+{extra}</span>
      )}
    </div>
  );
}

/** Hook used by client portal toggle to show "do they have any groups?" + unread badge. */
export function useMyGroupSummary() {
  const { user } = useAuth();
  const { data: rawGroups = [] } = useQuery({
    queryKey: ["chat-groups", false],
    queryFn: listMyGroups,
    enabled: !!user,
  });
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  const { data: rawMemberships = [] } = useQuery({
    queryKey: ["group-memberships", user?.id],
    enabled: !!user,
    queryFn: () => listMyGroupMemberships(user!.id),
  });
  const memberships = Array.isArray(rawMemberships) ? rawMemberships : [];
  const { data: rawLastMsgs = [] } = useQuery({
    queryKey: ["group-unread", user?.id],
    enabled: !!user && groups.length > 0,
    queryFn: async () => {
      const ids = groups.map((g: ChatGroup) => g.id);
      const { data } = await (supabase.from("group_messages") as any)
        .select("group_id, sender_id, created_at")
        .in("group_id", ids)
        .order("created_at", { ascending: false })
        .limit(500);
      return data ?? [];
    },
    refetchInterval: 45_000,
  });
  const lastMsgs = Array.isArray(rawLastMsgs) ? rawLastMsgs : [];

  const lastReadByGroup = new Map(memberships.map((m) => [m.group_id, m.last_read_at]));
  let unread = 0;
  const seen = new Set<string>();
  for (const row of lastMsgs) {
    if (seen.has(row.group_id)) continue;
    seen.add(row.group_id);
    const lastRead = lastReadByGroup.get(row.group_id);
    const lastReadMs = lastRead ? new Date(lastRead).getTime() : 0;
    if (row.sender_id !== user?.id && new Date(row.created_at).getTime() > lastReadMs) {
      unread += 1;
    }
  }
  return { hasGroups: groups.length > 0, unread, groups };
}