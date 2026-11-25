import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { Check, CheckSquare, ShieldOff, SquarePen, MailOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listMyGroups, listMyGroupMemberships, markGroupRead, type ChatGroup,
} from "@/lib/group-chats";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { LiveAvatar } from "@/components/live-indicator";
import { directThreadsKey, isUnread, previewLine, useDirectThreads, type DirectThread } from "@/lib/direct-chats";
import { DirectChatView, DirectRow, RequestsEntry, RequestsList } from "@/components/direct-chat";
import { crewPreview, crewThreadsKey, isCrewUnread, useCrewThreads, type CrewThread } from "@/lib/crew-chats";
import { CreateCrewSheet, CrewChatView, CrewFaces, CrewRow, crewOthers } from "@/components/crew-chat";
import { listenChannel } from "@/lib/realtime-channel";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";
import { InboxControls } from "@/components/messages/inbox-chips";
import { GroupChatRow, GroupCover, GroupThreadPane } from "@/components/messages/group-thread-pane";
import { groupPreview } from "@/lib/group-row";
import { inPrimary, type PrimaryFilter } from "@/lib/inbox-filters";
import type { CommunityAuthor } from "@/lib/community";
import {
  MAX_PINS, deletePatch, isHidden, isMarkedUnread, isMuted, isPinned, pinnedKeys, useChatPrefs, useSetChatPrefs,
  type ChatPrefPatch,
} from "@/lib/chat-prefs";
import { newestFirst } from "@/lib/recency";
import {
  BlockedPeopleSheet, ChatActionsSheet, ChatRowShell, NewMessageSheet, NewRequestView, swipeActionsFor,
  type ChatMenuAction, type ChatMenuTarget,
} from "@/components/messages/inbox-parts";

/**
 * A conversation that isn't a group (the client's chat with their coach,
 * everyone's JF Effect Support chat). Fixed chats are always the first rows,
 * pinned with the pin mark, in the order given (iMessage): one can be marked
 * unread, but never unpinned, muted or deleted.
 */
export type PinnedChat = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Their login, so the row's photo carries their story ring (and plays it). */
  storyUserId?: string | null;
  live?: boolean;
  /** The list row's second line. */
  preview: string;
  /** When the latest message was sent (ISO): the row shows its age ("· 5m"). */
  at: string | null;
  unread?: boolean;
  /** What search matches against (name + latest message). */
  searchText?: string;
  renderThread: (p: { onBack: () => void }) => ReactNode;
  markUnread?: () => void | Promise<void>;
  markRead?: () => void | Promise<void>;
  /** Told when its conversation opens or closes (presence: "live" only while open). */
  onOpenChange?: (open: boolean) => void;
  /** Open this chat when the inbox opens (a link or push asked for it). */
  openOnArrival?: boolean;
};

type VisibleGroup = { group: ChatGroup; last: any; unread: number };

/** One chat in the list, whatever kind it is. */
type Row = {
  key: string;
  at: string;
  title: string;
  preview: string;
  search: string;
  /** Groups: coach-run groups and members' crews. 1:1: DMs (and the coach chat, which isn't a Row). */
  kind: "group" | "direct";
  group?: VisibleGroup;
  direct?: DirectThread;
  crew?: CrewThread;
  unread: boolean;
  muted: boolean;
  pinned: boolean;
};

/**
 * A client's or member's Messages: one list, iMessage / Instagram DMs.
 * The coach chat (when there is one) is a normal row pinned first, then the
 * chats they pinned, then everything else newest first, under the same four
 * filters as the coach's inbox (All · Unread · Groups · 1:1 Chats).
 */
export function GroupChatsPane({ pinned: pinnedProp }: { pinned?: PinnedChat | PinnedChat[] }) {
  const pins: PinnedChat[] = useMemo(
    () => (Array.isArray(pinnedProp) ? pinnedProp : pinnedProp ? [pinnedProp] : []),
    [pinnedProp],
  );
  // The first fixed chat (the coach, for a coaching client): it opens by itself when it's the only chat.
  const pinned: PinnedChat | undefined = pins[0];
  const { user, role } = useAuth();
  // Coach "View as client": show the client's groups and read state.
  const { isImpersonating } = useClientImpersonation();
  const viewerId = usePortalUserId() ?? null;
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, true>>({});
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

  // Deep-link support: /portal/messages#group=<uuid> auto-selects the group
  // so tapping a push notification lands the user right in the conversation.
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
    queryKey: ["chat-groups", false],
    queryFn: () => listMyGroups(),
  });

  // Member-to-member chats (and requests). Private to the two people, so
  // never in "View as client".
  const directsQ = useDirectThreads(!isImpersonating);
  const rawDirects = directsQ.data;
  const directs = Array.isArray(rawDirects) ? rawDirects : [];
  const requests = directs.filter((t) => t.incoming);
  const directChats = directs.filter((t) => !t.incoming);
  const me = viewerId ?? user?.id ?? null;
  // Group chats members started (and invites to them): same privacy as DMs.
  const crewsQ = useCrewThreads(!isImpersonating);
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
    if (!isImpersonating) return rows;
    const mine = new Set(membershipRows.map((m) => m.group_id));
    return rows.filter((g) => mine.has(g.id));
  }, [groups, isImpersonating, membershipRows]);

  const lastReadByGroup = useMemo(
    () => new Map(membershipRows.map((m) => [m.group_id, m.last_read_at])),
    [membershipRows],
  );

  const { data: lastMsgByGroup = {} as Record<string, any> } = useGroupLastMessages(groupRows.map((g) => g.id));

  const resyncGroups = () => {
    for (const k of ["chat-groups", "group-memberships", "group-last-messages", "group-unread", "direct-threads", "crew-threads", "chat-thread-prefs"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  useResyncOnResume(resyncGroups);
  useGroupListRealtime("groups-pane");

  const visibleGroups = useMemo((): VisibleGroup[] => {
    return groupRows
      .map((g) => {
        const last = (lastMsgByGroup as Record<string, any>)?.[g.id];
        const unread = groupUnread(last, lastReadByGroup.get(g.id) ?? null, viewerId ?? user?.id) ? 1 : 0;
        return { group: g, last, unread };
      })
      .sort((a, b) => newestFirst(a.last?.created_at ?? a.group.updated_at, b.last?.created_at ?? b.group.updated_at));
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
        key: g.group.id, at: g.last?.created_at ?? g.group.updated_at ?? "", title: g.group.name, kind: "group",
        preview: groupPreview(g.last, me), search: `${g.group.name} ${g.last?.body ?? ""}`,
        group: g, natural: !!g.unread,
      });
    }
    for (const t of directChats) {
      add({
        key: t.group_id, at: t.last_at, title: t.other?.name ?? "Member", preview: previewLine(t, me), kind: "direct",
        search: `${t.other?.name ?? ""} ${t.last?.body ?? ""}`, direct: t, natural: isUnread(t, me),
      });
    }
    for (const t of crewChats) {
      add({
        key: t.group_id, at: t.last_at, title: t.name, preview: crewPreview(t, me), kind: "group",
        search: `${t.name} ${t.last?.body ?? ""}`, crew: t, natural: isCrewUnread(t, me),
      });
    }
    return rows.sort((a, b) => newestFirst(a.at, b.at));
  }, [visibleGroups, directChats, crewChats, prefs, canEdit, me]);

  // Search + the four filters, the same as the coach's inbox.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PrimaryFilter>("all");
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const filtering = !!q || filter !== "all";
  // Pinned chats lead (in the order they were pinned), then the rest newest first.
  const pinOrder = useMemo(() => pinnedKeys(prefs), [prefs]);
  const shownRows = useMemo(() => {
    const rows = allRows.filter((row) => inPrimary(row, filter) && matches(row.search));
    const pins = pinOrder.map((k) => rows.find((r) => r.key === k && r.pinned)).filter((r): r is Row => !!r);
    return [...pins, ...rows.filter((r) => !r.pinned)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filter, q, pinOrder]);
  // The fixed chats are 1:1s, always first.
  const shownPins = pins.filter((p) => inPrimary({ kind: "direct", unread: !!p.unread }, filter) && matches(p.searchText ?? ""));
  const showPinned = shownPins.length > 0;
  const unreadCount = allRows.filter((r) => r.unread).length + pins.filter((p) => p.unread).length;

  const selected = groupRows.find((g) => g.id === selectedId);
  const selectedPin = pins.find((p) => p.id === selectedId);
  const pinnedSelected = !!selectedPin;
  const anySelected = !!(selected || selectedDirect || selectedCrew || pinnedSelected || draftTo);
  const othersReady = groupsFetched
    && (directsQ.isFetched || directsQ.fetchStatus === "idle")
    && (crewsQ.isFetched || crewsQ.fetchStatus === "idle");
  const hasOtherChats = allRows.length > 0 || requestCount > 0;
  // Open the coach chat by itself when it's the only one, and on wide
  // screens where list and chat sit side by side. Once: going back shows the
  // list (with compose and New group), it doesn't bounce into the chat again.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!pinned || autoOpened.current || selectedId || !othersReady) return;
    autoOpened.current = true;
    const asked = pins.find((p) => p.openOnArrival);
    if (asked) { setSelectedId(asked.id); return; }
    if (typeof window !== "undefined" && /group=/.test(window.location.hash)) return;
    const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
    if ((!hasOtherChats && pins.length === 1) || wide) setSelectedId(pinned.id);
  }, [pinned, pins, selectedId, othersReady, hasOtherChats]);

  // Opening a chat you marked unread clears the mark.
  useEffect(() => {
    if (!selectedId || !canEdit || !isMarkedUnread(prefs, selectedId)) return;
    setPrefs.mutate([{ key: selectedId, patch: { unread_at: null } }]);
    // Only on opening: marking the open chat unread on a wide screen sticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onPinnedOpenChange = pinned?.onOpenChange;
  const pinnedOpen = !!pinned && selectedId === pinned.id && !draftTo;
  useEffect(() => {
    onPinnedOpenChange?.(pinnedOpen);
  }, [pinnedOpen, onPinnedOpenChange]);
  useEffect(() => () => onPinnedOpenChange?.(false), [onPinnedOpenChange]);

  const myMembership = selected ? membershipRows.find((m) => m.group_id === selected.id) : undefined;
  const isAdminOfGroup = myMembership?.role === "admin";

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
    <CrewFaces faces={r.crew.faces} total={crewOthers(r.crew)} size={size} />
  ) : (
    <GroupCover groupId={r.key} size={size} />
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
    canDelete: true,
  });
  const pinTarget = (p: PinnedChat): ChatMenuTarget => ({
    key: p.id,
    title: p.name,
    avatar: <UserAvatar src={p.avatarUrl} name={p.name} size={44} expandable={false} />,
    preview: p.preview,
    fixed: true,
    pinned: true,
    muted: false,
    unread: !!p.unread,
    canPin: false,
    canMute: false,
    canDelete: false,
  });

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
      const pin = pins.find((p) => p.id === t.key);
      try {
        if (a === "unread") await pin?.markUnread?.();
        if (a === "read") await pin?.markRead?.();
      } catch (e: any) {
        toast.error(e?.message ?? "That didn't save. Try again.");
      }
      return;
    }
    switch (a) {
      case "pin":
        if (pinOrder.length >= MAX_PINS) { toast.message(`You can pin up to ${MAX_PINS} chats. Unpin one first.`); return; }
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
    const leading = selectMode ? <SelectDot on={!!checked[r.key]} /> : undefined;
    const onClick = () => (selectMode ? toggleChecked(r.key) : openChat(r.key));
    const isOpen = selectedId === r.key && !selectMode;
    if (r.crew) return <CrewRow thread={r.crew} me={me} selected={isOpen} onClick={onClick} unread={r.unread} muted={r.muted} pinned={r.pinned} leading={leading} />;
    if (r.direct) return <DirectRow thread={r.direct} me={me} selected={isOpen} onClick={onClick} unread={r.unread} muted={r.muted} pinned={r.pinned} leading={leading} />;
    const { group, last } = r.group!;
    return (
      <GroupChatRow group={group} last={last} unread={r.unread} muted={r.muted} pinned={r.pinned} selected={isOpen} leading={leading} onClick={onClick} />
    );
  };

  // The fixed chats (the coach, JF Effect Support): the same row as every chat, first, with the pin mark.
  const pinRows = shownPins.map((p) => {
    const t = pinTarget(p);
    return (
      <ChatRowShell
        key={`pin:${p.id}`}
        onHold={canEdit ? () => setMenu(t) : undefined}
        swipe={canEdit ? swipeActionsFor(t, (a) => void runAction(a, t)) : undefined}
      >
        <ChatListRow
          data-coach-chat={p === pinned ? true : undefined}
          data-fixed-chat={p.id}
          onClick={() => openChat(p.id)}
          selected={selectedId === p.id}
          unread={p.unread}
          pinned
          at={p.at}
          avatar={
            <LiveAvatar live={p.live} size={CHAT_ROW_AVATAR}>
              <UserAvatar src={p.avatarUrl} name={p.name} size={CHAT_ROW_AVATAR} expandable={false} />
            </LiveAvatar>
          }
          storyUserId={p.storyUserId}
          storyName={p.name}
          name={p.name}
          preview={p.preview}
        />
      </ChatRowShell>
    );
  });

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Sidebar list */}
      <aside className={cn(
        "flex w-full flex-col border-r border-border bg-card md:w-[380px] md:shrink-0",
        anySelected ? "hidden md:flex" : "flex",
      )}>
        {showRequests ? (
          <RequestsList
            threads={requests}
            crews={crewInvites}
            me={me}
            selectedId={selectedId}
            onOpen={openChat}
            onBack={() => { setShowRequests(false); if (openedRequest) setSelectedId(null); }}
          />
        ) : (<>
        <header className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center px-2 py-1.5">
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
          <div className="text-center text-xl font-semibold tracking-tight">Messages</div>
          <div className="flex justify-end">
            {canEdit && !selectMode && (
              <Button size="icon" variant="ghost" className="h-9 w-9 text-primary" onClick={() => setComposeOpen(true)} aria-label="New message" title="New message">
                <SquarePen className="h-5 w-5" />
              </Button>
            )}
          </div>
        </header>
        <InboxControls
          query={query}
          onQuery={setQuery}
          placeholder="Search chats and people"
          filter={filter}
          onFilter={setFilter}
          unread={unreadCount}
        />
        <div className="flex-1 overflow-y-auto">
          {requestCount > 0 && !selectMode && !filtering && (
            <RequestsEntry
              count={requestCount}
              fresh={requests.some((t) => isUnread(t, me)) || crewInvites.some((t) => isCrewUnread(t, me))}
              onClick={() => setShowRequests(true)}
            />
          )}
          {showPinned && !selectMode && pinRows}
          {shownRows.length === 0 ? (
            showPinned && !selectMode ? null : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {filtering ? "No chats match."
                  : pinned ? "Chats with other members show up here. Tap the pencil to message someone or start a group."
                    : "No chats yet. Start a group, or tap the send icon on someone's post to message them."}
              </div>
            )
          ) : shownRows.map((r) => {
            const t = targetFor(r);
            return (
              <ChatRowShell
                key={r.key}
                onHold={canEdit && !selectMode ? () => setMenu(t) : undefined}
                swipe={canEdit && !selectMode ? swipeActionsFor(t, (a) => void runAction(a, t)) : undefined}
              >
                {rowView(r)}
              </ChatRowShell>
            );
          })}
        </div>
        {selectMode && (
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
        {draftTo ? (
          <NewRequestView
            key={draftTo.user_id}
            to={draftTo}
            onBack={closeChat}
            onSent={async (groupId) => {
              await qc.refetchQueries({ queryKey: directThreadsKey });
              openChat(groupId);
            }}
          />
        ) : selectedPin ? (
          selectedPin.renderThread({ onBack: closeChat })
        ) : selectedCrew ? (
          <CrewChatView key={selectedCrew.group_id} thread={selectedCrew} onBack={closeChat} />
        ) : selectedDirect ? (
          <DirectChatView key={selectedDirect.group_id} thread={selectedDirect} onBack={closeChat} />
        ) : selected ? (
          <GroupThreadPane key={selected.id} group={selected} canManage={isAdminOfGroup} onBack={closeChat} />
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Select a chat to start.</div>
        )}
      </section>

      <CreateCrewSheet open={crewOpen} onOpenChange={setCrewOpen} onCreated={(id) => { setShowRequests(false); openChat(id); }} />
      {canEdit && (
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
      {canEdit && <BlockedPeopleSheet open={blockedOpen} onOpenChange={setBlockedOpen} />}
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
    </div>
  );
}

/** A coach-run group with a message from someone else after this person last read it. */
export function groupUnread(last: { created_at?: string; sender_id?: string } | null | undefined, lastReadAt: string | null, me: string | null | undefined): boolean {
  if (!last?.created_at) return false;
  const lastRead = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  return new Date(last.created_at).getTime() > lastRead && last.sender_id !== me;
}

/** The latest message in each group (the list's preview, time and unread), one read for the coach's inbox and the client's. */
export function useGroupLastMessages(ids: string[]) {
  return useQuery({
    queryKey: ["group-last-messages", ids.join(",")],
    enabled: ids.length > 0,
    refetchOnMount: "always", // realtime only runs while a list is open
    refetchInterval: 30_000,
    queryFn: async () => {
      try {
        const { data, error } = await (supabase.from("group_messages") as any)
          .select("group_id, created_at, body, sender_id, sender_role, attachments, deleted_at")
          .in("group_id", ids)
          // an unsent message isn't the latest (the badge reads the same)
          .is("deleted_at", null)
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
  });
}

/** Realtime for a list of chats: a new group message shows its preview and time at once, no refetch. */
export function useGroupListRealtime(channel: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = listenChannel(channel)
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
        qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_direct_closed" }, () => {
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, (payload: any) => {
        const row = payload?.new;
        if (payload?.eventType === "INSERT" && row?.group_id && row?.created_at && !row.deleted_at) {
          // The event carries the row: show the new preview/time now, no refetch.
          qc.setQueriesData<Record<string, any>>({ queryKey: ["group-last-messages"] }, (prev) => {
            if (!prev) return prev;
            const cur = prev[row.group_id];
            if (cur && new Date(cur.created_at).getTime() >= new Date(row.created_at).getTime()) return prev;
            return {
              ...prev,
              [row.group_id]: {
                group_id: row.group_id, created_at: row.created_at, body: row.body, sender_id: row.sender_id,
                sender_role: row.sender_role, attachments: row.attachments, deleted_at: row.deleted_at,
              },
            };
          });
        } else {
          qc.invalidateQueries({ queryKey: ["group-last-messages"] });
        }
        qc.invalidateQueries({ queryKey: ["group-unread"] });
        qc.invalidateQueries({ queryKey: directThreadsKey });
        qc.invalidateQueries({ queryKey: crewThreadsKey });
        qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
      })
      .subscribe(onRealtimeRejoin(() => {
        for (const k of ["chat-groups", "group-memberships", "group-last-messages", "group-unread", "direct-threads", "crew-threads"]) {
          qc.invalidateQueries({ queryKey: [k] });
        }
      }));
    return () => { supabase.removeChannel(ch); };
  }, [qc, channel]);
}

/** The round check iMessage shows while selecting chats. */
function SelectDot({ on }: { on: boolean }) {
  return (
    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
      {on && <Check className="h-3.5 w-3.5" />}
    </span>
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