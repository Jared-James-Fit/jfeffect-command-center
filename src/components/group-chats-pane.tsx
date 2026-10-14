import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  BellOff, Check, ChevronLeft, Plus, Settings2, Users, Archive, Trash2, CheckSquare, X, Pencil, Search, ShieldOff, SquarePen, MailOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listMyGroups, listAllGroupsForAdmin, listMyGroupMemberships,
  listGroupMemberProfiles, markGroupRead, type GroupMemberProfile,
  type ChatGroup,
} from "@/lib/group-chats";
import { deleteGroupChats, updateGroupChat } from "@/lib/group-chats.functions";
import { GroupMessageThread } from "@/components/group-message-thread";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { ManageGroupDialog } from "@/components/manage-group-dialog";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { useGroupPresence } from "@/hooks/use-group-presence";
import { LiveAvatar, LiveMark } from "@/components/live-indicator";
import { directThreadsKey, isUnread, previewLine, useDirectThreads, type DirectThread } from "@/lib/direct-chats";
import { DirectChatView, DirectRow, RequestsEntry, RequestsList } from "@/components/direct-chat";
import { crewPreview, crewThreadsKey, isCrewUnread, useCrewThreads, type CrewThread } from "@/lib/crew-chats";
import { CreateCrewSheet, CrewChatView, CrewFaces, CrewRow } from "@/components/crew-chat";
import { listenChannel } from "@/lib/realtime-channel";
import { fmtTime } from "@/components/chat-shared";
import type { CommunityAuthor } from "@/lib/community";
import {
  MAX_PINS, deletePatch, isHidden, isMarkedUnread, isMuted, isPinned, pinnedKeys, useChatPrefs, useSetChatPrefs,
  type ChatPrefPatch,
} from "@/lib/chat-prefs";
import {
  BlockedPeopleSheet, ChatActionsSheet, ChatRowShell, NewMessageSheet, NewRequestView, PinTile, swipeActionsFor,
  type ChatMenuAction, type ChatMenuTarget,
} from "@/components/messages/inbox-parts";

/**
 * A conversation that isn't a group (the client's chat with their coach).
 * It's always pinned first, iMessage style: it can be marked unread, but
 * never unpinned, muted or deleted.
 */
export type PinnedChat = {
  id: string;
  name: string;
  avatarUrl: string | null;
  live?: boolean;
  /** The list row's second line. */
  preview: string;
  /** When the latest message was sent, already formatted. */
  when: string;
  unread?: boolean;
  /** What search matches against (name + latest message). */
  searchText?: string;
  renderThread: (p: { onBack: () => void }) => ReactNode;
  markUnread?: () => void | Promise<void>;
  markRead?: () => void | Promise<void>;
  /** Told when its conversation opens or closes (presence: "live" only while open). */
  onOpenChange?: (open: boolean) => void;
};

type ChatFilter = "all" | "unread" | "groups" | "people";

type VisibleGroup = { group: ChatGroup; last: any; unread: number };

/** One chat in the list, whatever kind it is. */
type Row = {
  key: string;
  at: string;
  title: string;
  preview: string;
  search: string;
  group?: VisibleGroup;
  direct?: DirectThread;
  crew?: CrewThread;
  unread: boolean;
  muted: boolean;
  pinned: boolean;
};

export function GroupChatsPane({ asAdmin, pinned }: { asAdmin: boolean; pinned?: PinnedChat }) {
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
  // Pins, Hide Alerts, Delete, Mark as Unread and New message are the
  // signed-in person's own. Not while a coach is viewing as a client.
  const canEdit = !isImpersonating;
  const { prefs } = useChatPrefs(canEdit, { live: true });
  const setPrefs = useSetChatPrefs();
  const [menu, setMenu] = useState<ChatMenuTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatMenuTarget[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draftTo, setDraftTo] = useState<CommunityAuthor | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);

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

  const { data: groups = [], isFetched: groupsFetched } = useQuery({
    queryKey: ["chat-groups", asAdmin],
    queryFn: () => (asAdmin ? listAllGroupsForAdmin() : listMyGroups()),
  });

  // Member-to-member chats (and requests). Private to the two people, so
  // never in the coach's list or in "View as client".
  const directsQ = useDirectThreads(!asAdmin && !isImpersonating);
  const rawDirects = directsQ.data;
  const directs = Array.isArray(rawDirects) ? rawDirects : [];
  const requests = directs.filter((t) => t.incoming);
  const directChats = directs.filter((t) => !t.incoming);
  const me = viewerId ?? user?.id ?? null;
  // Group chats members started (and invites to them): same privacy as DMs.
  const crewsQ = useCrewThreads(!asAdmin && !isImpersonating);
  const rawCrews = crewsQ.data;
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
    for (const k of ["chat-groups", "group-memberships", "group-last-messages", "group-unread", "direct-threads", "crew-threads", "chat-thread-prefs"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  useResyncOnResume(resyncGroups);

  // Realtime invalidation across groups
  useEffect(() => {
    const ch = listenChannel("groups-pane")
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

  const visibleGroups = useMemo((): VisibleGroup[] => {
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

  // Coach groups, member groups and 1:1 chats in one list, newest activity
  // first. A chat you deleted stays off until someone writes again.
  const allRows = useMemo((): Row[] => {
    const rows: Row[] = [];
    const add = (r: Omit<Row, "muted" | "pinned" | "unread"> & { natural: boolean }) => {
      if (canEdit && isHidden(prefs, r.key, r.at)) return;
      const { natural, ...rest } = r;
      rows.push({
        ...rest,
        unread: natural || (canEdit && isMarkedUnread(prefs, r.key)),
        muted: canEdit && isMuted(prefs, r.key),
        pinned: canEdit && isPinned(prefs, r.key),
      });
    };
    for (const g of visibleGroups) {
      add({
        key: g.group.id, at: g.last?.created_at ?? g.group.updated_at ?? "", title: g.group.name,
        preview: g.last?.body || "No messages yet", search: `${g.group.name} ${g.last?.body ?? ""}`,
        group: g, natural: !!g.unread,
      });
    }
    for (const t of directChats) {
      add({
        key: t.group_id, at: t.last_at, title: t.other?.name ?? "Member", preview: previewLine(t, me),
        search: `${t.other?.name ?? ""} ${t.last?.body ?? ""}`, direct: t, natural: isUnread(t, me),
      });
    }
    for (const t of crewChats) {
      add({
        key: t.group_id, at: t.last_at, title: t.name, preview: crewPreview(t, me),
        search: `${t.name} ${t.last?.body ?? ""}`, crew: t, natural: isCrewUnread(t, me),
      });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [visibleGroups, directChats, crewChats, prefs, canEdit, me]);

  // Search + filter, the same way for every messenger list.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const filtering = !!q || filter !== "all";
  const shownRows = useMemo(() => allRows.filter((row) => {
    if (filter === "people" && !row.direct) return false;
    if (filter === "groups" && row.direct) return false;
    if (filter === "unread" && !row.unread) return false;
    return matches(row.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allRows, filter, q]);
  const showPinned = !!pinned
    && filter !== "groups"
    && (filter !== "unread" || !!pinned.unread)
    && matches(pinned.searchText ?? "");
  const filterChips: Array<[ChatFilter, string]> = asAdmin
    ? [["all", "All"], ["unread", "Unread"]]
    : [["all", "All"], ["unread", "Unread"], ["groups", "Groups"], ["people", "People"]];

  // Pinned chats sit on top as faces (the coach always first); the list
  // below is everything else. Searching or selecting shows plain rows.
  const pinnedRows = useMemo(
    () => pinnedKeys(prefs).map((k) => allRows.find((r) => r.key === k)).filter((r): r is Row => !!r),
    [prefs, allRows],
  );
  const showGrid = !filtering && !selectMode && (!!pinned || pinnedRows.length > 0);
  const listRows = showGrid ? shownRows.filter((r) => !r.pinned) : shownRows;

  const selected = groupRows.find((g) => g.id === selectedId);
  const pinnedSelected = !!pinned && selectedId === pinned.id;
  const anySelected = !!(selected || selectedDirect || selectedCrew || pinnedSelected || draftTo);
  const othersReady = groupsFetched
    && (directsQ.isFetched || directsQ.fetchStatus === "idle")
    && (crewsQ.isFetched || crewsQ.fetchStatus === "idle");
  const hasOtherChats = allRows.length > 0 || requestCount > 0;
  // Open the pinned chat by itself when it's the only one, and on wide
  // screens where list and chat sit side by side. Once: going back shows the
  // list (with compose and New group), it doesn't bounce into the chat again.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!pinned || autoOpened.current || selectedId || !othersReady) return;
    autoOpened.current = true;
    if (typeof window !== "undefined" && /group=/.test(window.location.hash)) return;
    const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
    if (!hasOtherChats || wide) setSelectedId(pinned.id);
  }, [pinned, selectedId, othersReady, hasOtherChats]);

  // Opening a chat you marked unread clears the mark.
  useEffect(() => {
    if (!selectedId || !canEdit || !isMarkedUnread(prefs, selectedId)) return;
    setPrefs.mutate([{ key: selectedId, patch: { unread_at: null } }]);
    // Only on opening: marking the open chat unread on a wide screen sticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onPinnedOpenChange = pinned?.onOpenChange;
  const pinnedOpen = pinnedSelected && !draftTo;
  useEffect(() => {
    onPinnedOpenChange?.(pinnedOpen);
  }, [pinnedOpen, onPinnedOpenChange]);
  useEffect(() => () => onPinnedOpenChange?.(false), [onPinnedOpenChange]);

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

  /* ------------------------------ chat actions ------------------------------ */

  const openChat = (key: string) => {
    setDraftTo(null);
    setSelectedId(key);
  };
  const closeChat = () => {
    setDraftTo(null);
    setSelectedId(null);
  };
  const toggleChecked = (key: string) =>
    setChecked((s) => { const n = { ...s }; if (n[key]) delete n[key]; else n[key] = true; return n; });

  const rowAvatar = (r: Row, size: number) => r.direct ? (
    <UserAvatar src={r.direct.other?.avatar_url ?? null} name={r.title} size={size} expandable={false} />
  ) : r.crew ? (
    <CrewFaces faces={r.crew.faces} size={size} />
  ) : (
    <GroupFaces groupId={r.key} size={size} />
  );
  const targetFor = (r: Row): ChatMenuTarget => ({
    key: r.key,
    title: r.title,
    avatar: rowAvatar(r, 44),
    preview: r.preview,
    pinned: r.pinned,
    muted: r.muted,
    unread: r.unread,
    canPin: true,
    canMute: true,
    // Coach-run groups for staff have a real (permanent) delete in Select.
    canDelete: !asAdmin,
  });
  const coachTarget: ChatMenuTarget | null = pinned ? {
    key: pinned.id,
    title: pinned.name,
    avatar: <UserAvatar src={pinned.avatarUrl} name={pinned.name} size={44} ring expandable={false} />,
    preview: pinned.preview,
    fixed: true,
    pinned: true,
    muted: false,
    unread: !!pinned.unread,
    canPin: false,
    canMute: false,
    canDelete: false,
  } : null;

  const save = (changes: Array<{ key: string; patch: ChatPrefPatch }>, done?: string) =>
    setPrefs.mutate(changes, {
      onSuccess: () => { if (done) toast.success(done); },
      onError: (e: any) => toast.error(e?.message ?? "That didn't save. Try again."),
    });

  /** Read it for real (the other side's "Seen" moves, as it would by opening it). */
  const markRowRead = async (key: string) => {
    const row = allRows.find((r) => r.key === key);
    if (!row || !me || !(row.group?.unread || (row.direct && isUnread(row.direct, me)) || (row.crew && isCrewUnread(row.crew, me)))) return;
    try {
      await markGroupRead(key, me);
    } finally {
      for (const k of ["group-memberships", "group-unread", "direct-threads", "crew-threads", "client-nav-badges"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    }
  };

  const runAction = async (a: ChatMenuAction, t: ChatMenuTarget) => {
    setMenu(null);
    const now = new Date().toISOString();
    if (t.fixed) {
      try {
        if (a === "unread") await pinned?.markUnread?.();
        if (a === "read") await pinned?.markRead?.();
      } catch (e: any) {
        toast.error(e?.message ?? "That didn't save. Try again.");
      }
      return;
    }
    switch (a) {
      case "pin":
        if (pinnedRows.length >= MAX_PINS) { toast.message(`You can pin up to ${MAX_PINS} chats. Unpin one first.`); return; }
        save([{ key: t.key, patch: { pinned_at: now, hidden_at: null } }]);
        return;
      case "unpin":
        save([{ key: t.key, patch: { pinned_at: null } }]);
        return;
      case "unread":
        save([{ key: t.key, patch: { unread_at: now } }]);
        if (t.key === selectedId) setSelectedId(null);
        return;
      case "read":
        if (isMarkedUnread(prefs, t.key)) save([{ key: t.key, patch: { unread_at: null } }]);
        await markRowRead(t.key);
        return;
      case "mute":
        save([{ key: t.key, patch: { muted: true } }], `No alerts from ${t.title}`);
        return;
      case "unmute":
        save([{ key: t.key, patch: { muted: false } }], "Alerts are back on");
        return;
      case "delete":
        setConfirmDelete([t]);
        return;
    }
  };

  const doDelete = () => {
    const targets = confirmDelete ?? [];
    setConfirmDelete(null);
    if (!targets.length) return;
    const now = new Date().toISOString();
    save(targets.map((t) => ({ key: t.key, patch: deletePatch(now) })), targets.length === 1 ? "Chat deleted" : `${targets.length} chats deleted`);
    if (selectedId && targets.some((t) => t.key === selectedId)) setSelectedId(null);
    setChecked({});
    setSelectMode(false);
  };

  const selectedRows = allRows.filter((r) => checked[r.key]);
  const readSelected = async () => {
    const rows = selectedRows.length ? selectedRows : allRows.filter((r) => r.unread);
    const marked = rows.filter((r) => isMarkedUnread(prefs, r.key));
    if (marked.length) save(marked.map((r) => ({ key: r.key, patch: { unread_at: null } })));
    await Promise.all(rows.map((r) => markRowRead(r.key)));
    setChecked({});
    setSelectMode(false);
  };

  const rowView = (r: Row) => {
    const leading = selectMode && !asAdmin ? <SelectDot on={!!checked[r.key]} /> : undefined;
    const onClick = () => (selectMode ? toggleChecked(r.key) : openChat(r.key));
    if (r.crew) return <CrewRow thread={r.crew} me={me} selected={selectedId === r.key && !selectMode} onClick={onClick} unread={r.unread} muted={r.muted} leading={leading} />;
    if (r.direct) return <DirectRow thread={r.direct} me={me} selected={selectedId === r.key && !selectMode} onClick={onClick} unread={r.unread} muted={r.muted} leading={leading} />;
    const { group, last } = r.group!;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        className={cn(
          "flex w-full cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-secondary/40",
          selectedId === group.id && !selectMode && "bg-secondary/60",
          selectMode && checked[group.id] && "bg-primary/10",
          group.archived && "opacity-60",
        )}
      >
        {selectMode && asAdmin && (
          <Checkbox
            className="mt-1"
            checked={!!checked[group.id]}
            onCheckedChange={(v) => setChecked((s) => { const n = { ...s }; if (v) n[group.id] = true; else delete n[group.id]; return n; })}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {leading && <span className="self-center">{leading}</span>}
        <GroupCover groupId={group.id} myRole={myPresenceRole} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-sm", r.unread ? "font-bold" : "font-semibold")}>
              {group.name}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              {r.muted && <BellOff className="h-3 w-3" aria-label="Alerts hidden" />}
              {group.archived && <Archive className="h-3 w-3" />}
              {last?.created_at && fmtTime(last.created_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={cn("flex-1 truncate text-xs", r.unread ? "text-foreground" : "text-muted-foreground")}>
              {last?.body || "No messages yet"}
            </span>
            {r.unread && (
              <Badge className="h-4 min-w-[16px] rounded-full px-1 text-[10px]">1</Badge>
            )}
          </div>
        </div>
      </div>
    );
  };

  const coachRow = pinned && (
    <button
      type="button"
      onClick={() => openChat(pinned.id)}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition hover:bg-secondary/40",
        pinnedSelected && "bg-secondary/60",
      )}
    >
      <LiveAvatar live={pinned.live} size={44}>
        <UserAvatar src={pinned.avatarUrl} name={pinned.name} size={44} ring expandable={false} />
      </LiveAvatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-[15px]", pinned.unread ? "font-bold" : "font-semibold")}>{pinned.name}</span>
          <span className={cn("shrink-0 text-[11px]", pinned.unread ? "font-semibold text-primary" : "text-muted-foreground")}>{pinned.when}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn("flex-1 truncate text-[13px]", pinned.unread ? "text-foreground" : "text-muted-foreground")}>{pinned.preview}</span>
          {pinned.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </span>
      </span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Sidebar list */}
      <aside className={cn(
        "flex w-full flex-col border-r border-border bg-card md:w-[300px] md:shrink-0",
        anySelected ? "hidden md:flex" : "flex",
      )}>
        {showRequests && !asAdmin ? (
          <RequestsList
            threads={requests}
            crews={crewInvites}
            me={me}
            selectedId={selectedId}
            onOpen={openChat}
            onBack={() => { setShowRequests(false); if (openedRequest) setSelectedId(null); }}
          />
        ) : (<>
        {asAdmin ? (
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-sm font-bold tracking-tight">Group chats</div>
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
          </header>
        ) : (
          <header className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center border-b border-border px-2 py-1.5">
            <div>
              {canEdit && (selectMode ? (
                <Button size="sm" variant="ghost" className="h-9 px-2 font-semibold text-primary" onClick={() => { setSelectMode(false); setChecked({}); }}>
                  Done
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-9 px-2 font-semibold text-primary">Edit</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem onClick={() => { setSelectMode(true); setChecked({}); }} disabled={allRows.length === 0}>
                      <CheckSquare className="mr-2 h-4 w-4" /> Select Chats
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBlockedOpen(true)}>
                      <ShieldOff className="mr-2 h-4 w-4" /> Blocked
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </div>
            <div className="text-center text-lg font-bold tracking-tight">{pinned ? "Messages" : "Chats"}</div>
            <div className="flex justify-end">
              {canEdit && !selectMode && (
                <Button size="icon" variant="ghost" className="h-9 w-9 text-primary" onClick={() => setComposeOpen(true)} aria-label="New message" title="New message">
                  <SquarePen className="h-5 w-5" />
                </Button>
              )}
            </div>
          </header>
        )}
        <div className="space-y-2 border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={asAdmin ? "Search groups" : "Search chats and people"}
              aria-label="Search chats"
              className="h-9 w-full rounded-full border border-border bg-secondary/40 pl-9 pr-9 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-muted-foreground/30 text-background">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter chats">
            {filterChips.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-7 shrink-0 rounded-full border px-3 text-xs font-semibold transition",
                  filter === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {selectMode && isAdmin && asAdmin && (
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
          {requestCount > 0 && !selectMode && !filtering && (
            <RequestsEntry
              count={requestCount}
              fresh={requests.some((t) => isUnread(t, me)) || crewInvites.some((t) => isCrewUnread(t, me))}
              onClick={() => setShowRequests(true)}
            />
          )}
          {showGrid && (
            <div className="flex flex-wrap justify-center border-b border-border/60 px-2 py-2" aria-label="Pinned chats">
              {pinned && (
                <PinTile
                  name={pinned.name}
                  avatar={<UserAvatar src={pinned.avatarUrl} name={pinned.name} size={60} ring expandable={false} />}
                  unread={!!pinned.unread}
                  live={pinned.live}
                  selected={pinnedSelected}
                  onOpen={() => openChat(pinned.id)}
                  onHold={canEdit && coachTarget ? () => setMenu(coachTarget) : undefined}
                />
              )}
              {pinnedRows.map((r) => (
                <PinTile
                  key={r.key}
                  name={r.title}
                  avatar={rowAvatar(r, 60)}
                  unread={r.unread}
                  muted={r.muted}
                  selected={selectedId === r.key}
                  onOpen={() => openChat(r.key)}
                  onHold={canEdit ? () => setMenu(targetFor(r)) : undefined}
                />
              ))}
            </div>
          )}
          {showPinned && !showGrid && !selectMode && coachRow}
          {listRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {filtering ? (showPinned ? "" : "No chats match.")
                : asAdmin ? "No groups yet. Create one to get started."
                  : pinned ? (pinnedRows.length ? "" : "Chats with other members show up here. Tap the pencil to message someone or start a group.")
                    : "No chats yet. Start a group, or tap the send icon on someone's post to message them."}
            </div>
          ) : listRows.map((r) => {
            const t = targetFor(r);
            return (
              <ChatRowShell
                key={r.key}
                onHold={canEdit && !selectMode ? () => setMenu(t) : undefined}
                swipe={canEdit && !selectMode && !asAdmin ? swipeActionsFor(t, (a) => void runAction(a, t)) : undefined}
              >
                {rowView(r)}
              </ChatRowShell>
            );
          })}
        </div>
        {selectMode && !asAdmin && (
          <div className="flex items-center justify-between border-t border-border bg-card px-4 py-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
            <Button type="button" variant="ghost" className="font-semibold text-primary" onClick={() => void readSelected()}>
              <MailOpen className="mr-1.5 h-4 w-4" /> {selectedRows.length ? "Read" : "Read All"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="font-semibold text-destructive"
              disabled={selectedRows.length === 0}
              onClick={() => setConfirmDelete(selectedRows.map(targetFor))}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete{selectedRows.length ? ` (${selectedRows.length})` : ""}
            </Button>
          </div>
        )}
        </>)}
      </aside>

      {/* Thread pane */}
      <section className={cn("flex min-w-0 flex-1 flex-col", anySelected ? "flex" : "hidden md:flex")}>
        {draftTo && !asAdmin ? (
          <NewRequestView
            key={draftTo.user_id}
            to={draftTo}
            onBack={closeChat}
            onSent={async (groupId) => {
              await qc.refetchQueries({ queryKey: directThreadsKey });
              openChat(groupId);
            }}
          />
        ) : pinnedSelected && pinned ? (
          pinned.renderThread({ onBack: closeChat })
        ) : selectedCrew && !asAdmin ? (
          <CrewChatView key={selectedCrew.group_id} thread={selectedCrew} onBack={closeChat} />
        ) : selectedDirect && !asAdmin ? (
          <DirectChatView key={selectedDirect.group_id} thread={selectedDirect} onBack={closeChat} />
        ) : selected ? (
          <>
            <header className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur md:px-4">
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={closeChat}>
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
                    <LiveMark className="font-semibold">{liveCount} active now</LiveMark>
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
      {!asAdmin && <CreateCrewSheet open={crewOpen} onOpenChange={setCrewOpen} onCreated={(id) => { setShowRequests(false); openChat(id); }} />}
      {!asAdmin && canEdit && (
        <NewMessageSheet
          open={composeOpen}
          onOpenChange={setComposeOpen}
          me={me}
          directs={directs}
          crews={crews}
          onOpenThread={(t) => { if (t.incoming) setShowRequests(true); openChat(t.group_id); }}
          onDraft={(to) => { setSelectedId(null); setDraftTo(to); }}
          onNewGroup={() => setCrewOpen(true)}
        />
      )}
      {!asAdmin && canEdit && <BlockedPeopleSheet open={blockedOpen} onOpenChange={setBlockedOpen} />}
      <ChatActionsSheet target={menu} onClose={() => setMenu(null)} onAction={(a, t) => void runAction(a, t)} />
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} chats?` : `Delete ${confirmDelete?.[0]?.title ?? "this chat"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It comes off your list. If someone writes again, it comes back. Nobody's told, and you stay in any group chats (open one and tap Leave to leave).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {selected && (asAdmin || isAdminOfGroup) && (
        <ManageGroupDialog open={manageOpen} onOpenChange={setManageOpen} group={selected} />
      )}
    </div>
  );
}

/** The round check iMessage shows while selecting chats. */
function SelectDot({ on }: { on: boolean }) {
  return (
    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
      {on && <Check className="h-3.5 w-3.5" />}
    </span>
  );
}

/** A coach-run group's face for pins and the hold menu: two members, or a group icon. */
function GroupFaces({ groupId, size }: { groupId: string; size: number }) {
  const { data: rawMembers = [] } = useQuery({
    queryKey: ["group-member-profiles", groupId],
    queryFn: () => listGroupMemberProfiles(groupId),
    staleTime: 60_000,
  });
  const members = Array.isArray(rawMembers) ? (rawMembers as GroupMemberProfile[]) : [];
  return (
    <CrewFaces
      faces={members.slice(0, 2).map((m) => ({ user_id: m.user_id, name: m.full_name ?? "Member", avatar_url: m.avatar_url ?? null }))}
      size={size}
    />
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