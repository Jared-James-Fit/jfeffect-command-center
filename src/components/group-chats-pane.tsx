import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { ChevronLeft, Plus, Settings2, Users, Archive, Trash2, CheckSquare, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  listMyGroups, listAllGroupsForAdmin, listMyGroupMemberships,
  listGroupMemberProfiles, type GroupMemberProfile,
  type ChatGroup,
} from "@/lib/group-chats";
import { deleteGroupChats, updateGroupChat } from "@/lib/group-chats.functions";
import { GroupMessageThread } from "@/components/group-message-thread";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { ManageGroupDialog } from "@/components/manage-group-dialog";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { useGroupPresence } from "@/hooks/use-group-presence";
import { LiveDot } from "@/hooks/use-chat-presence";
import { directThreadsKey, isUnread, useDirectThreads } from "@/lib/direct-chats";
import { DirectChatView, DirectRow, RequestsEntry, RequestsList } from "@/components/direct-chat";
import { crewThreadsKey, isCrewUnread, useCrewThreads } from "@/lib/crew-chats";
import { CreateCrewSheet, CrewChatView, CrewRow } from "@/components/crew-chat";

export function GroupChatsPane({ asAdmin }: { asAdmin: boolean }) {
  const { user, role } = useAuth();
  // Coach "View as client": show the client's groups and read state.
  const { isImpersonating } = useClientImpersonation();
  const viewerId = usePortalUserId() ?? null;
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, true>>({});
  const deleteGroupsFn = useServerFn(deleteGroupChats);
  const renameGroupFn = useServerFn(updateGroupChat);
  const isAdmin = role === "admin";

  // Deep-link support: /portal/messages#group=<uuid> or
  // /admin/communication?tab=groups#group=<uuid> auto-selects the group so
  // tapping a push notification lands the user right in the conversation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readHash = () => {
      const m = window.location.hash.match(/group=([0-9a-f-]{36})/i);
      if (m) setSelectedId(m[1]);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const { data: groups = [] } = useQuery({
    queryKey: ["chat-groups", asAdmin],
    queryFn: () => (asAdmin ? listAllGroupsForAdmin() : listMyGroups()),
  });

  // Member-to-member chats (and requests). Private to the two people, so
  // never in the coach's list or in "View as client".
  const { data: rawDirects } = useDirectThreads(!asAdmin && !isImpersonating);
  const directs = Array.isArray(rawDirects) ? rawDirects : [];
  const requests = directs.filter((t) => t.incoming);
  const directChats = directs.filter((t) => !t.incoming);
  const me = viewerId ?? user?.id ?? null;
  // Group chats members started (and invites to them): same privacy as DMs.
  const { data: rawCrews } = useCrewThreads(!asAdmin && !isImpersonating);
  const crews = Array.isArray(rawCrews) ? rawCrews : [];
  const crewInvites = crews.filter((t) => t.status === "invited");
  const crewChats = crews.filter((t) => t.status === "joined");
  const [crewOpen, setCrewOpen] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const selectedDirect = directs.find((t) => t.group_id === selectedId) ?? null;
  const selectedCrew = crews.find((t) => t.group_id === selectedId) ?? null;
  const requestCount = requests.length + crewInvites.length;
  // Opened from a "Message request" / invite push: back goes to the requests.
  const openedRequest = !!selectedDirect?.incoming || selectedCrew?.status === "invited";
  useEffect(() => {
    if (openedRequest) setShowRequests(true);
  }, [openedRequest]);

  const { data: memberships = [] } = useQuery({
    queryKey: ["group-memberships", viewerId],
    enabled: !!viewerId,
    queryFn: () => listMyGroupMemberships(viewerId!),
  });
  const membershipRows = Array.isArray(memberships) ? memberships : [];
  const groupRows = useMemo(() => {
    const rows = Array.isArray(groups) ? groups : [];
    if (asAdmin || !isImpersonating) return rows;
    const mine = new Set(membershipRows.map((m) => m.group_id));
    return rows.filter((g) => mine.has(g.id));
  }, [groups, asAdmin, isImpersonating, membershipRows]);

  const lastReadByGroup = useMemo(
    () => new Map(membershipRows.map((m) => [m.group_id, m.last_read_at])),
    [membershipRows],
  );

  // Unread counts per group
  const { data: lastMsgByGroup = {} as Record<string, any> } = useQuery({
    queryKey: ["group-last-messages", groupRows.map((g) => g.id).join(",")],
    enabled: groupRows.length > 0,
    refetchOnMount: "always", // realtime only runs while this pane is open
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

  const resyncGroups = () => {
    for (const k of ["chat-groups", "group-memberships", "group-last-messages", "group-unread", "direct-threads", "crew-threads"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  useResyncOnResume(resyncGroups);

  // Realtime invalidation across groups
  useEffect(() => {
    const ch = supabase
      .channel("groups-pane")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_groups" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
        qc.invalidateQueries({ queryKey: ["group-memberships"] });
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_direct_closed" }, () => {
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, (payload: any) => {
        const row = payload?.new;
        if (payload?.eventType === "INSERT" && row?.group_id && row?.created_at) {
          // The event carries the row: show the new preview/time now, no refetch.
          qc.setQueriesData<Record<string, any>>({ queryKey: ["group-last-messages"] }, (prev) => {
            if (!prev) return prev;
            const cur = prev[row.group_id];
            if (cur && new Date(cur.created_at).getTime() >= new Date(row.created_at).getTime()) return prev;
            return { ...prev, [row.group_id]: { group_id: row.group_id, created_at: row.created_at, body: row.body, sender_id: row.sender_id } };
          });
        } else {
          qc.invalidateQueries({ queryKey: ["group-last-messages"] });
        }
        qc.invalidateQueries({ queryKey: ["group-unread"] });
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
      })
      .subscribe(onRealtimeRejoin(() => {
        for (const k of ["chat-groups", "group-memberships", "group-last-messages", "group-unread", "direct-threads", "crew-threads"]) {
          qc.invalidateQueries({ queryKey: [k] });
        }
      }));
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const visibleGroups = useMemo(() => {
    return groupRows
      .map((g) => {
        const last = (lastMsgByGroup as Record<string, any>)?.[g.id];
        const lastReadStr = lastReadByGroup.get(g.id) ?? null;
        const lastRead = lastReadStr ? new Date(lastReadStr).getTime() : 0;
        const unread = last && new Date(last.created_at).getTime() > lastRead && last.sender_id !== (viewerId ?? user?.id) ? 1 : 0;
        return { group: g, last, unread };
      })
      .sort((a, b) => {
        const at = a.last?.created_at ?? a.group.updated_at ?? "";
        const bt = b.last?.created_at ?? b.group.updated_at ?? "";
        return bt.localeCompare(at);
      });
  }, [groupRows, lastMsgByGroup, lastReadByGroup, user?.id, viewerId]);

  // Coach groups, member groups and 1:1 chats in one list, newest activity first.
  const listRows = useMemo(() => {
    const rows: Array<{ at: string; group?: (typeof visibleGroups)[number]; direct?: (typeof directChats)[number]; crew?: (typeof crewChats)[number] }> = [
      ...visibleGroups.map((g) => ({ at: g.last?.created_at ?? g.group.updated_at ?? "", group: g })),
      ...directChats.map((t) => ({ at: t.last_at, direct: t })),
      ...crewChats.map((t) => ({ at: t.last_at, crew: t })),
    ];
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [visibleGroups, directChats, crewChats]);

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

  const renameGroup = async () => {
    if (!selected) return;
    const next = window.prompt("Rename group chat", selected.name)?.trim();
    if (!next || next === selected.name) return;
    try {
      await renameGroupFn({ data: { group_id: selected.id, name: next } as any });
      toast.success("Group renamed");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not rename group");
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Sidebar list */}
      <aside className={cn(
        "flex w-full flex-col border-r border-border bg-card md:w-[300px] md:shrink-0",
        selected || selectedDirect || selectedCrew ? "hidden md:flex" : "flex",
      )}>
        {showRequests && !asAdmin ? (
          <RequestsList
            threads={requests}
            crews={crewInvites}
            me={me}
            selectedId={selectedId}
            onOpen={setSelectedId}
            onBack={() => { setShowRequests(false); if (openedRequest) setSelectedId(null); }}
          />
        ) : (<>
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-bold tracking-tight">{asAdmin ? "Group chats" : "Chats"}</div>
          {!asAdmin && !isImpersonating && (
            <Button size="sm" variant="ghost" onClick={() => setCrewOpen(true)}>
              <Plus className="mr-1 h-3 w-3" /> New group
            </Button>
          )}
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
          {requestCount > 0 && !selectMode && (
            <RequestsEntry
              count={requestCount}
              fresh={requests.some((t) => isUnread(t, me)) || crewInvites.some((t) => isCrewUnread(t, me))}
              onClick={() => setShowRequests(true)}
            />
          )}
          {listRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {asAdmin ? "No groups yet. Create one to get started." : "No chats yet. Start a group, or tap the send icon on someone's post to message them."}
            </div>
          ) : listRows.map((row) => row.crew ? (
            <CrewRow
              key={row.crew.group_id}
              thread={row.crew}
              me={me}
              selected={selectedId === row.crew.group_id}
              onClick={() => setSelectedId(row.crew!.group_id)}
            />
          ) : row.direct ? (
            <DirectRow
              key={row.direct.group_id}
              thread={row.direct}
              me={me}
              selected={selectedId === row.direct.group_id}
              onClick={() => setSelectedId(row.direct!.group_id)}
            />
          ) : row.group && (({ group, last, unread }) => (
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
              <div className="min-w-0 flex-1 overflow-hidden">
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
          ))(row.group))}
        </div>
        </>)}
      </aside>

      {/* Thread pane */}
      <section className={cn("flex min-w-0 flex-1 flex-col", selected || selectedDirect || selectedCrew ? "flex" : "hidden md:flex")}>
        {selectedCrew && !asAdmin ? (
          <CrewChatView key={selectedCrew.group_id} thread={selectedCrew} onBack={() => setSelectedId(null)} />
        ) : selectedDirect && !asAdmin ? (
          <DirectChatView key={selectedDirect.group_id} thread={selectedDirect} onBack={() => setSelectedId(null)} />
        ) : selected ? (
          <>
            <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setSelectedId(null)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold">{selected.name}</span>
                  {(asAdmin || isAdminOfGroup) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Rename group"
                      onClick={renameGroup}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
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
            <GroupChatErrorBoundary key={`thread-${selected.id}`}>
              <GroupMessageThread
                groupId={selected.id}
                groupName={selected.name}
                canPost={canPost}
                canManage={asAdmin || isAdminOfGroup}
              />
            </GroupChatErrorBoundary>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            {asAdmin ? "Select a group to start." : "Select a chat to start."}
          </div>
        )}
      </section>

      {asAdmin && <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {!asAdmin && <CreateCrewSheet open={crewOpen} onOpenChange={setCrewOpen} onCreated={(id) => { setShowRequests(false); setSelectedId(id); }} />}
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
  const visible = (members as GroupMemberProfile[]).slice(0, 2);
  const extra = Math.max(0, members.length - visible.length);
  const anyLive = visible.some((m) => liveIds.has(m.user_id));

  if (visible.length === 0) {
    return (
      <div className="pointer-events-none grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Users className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none relative flex h-10 shrink-0 items-center"
      style={{ width: visible.length === 1 ? 36 : 50 }}
    >
      <div className="flex -space-x-2.5">
        {visible.map((m) => (
          <UserAvatar
            key={m.user_id}
            src={m.avatar_url}
            name={m.full_name ?? "Member"}
            size={32}
            tone="neutral"
            expandable={false}
            className="border-2 border-card"
          />
        ))}
      </div>
      {anyLive && (
        <span className="absolute -bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
      )}
      {extra > 0 && (
        <span className="absolute -bottom-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-secondary px-1 text-[9px] font-bold leading-none text-foreground ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Client Messenger's "Chats" toggle: any groups or 1:1 chats? + how many are new. */
export function useMyGroupSummary() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const viewerId = usePortalUserId() ?? null;
  const { data: rawGroups = [] } = useQuery({
    queryKey: ["chat-groups", false],
    queryFn: listMyGroups,
    enabled: !!user,
  });
  const { data: rawMemberships = [] } = useQuery({
    queryKey: ["group-memberships", viewerId],
    enabled: !!viewerId,
    queryFn: () => listMyGroupMemberships(viewerId!),
  });
  const memberships = Array.isArray(rawMemberships) ? rawMemberships : [];
  const allGroups = Array.isArray(rawGroups) ? rawGroups : [];
  const memberGroupIds = new Set(memberships.map((m: any) => m.group_id));
  const groups = isImpersonating ? allGroups.filter((g: any) => memberGroupIds.has(g.id)) : allGroups;
  const { data: rawLastMsgs = [] } = useQuery({
    queryKey: ["group-unread", viewerId, groups.map((g: any) => g.id).join(",")],
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
    if (row.sender_id !== viewerId && new Date(row.created_at).getTime() > lastReadMs) {
      unread += 1;
    }
  }
  // 1:1 chats and message requests count once each while there's something new.
  const { data: rawDirects } = useDirectThreads(!isImpersonating);
  const directs = Array.isArray(rawDirects) ? rawDirects : [];
  for (const t of directs) if (isUnread(t, viewerId ?? user?.id)) unread += 1;
  const { data: rawCrews } = useCrewThreads(!isImpersonating);
  const crews = Array.isArray(rawCrews) ? rawCrews : [];
  for (const t of crews) if (isCrewUnread(t, viewerId ?? user?.id)) unread += 1;
  return {
    hasGroups: groups.length > 0 || directs.length > 0 || crews.length > 0,
    unread,
    groups,
    requests: directs.filter((t) => t.incoming).length + crews.filter((t) => t.status === "invited").length,
  };
}