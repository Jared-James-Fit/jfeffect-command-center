import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronLeft, Plus, Settings2, Users, Archive } from "lucide-react";
import {
  listMyGroups, listAllGroupsForAdmin, listMyGroupMemberships,
  type ChatGroup,
} from "@/lib/group-chats";
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

  const { data: groups = [] } = useQuery({
    queryKey: ["chat-groups", asAdmin],
    queryFn: () => (asAdmin ? listAllGroupsForAdmin() : listMyGroups()),
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["group-memberships", user?.id],
    enabled: !!user,
    queryFn: () => listMyGroupMemberships(user!.id),
  });

  const lastReadByGroup = useMemo(
    () => new Map(memberships.map((m) => [m.group_id, m.last_read_at])),
    [memberships],
  );

  // Unread counts per group
  const { data: lastMsgByGroup = new Map() } = useQuery({
    queryKey: ["group-last-messages", groups.map((g) => g.id).join(",")],
    enabled: groups.length > 0,
    queryFn: async () => {
      const ids = groups.map((g) => g.id);
      const { data } = await (supabase.from("group_messages") as any)
        .select("group_id, created_at, body, sender_id")
        .in("group_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000);
      const m = new Map<string, any>();
      for (const row of (data ?? [])) if (!m.has(row.group_id)) m.set(row.group_id, row);
      return m;
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
    return groups
      .map((g) => {
        const last = lastMsgByGroup.get(g.id);
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
  }, [groups, lastMsgByGroup, lastReadByGroup, user?.id]);

  const selected = groups.find((g) => g.id === selectedId);
  const myMembership = selected ? memberships.find((m) => m.group_id === selected.id) : undefined;
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
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3 w-3" /> New
            </Button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {asAdmin ? "No groups yet. Create one to get started." : "No group chats yet."}
            </div>
          ) : visibleGroups.map(({ group, last, unread }) => (
            <button
              key={group.id}
              onClick={() => setSelectedId(group.id)}
              className={cn(
                "flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40",
                selectedId === group.id && "bg-secondary/60",
                group.archived && "opacity-60",
              )}
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
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
            </button>
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

/** Hook used by client portal toggle to show "do they have any groups?" + unread badge. */
export function useMyGroupSummary() {
  const { user } = useAuth();
  const { data: groups = [] } = useQuery({
    queryKey: ["chat-groups", false],
    queryFn: listMyGroups,
    enabled: !!user,
  });
  const { data: memberships = [] } = useQuery({
    queryKey: ["group-memberships", user?.id],
    enabled: !!user,
    queryFn: () => listMyGroupMemberships(user!.id),
  });
  const { data: lastMsgs = [] } = useQuery({
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