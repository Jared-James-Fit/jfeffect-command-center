import { Link, redirect, useNavigate } from "@tanstack/react-router";
import { ErrorState, ListSkeleton, OfflineState } from "@/components/loading";
import { queryView } from "@/lib/loading/load-state";
import { LeadsInboxRow } from "@/components/leads/leads-inbox-row";
import { RecoveryInboxRow } from "@/components/recovery/recovery-queue";
import { CompetitionsInboxRow } from "@/components/competition/competitions-card";
import { MemberApplicationsInboxRow } from "@/components/applications/member-applications-entry";
import { OpenIpfInboxRow } from "@/components/openipf/openipf-review";
import { useProgramGaps } from "@/components/program-gaps/use-program-gaps";
import { CLIENT_VIEW_HOME } from "@/lib/launch-home";
import { useEffect, useMemo, useState } from "react";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MessageThread, PriorityChip, threadMessagesQuery } from "@/components/message-thread";
import { ClientWorkoutPeek } from "@/components/messages/client-workout-peek";
import { MeetingStrip } from "@/components/coaching-sessions/meeting-strip";
import {
  type ConversationState, type Message,
  setConversationStatus, setConversationPriority, PRIORITIES,
  markUnread, markRead, setConversationWorkflow, type WorkflowStatus,
} from "@/lib/messages";
import { AlertTriangle, CalendarClock, Clock, Hourglass, Image as ImageIcon, ClipboardCheck, Search, ChevronLeft, MoreHorizontal, Phone, MessageSquare, MailOpen, Mail, Trash2, Archive, Eye, NotebookPen } from "lucide-react";
import { ClientNotesSheet } from "@/components/messages/client-notes-log";
import { SwipeableRow } from "@/components/ui/swipeable-row";
import { toast } from "sonner";
import { SendSmsDialog } from "@/components/send-sms-dialog";
import { cn } from "@/lib/utils";
import { useChatPresence } from "@/hooks/use-chat-presence";
import { LiveAvatar, LiveMark } from "@/components/live-indicator";
import { useGroupLastMessages, useGroupListRealtime, groupUnread } from "@/components/group-chats-pane";
import { GroupChatRow, GroupThreadPane } from "@/components/messages/group-thread-pane";
import { DirectChatView, DirectRow } from "@/components/direct-chat";
import { NewRequestView } from "@/components/messages/inbox-parts";
import { TallSheet } from "@/components/crew-chat";
import { SquarePen } from "lucide-react";
import { directThreadsKey, isUnread as directUnread, useDirectThreads, type DirectThread } from "@/lib/direct-chats";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { InboxControls } from "@/components/messages/inbox-chips";
import { inPrimary, type PrimaryFilter } from "@/lib/inbox-filters";
import { listAllGroupsForAdmin, listMyGroupMemberships } from "@/lib/group-chats";
import { useAdminNavBadgeCounts } from "@/hooks/use-admin-nav-badges";
import { MassMessageDialog } from "@/components/mass-message-dialog";
import { HelpCircle, Megaphone, SlidersHorizontal, Users as UsersIcon, X, Zap } from "lucide-react";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { deriveInboxWorkflow, previewPrefix, WORKFLOW_LABEL, type InboxWorkflowState } from "@/lib/inbox-workflow";
import { formatReadReceipt } from "@/lib/read-receipt";
import { applyMessageChange, INBOX_MESSAGE_COLUMNS } from "@/lib/inbox-cache";
import { waitingState, type WaitingState } from "@/lib/inbox-waiting";
import { deriveRequests, latestToReview, oldestPending, requestChip } from "@/lib/inbox-requests";
import { TO_REVIEW_DAYS } from "@/lib/review-queue";
import { Check, ChevronRight, MessageCircle, Mic } from "lucide-react";
import { CleoAvatar, CLEO_ROLE_LINE } from "@/components/summer/cleo-avatar";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { useAuth } from "@/lib/auth";
import { openSummer } from "@/components/summer/summer-assistant";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { listenChannel } from "@/lib/realtime-channel";
import { latestOf, newestFirst } from "@/lib/recency";
import {
  FORM_FILTER_KIND, formKindTags, formKindWaiting, formTitles, matchesSignal, mediaWaitingByClient, painWaitingByClient, reviewItemsByClient, signalTags, splitRequests, waitingCount,
  type ClientSignals, type SignalFilter, type SignalTag,
} from "@/lib/inbox-brief";
import { ClientBriefSheet } from "@/components/messages/client-brief-sheet";
import { CHAT_ROW_AVATAR, ChatListRow, UNREAD_DOT } from "@/components/messages/chat-list-row";
import { InboxGuideSheet, type GuideFilter } from "@/components/messages/inbox-guide";
import { messagePreviewText } from "@/lib/message-preview";
import { MemberSupportPane, SUPPORT_REFRESH_KEYS } from "@/components/support/member-support-pane";
import { useServerFn } from "@tanstack/react-start";
import { updateMemberSupport } from "@/lib/member-support.functions";
import {
  mergeByRecency, sortSupportChats, supportChat, supportInFilter, supportMatches, supportNewChats,
  type SupportChat, type SupportThreadRow,
} from "@/lib/member-support";
import {
  SUPPORT_QUEUE_DEFAULT, SUPPORT_QUEUE_FILTERS, SUPPORT_QUEUE_HELP, inSupportQueue, supportQueueCounts, supportStateLine,
  type SupportQueueFilter,
} from "@/lib/support-cleo/queue";

type StaffInboxRow = {
  client_id: string;
  workflow_status: WorkflowStatus;
  workflow_reason: string | null;
  workflow_status_updated_at: string | null;
  workflow_updated_by_name: string | null;
  last_inbound_at: string | null;
  last_inbound_kind: string | null;
  unread: boolean;
  unread_count: number;
  archived: boolean;
};

const WORKFLOW_STYLE: Record<Exclude<InboxWorkflowState, "archived">, string> = {
  needs_response: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  waiting_on_client: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const WORKFLOW_SHORT: Record<Exclude<InboxWorkflowState, "archived">, string> = {
  needs_response: "Needs reply",
  waiting_on_client: "Waiting",
  done: "Done",
};

export function WorkflowPill({ state, className, compact }: { state: InboxWorkflowState; className?: string; compact?: boolean }) {
  if (state === "archived") return null;
  return (
    <span
      className={cn("inline-flex h-5 min-w-0 shrink items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-bold uppercase tracking-wide", WORKFLOW_STYLE[state], className)}
      title={WORKFLOW_LABEL[state]}
    >
      {compact ? (
        <>
          <span className="truncate sm:hidden">{WORKFLOW_SHORT[state]}</span>
          <span className="hidden truncate sm:inline">{WORKFLOW_LABEL[state]}</span>
        </>
      ) : (
        <span className="truncate">{WORKFLOW_LABEL[state]}</span>
      )}
    </span>
  );
}

const TAG_TEXT: Record<SignalTag["tone"], string> = {
  urgent: "text-red-600 dark:text-red-400",
  strong: "text-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  info: "text-sky-700 dark:text-sky-400",
  muted: "text-muted-foreground",
};
const TAG_ICON: Partial<Record<SignalTag["key"], typeof Check>> = {
  reply: MessageCircle,
  pain: AlertTriangle,
  overdue: Clock,
  review: ClipboardCheck,
  media: ImageIcon,
  session: CalendarClock,
  followup: Hourglass,
};

/**
 * A row's one quiet line: the most pressing thing in its colour, then up to
 * two more in grey ("Pain flagged · Needs reply · Form overdue · +1"). No
 * pills: the filters sort, the Brief explains.
 */
function SignalLine({ tags }: { tags: SignalTag[] }) {
  const [first, ...rest] = tags;
  const Icon = TAG_ICON[first.key];
  const more = rest.slice(0, 2);
  return (
    <span className="min-w-0 truncate">
      <span data-tag={first.key} className={cn("font-semibold", TAG_TEXT[first.tone])}>
        {Icon && <Icon className="mr-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden />}
        {first.label}
      </span>
      {more.map((t) => <span key={t.key} data-tag={t.key} className="text-muted-foreground"> · {t.label}</span>)}
      {rest.length > 2 && <span className="text-muted-foreground"> · +{rest.length - 2}</span>}
    </span>
  );
}

// Only what the inbox can't already show at a glance: forms first (the coach
// works his forms queue first: the weekly check-ins and Nutrition Updates
// each on their own, then every form), then pain, media and session requests.
// Needs reply, unread, follow up and priority already show on every row (bold
// name, blue dot, the line under it), so they aren't filters; the Messages
// tab's badge and the Inbox chip count new messages only (messagesBadge). Inbox is "everything"; Archived is the way back to archived
// chats. Every chip but Inbox shows only while something's in it.
// Support: JF Effect Support as its own queue (Needs Me first), in the Filter menu while anyone has written to Support.
const FILTERS = ["Inbox", "Reply", "Important", "Support", "Weekly", "Nutrition", "To Review", "Overdue", "Pain", "Media", "Sessions", "Program", "Archived"] as const;
type Filter = typeof FILTERS[number];
const FILTER_LABEL: Partial<Record<Filter, string>> = {
  Reply: "Needs reply",
  Important: "Important",
  Support: "JF Effect Support",
  Weekly: "Weekly check-ins",
  Nutrition: "Nutrition updates",
  "To Review": "Forms to review",
  Overdue: "Overdue forms",
  Pain: "Pain flagged",
  Media: "Photos & videos",
  Sessions: "Session requests",
  Program: "Program data",
};
const ONLY_WHEN_ANY = new Set<Filter>(FILTERS.filter((f) => f !== "Inbox"));

/**
 * Work for me carries a count badge in the colour of its line on a row;
 * Archived doesn't, so a number only ever means "this is waiting on you".
 */
const FILTER_BADGE: Partial<Record<Filter, "urgent" | "warn" | "info">> = {
  Reply: "info", Important: "warn", Support: "info", Weekly: "info", Nutrition: "info", "To Review": "info", Overdue: "warn", Pain: "urgent", Media: "info", Sessions: "info", Program: "warn",
};
const BADGE_STYLE = {
  urgent: "bg-red-500 text-white",
  warn: "bg-amber-500/25 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
} as const;
const COUNTED = FILTERS.filter((f) => FILTER_BADGE[f] || ONLY_WHEN_ANY.has(f));
/** The guide's filters as their chips show them: the name and the count's own colours. */
const GUIDE_FILTERS: GuideFilter[] = FILTERS.filter((f) => f !== "Inbox").map((f) => ({
  key: f as GuideFilter["key"],
  label: FILTER_LABEL[f] ?? f,
  badge: FILTER_BADGE[f] ? BADGE_STYLE[FILTER_BADGE[f]!] : undefined,
}));
const badgeNumber = (n: number) => (n > 99 ? "99+" : String(n));

type FilterRow = {
  state?: { status?: string | null; priority?: string | null } | null;
  workflow: { state: string };
  signals: ClientSignals;
  last?: unknown;
  liftReview?: unknown;
};

/** Which chats a filter shows. The list and its count badge both use it, so they always agree. */
function inFilter(it: FilterRow, filter: Filter): boolean {
  const status = it.state?.status ?? "open";
  switch (filter) {
    case "Weekly": case "Nutrition": case "To Review": case "Overdue": case "Media": case "Pain": case "Sessions": case "Program":
      return status !== "archived" && matchesSignal(it.signals, filter as SignalFilter);
    case "Reply": return status !== "archived" && it.workflow.state === "needs_response";
    case "Important": return status !== "archived" && !!it.state?.priority && it.state.priority !== "Normal";
    case "Archived": return status === "archived";
    // Support's rows are Support chats only (supportQueue)
    case "Support": return false;
    default: return status !== "archived" && (it.workflow.state !== "done" || !!it.last || !!it.liftReview);
  }
}

export function MessagesInbox({
  initialClient,
  initialMessage,
  initialSupport,
  initialDirect,
  embedded = false,
  view,
}: {
  initialClient?: string;
  /** A message in initialClient's chat to open on, scrolled to and highlighted (a check-in from the dashboard). */
  initialMessage?: string;
  initialSupport?: string;
  initialDirect?: string;
  embedded?: boolean;
  view?: "chats" | "groups";
} = {}) {
  const selectedFromUrl = initialClient;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clientPov = useClientImpersonation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("Inbox");
  // Support's own chips: Needs Me first.
  const [supportQueue, setSupportQueue] = useState<SupportQueueFilter>(SUPPORT_QUEUE_DEFAULT);
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl ?? null);
  // A JF member's Support chat, open in the pane (its thread id).
  const [supportId, setSupportId] = useState<string | null>(initialSupport ?? null);
  const [directId, setDirectId] = useState<string | null>(initialDirect ?? null);
  const [smsOpen, setSmsOpen] = useState(false);
  // the selected client's workout notes log (pain, review and exercise notes)
  const [notesOpen, setNotesOpen] = useState(false);
  // All · Unread · Groups · 1:1 Chats (the client's Messages has the same four);
  // `filter` is the Filter menu's narrower view on top of it.
  const [primary, setPrimary] = useState<PrimaryFilter>(view === "groups" ? "groups" : "all");
  useEffect(() => { if (view === "groups") setPrimary("groups"); }, [view]);
  // A coach-run group open in the pane.
  const [groupId, setGroupId] = useState<string | null>(null);
  const [massOpen, setMassOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSearch, setComposeSearch] = useState("");
  const { role, user } = useAuth();
  const { data: badgeCounts } = useAdminNavBadgeCounts();
  const appAlerts = badgeCounts?.supportAlerts ?? 0;
  const cleoOn = useCleoAccess();

  useEffect(() => { if (selectedFromUrl) { setSelectedId(selectedFromUrl); setSupportId(null); setDirectId(null); setGroupId(null); } }, [selectedFromUrl]);
  useEffect(() => { if (initialSupport) { setSupportId(initialSupport); setSelectedId(null); setDirectId(null); setGroupId(null); } }, [initialSupport]);
  useEffect(() => { if (initialDirect) { setDirectId(initialDirect); setSelectedId(null); setSupportId(null); setGroupId(null); } }, [initialDirect]);

  const clientsQ = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, user_id, full_name, first_name, last_name, email, phone, call_access_enabled, sms_opt_out, profile_picture_url, archived, status, last_active_at, service_tier")
        .order("full_name");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data]);
  const canCompose = role === "admin" && !clientPov.isImpersonating;
  const composePeople = useMemo(() => {
    const term = composeSearch.trim().toLowerCase();
    return clients.filter((c) => c.user_id && c.user_id !== user?.id && !c.archived && !["archived", "inactive", "deactivated"].includes((c.status ?? "").toLowerCase()) && (!term || `${c.full_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(term)));
  }, [clients, composeSearch, user?.id]);
  // Staff see only direct chats they personally participate in, not other members’ private conversations.
  const personalQ = useDirectThreads((role === "admin" || role === "coach") && !clientPov.isImpersonating);
  const personalThreads = useMemo(() => (personalQ.data ?? []).map((t) => {
    const c = clients.find((row) => row.user_id === t.other?.user_id);
    return c?.full_name ? { ...t, other: { ...t.other, name: c.full_name } } : t;
  }), [personalQ.data, clients]);
  const personalUnread = personalThreads.filter((t) => directUnread(t, user?.id)).length;
  // The list's own read: a cold open waits in the shape of rows, a failed or offline one says so
  // (never "No conversations." over chats that didn't load).
  const clientsState = queryView(clientsQ as any).kind;

  const { data: states = [] } = useQuery({
    queryKey: ["conversation-states"],
    staleTime: 30_000,
    // The inbox's realtime channel only runs while it's mounted, so anything
    // that arrived while you were elsewhere is unknown to the cache. Show the
    // cached list instantly, but always re-check on open.
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase.from("conversation_state") as any).select("*");
      if (error) throw error;
      return (data ?? []) as ConversationState[];
    },
  });

  // Per-staff unread + server workflow status (one row per conversation I can see).
  const { data: inboxState = [] } = useQuery({
    queryKey: ["staff-inbox-state"],
    staleTime: 15_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("staff_inbox_state");
      if (error) throw error;
      return (data ?? []) as StaffInboxRow[];
    },
  });
  const inboxByClient = useMemo(() => new Map(inboxState.map((r) => [r.client_id, r])), [inboxState]);

  // JF members' Support chats (they have no coach chat): rows in this list, opening here.
  const { data: supportRows = [] } = useQuery({
    queryKey: ["staff-support-threads"],
    enabled: role === "admin" || role === "coach",
    staleTime: 15_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("staff_support_threads");
      if (error) throw error;
      return (data ?? []) as SupportThreadRow[];
    },
  });
  const supportChats = useMemo(() => sortSupportChats(supportRows.map(supportChat)), [supportRows]);
  const updateSupport = useServerFn(updateMemberSupport);

  // Coach-run group chats: rows in the same list (All, Unread, Groups), read like 1:1 rows.
  const { data: rawGroups = [] } = useQuery({
    queryKey: ["chat-groups", true],
    enabled: role === "admin" || role === "coach",
    queryFn: listAllGroupsForAdmin,
  });
  const staffGroups = Array.isArray(rawGroups) ? rawGroups : [];
  const { data: myMemberships = [] } = useQuery({
    queryKey: ["group-memberships", user?.id ?? null],
    enabled: !!user?.id,
    queryFn: () => listMyGroupMemberships(user!.id),
  });
  const { data: groupLast = {} as Record<string, any> } = useGroupLastMessages(staffGroups.map((g) => g.id));
  useGroupListRealtime("admin-groups");
  const groupItems = useMemo(() => {
    const readAt = new Map((Array.isArray(myMemberships) ? myMemberships : []).map((m) => [m.group_id, m.last_read_at]));
    return staffGroups.map((group) => {
      const last = (groupLast as Record<string, any>)[group.id] ?? null;
      return {
        group,
        last,
        at: (last?.created_at ?? group.updated_at ?? "") as string,
        unread: !group.archived && readAt.has(group.id) && groupUnread(last, readAt.get(group.id) ?? null, user?.id),
      };
    });
  }, [staffGroups, groupLast, myMemberships, user?.id]);

  const { data: lastMessages = [] } = useQuery({
    queryKey: ["last-messages"],
    enabled: states.length > 0,
    staleTime: 30_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const clientIds = Array.from(new Set(states.map((s) => s.client_id))).filter(Boolean);
      if (clientIds.length === 0) return [] as Message[];
      // Single bulk fetch instead of N+1 per-client queries. Keep the recent
      // rows (not only one row per client) so unread counts and manual
      // mark-unread stay correct even when the latest message was sent by us.
      const { data, error } = await (supabase.from("messages") as any)
        .select(INBOX_MESSAGE_COLUMNS)
        .in("client_id", clientIds)
        .eq("is_internal_note", false)
        .in("delivery_status", ["sent", "sending"])
        .order("created_at", { ascending: false })
        .limit(Math.max(1000, clientIds.length * 20));
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  const { data: liftReviewItems = [] } = useQuery({
    queryKey: ["message-lift-review-inbox"],
    enabled: clients.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lift_videos") as any)
        .select("id, client_id, created_at, updated_at, status, is_urgent")
        .in("status", ["New Upload", "Awaiting Review", "Watched", "Needs Follow-Up"])
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        client_id: string;
        created_at: string;
        updated_at: string | null;
        status: string;
        is_urgent: boolean | null;
      }>;
    },
  });

  const { data: pendingSubmissions = [] } = useQuery({
    queryKey: ["message-form-checkin-inbox"],
    staleTime: 15_000,
    queryFn: async () => {
      // The to-review window, reviewed or not: review-queue.ts needs the newer
      // reviewed ones to know an older one was replaced.
      const since = new Date(Date.now() - TO_REVIEW_DAYS * 86_400_000).toISOString();
      const [native, checkins] = await Promise.all([
        (supabase.from("nf_submissions") as any).select("id, client_id, form_id, submitted_at, reviewed_at, status").not("submitted_at", "is", null).gte("submitted_at", since).limit(2000),
        (supabase.from("messenger_checkins") as any).select("id, client_id, task_type, submitted_at, status, reviewed_at, superseded_at").eq("status", "completed").not("submitted_at", "is", null).gte("submitted_at", since).limit(2000),
      ]);
      if (native.error) throw native.error;
      if (checkins.error) throw checkins.error;
      return [
        ...(native.data ?? []).map((row: any) => ({ ...row, kind: "form" as const })),
        ...(checkins.data ?? []).map((row: any) => ({ ...row, kind: "checkin" as const })),
      ];
    },
  });

  // Refetch everything the list is built from: realtime can't replay what
  // happened while the app was backgrounded or the socket was down.
  const INBOX_KEYS = ["last-messages", "conversation-states", "staff-inbox-state", "admin-nav-badges", "message-lift-review-inbox", "message-form-checkin-inbox", "staff-support-threads"];
  const resyncInbox = () => { for (const k of INBOX_KEYS) qc.invalidateQueries({ queryKey: [k] }); };
  useResyncOnResume(resyncInbox);

  // "2 minutes" / "about 1 hour" labels only change when something re-renders.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Forms & check-ins I sent vs. filled in (last 60 days). Small: one row per request.
  const { data: requestStatus } = useQuery({
    queryKey: ["message-form-checkin-inbox", "status"],
    staleTime: 15_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const [checkins, subs] = await Promise.all([
        (supabase.from("messenger_checkins") as any).select("client_id, task_type, status, created_at").gte("created_at", since).limit(3000),
        (supabase.from("nf_submissions") as any).select("client_id, form_id, submitted_at").not("submitted_at", "is", null).gte("submitted_at", since).limit(3000),
      ]);
      if (checkins.error) throw checkins.error;
      if (subs.error) throw subs.error;
      return { checkins: checkins.data ?? [], submissions: subs.data ?? [] } as {
        checkins: Array<{ client_id: string; task_type: string; status: string; created_at: string }>;
        submissions: Array<{ client_id: string; form_id: string; submitted_at: string | null }>;
      };
    },
  });

  // Reactions on the client's recent photos / videos / files: one with a staff
  // reaction (or a reply after it) isn't waiting any more.
  const mediaIds = useMemo(() => {
    const cutoff = Date.now() - 14 * 86_400_000;
    return lastMessages
      .filter((m) => m.sender_role === "client" && Date.parse(m.created_at) >= cutoff
        && (m.attachments ?? []).some((a: any) => a && !a.kind && ["image", "video", "pdf", "file"].includes(a.type)))
      .map((m) => m.id)
      .sort();
  }, [lastMessages]);
  const { data: mediaReactions = [] } = useQuery({
    queryKey: ["inbox-media-reactions", mediaIds.join(",")],
    enabled: mediaIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const out: { message_id: string; user_id: string }[] = [];
      for (let i = 0; i < mediaIds.length; i += 200) {
        const { data, error } = await (supabase.from("message_reactions") as any)
          .select("message_id, user_id")
          .in("message_id", mediaIds.slice(i, i + 200));
        if (error) throw error;
        out.push(...(data ?? []));
      }
      return out;
    },
  });
  const { data: sessionRequestRows = [] } = useQuery({
    queryKey: ["inbox-session-requests"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("session_requests") as any).select("client_id").eq("status", "pending").limit(500);
      if (error) throw error;
      return (data ?? []) as { client_id: string }[];
    },
  });

  // Realtime. If the channel errors or closes (iPhone network switches,
  // expired auth), rebuild it instead of silently going deaf.
  const [channelGen, setChannelGen] = useState(0);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const pendingKeys = new Set<string>();
    const scheduleInvalidate = (keys: string[]) => {
      for (const key of keys) pendingKeys.add(key);
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        const keysToFlush = Array.from(pendingKeys);
        pendingKeys.clear();
        for (const k of keysToFlush) qc.invalidateQueries({ queryKey: [k] });
      }, 75);
    };
    let closing = false;
    let rebuild: ReturnType<typeof setTimeout> | null = null;
    const rejoin = onRealtimeRejoin(() => scheduleInvalidate(INBOX_KEYS));
    const ch = listenChannel("admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload: any) => {
        // The event already carries the whole row: patch the list now (preview,
        // time, order and unread dot update immediately) instead of re-downloading
        // ~1,000 messages. Only the small counters are refetched afterwards.
        qc.setQueryData<Message[] | undefined>(["last-messages"], (prev) =>
          applyMessageChange(prev, { eventType: payload.eventType, new: payload.new, old: payload.old }));
        scheduleInvalidate(["conversation-states", "staff-inbox-state", "admin-nav-badges"]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, () => {
        scheduleInvalidate(["conversation-states", "staff-inbox-state", "admin-nav-badges"]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => scheduleInvalidate(["inbox-media-reactions"]))
      .on("postgres_changes", { event: "*", schema: "public", table: "session_requests" }, () => scheduleInvalidate(["inbox-session-requests"]))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_staff_reads" }, () => {
        scheduleInvalidate(["staff-inbox-state", "admin-nav-badges"]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, () => {
        scheduleInvalidate(["message-lift-review-inbox"]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "nf_submissions" }, () => scheduleInvalidate(["message-form-checkin-inbox"]))
      .on("postgres_changes", { event: "*", schema: "public", table: "messenger_checkins" }, () => scheduleInvalidate(["message-form-checkin-inbox"]))
      // A member wrote to Support, or a support chat was read / done.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "member_support_messages" }, () => scheduleInvalidate(["staff-support-threads", "admin-nav-badges"]))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "member_support_threads" }, () => scheduleInvalidate(["staff-support-threads", "admin-nav-badges"]))
      .subscribe((status: string) => {
        rejoin(status);
        if (closing || rebuild) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          rebuild = setTimeout(() => {
            scheduleInvalidate(INBOX_KEYS);
            setChannelGen((g) => g + 1);
          }, 2_000);
        }
      });
    return () => {
      closing = true;
      if (pending) clearTimeout(pending);
      if (rebuild) clearTimeout(rebuild);
      supabase.removeChannel(ch);
    };
  }, [qc, channelGen]);

  // Watchdog: a socket can look connected but be dead (no error, no events).
  // While the inbox is on screen, check the newest message and conversation
  // update every 15s (two 1-row reads) and refresh the list if it's behind.
  useEffect(() => {
    let last: string | null = null;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const [m, st] = await Promise.all([
          (supabase.from("messages") as any).select("id, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
          (supabase.from("conversation_state") as any).select("client_id, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const sig = `${m.data?.id}|${m.data?.updated_at}|${st.data?.client_id}|${st.data?.updated_at}`;
        if (last !== null && sig !== last) {
          for (const k of INBOX_KEYS) qc.invalidateQueries({ queryKey: [k] });
          try { if (!supabase.realtime.isConnected()) supabase.realtime.connect(); } catch { /* noop */ }
        }
        last = sig;
      } catch { /* offline: next tick */ }
    };
    void check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [qc]);

  const lastByClient = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of lastMessages) if (!m.has(msg.client_id)) m.set(msg.client_id, msg);
    return m;
  }, [lastMessages]);

  // When I (staff) last replied in each chat (the Brief's "since").
  const lastStaffReplyByClient = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of lastMessages) {
      if (msg.sender_role === "client" || msg.is_internal_note) continue;
      const cur = m.get(msg.client_id);
      if (!cur || msg.created_at > cur) m.set(msg.client_id, msg.created_at);
    }
    return m;
  }, [lastMessages]);

  // Filled in, not reviewed yet (only the latest per form / check-in type).
  const toReviewRows = useMemo(
    () => latestToReview(
      pendingSubmissions.map((p: any) => ({
        client_id: p.client_id,
        kind: p.kind,
        submitted_at: p.submitted_at,
        type: p.kind === "form" ? p.form_id : p.task_type,
        reviewed: !!p.reviewed_at || p.status === "reviewed",
        superseded: !!p.superseded_at,
      })),
    ),
    [pendingSubmissions],
  );
  const requestsByClient = useMemo(
    () =>
      deriveRequests({
        checkins: requestStatus?.checkins ?? [],
        submissions: requestStatus?.submissions ?? [],
        messages: lastMessages.filter((m) => (m.attachments ?? []).some((a) => a?.kind === "form_request")),
        toReview: toReviewRows,
      }),
    [requestStatus, lastMessages, toReviewRows],
  );

  /** Waiting state + forms chip for one client's row. */
  const statusFor = (clientId: string, last: Message | undefined, workflowState: string) => {
    const req = requestsByClient.get(clientId);
    const hasPendingRequest = !!req?.pending.length;
    const waiting: WaitingState | null =
      workflowState === "waiting_on_client"
        ? waitingState({ last, hasPendingRequest, oldestPendingSince: oldestPending(req) })
        : null;
    return { waiting, chip: requestChip(req), hasRequests: !!req && (req.pending.length > 0 || req.toReview > 0 || req.missed > 0) };
  };

  // Blue dot = a new message from the client that *I* (this staff member)
  // haven't read (staff_inbox_state: never a form sent in or a check-in card).
  const unreadByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inboxState) if (r.unread) m.set(r.client_id, Math.max(1, r.unread_count));
    return m;
  }, [inboxState]);

  const stateMap = useMemo(() => new Map(states.map((s) => [s.client_id, s])), [states]);

  const liftReviewsByClient = useMemo(() => {
    const m = new Map<string, { count: number; latestAt: string; urgent: boolean }>();
    for (const item of liftReviewItems) {
      const at = item.updated_at || item.created_at;
      const current = m.get(item.client_id);
      if (!current) {
        m.set(item.client_id, { count: 1, latestAt: at, urgent: !!item.is_urgent });
      } else {
        current.count += 1;
        if (at > current.latestAt) current.latestAt = at;
        current.urgent = current.urgent || !!item.is_urgent;
      }
    }
    return m;
  }, [liftReviewItems]);

  // What's waiting on me per client, one reading for the filters, the row
  // tags and the Brief: forms to review / overdue, photos & videos nobody
  // reacted to, pain notes, session requests.
  const mediaByClient = useMemo(() => {
    const reactedBy = new Map<string, string[]>();
    for (const r of mediaReactions) reactedBy.set(r.message_id, [...(reactedBy.get(r.message_id) ?? []), r.user_id]);
    const userOf = new Map(clients.map((c) => [c.id, (c as any).user_id as string | null]));
    return mediaWaitingByClient(lastMessages as any, reactedBy, userOf);
  }, [lastMessages, mediaReactions, clients]);
  const painByClient = useMemo(() => painWaitingByClient(lastMessages as any), [lastMessages]);
  const reviewByClient = useMemo(() => reviewItemsByClient(toReviewRows, formTitles(lastMessages as any)), [toReviewRows, lastMessages]);
  // what their upcoming workouts are missing (the Program data filter, the row's line, the Brief)
  const programGaps = useProgramGaps({ enabled: role === "admin" || role === "coach" });
  const sessionRequestsByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of sessionRequestRows) m.set(r.client_id, (m.get(r.client_id) ?? 0) + 1);
    return m;
  }, [sessionRequestRows]);

  // Coaching workflows stay in their established chat; uncoached accounts use personal DMs.
  const allRows = useMemo(() => clients.filter((c) => (c as any).service_tier !== "self_serve").map((c) => {
    const state = stateMap.get(c.id);
    const last = lastByClient.get(c.id);
    const unread = unreadByClient.get(c.id) ?? 0;
    const liftReview = liftReviewsByClient.get(c.id) ?? null;
    const server = inboxByClient.get(c.id);
    const workflow = deriveInboxWorkflow({
      workflowStatus: server?.workflow_status ?? (state as any)?.workflow_status,
      workflowReason: server?.workflow_reason,
      lastInboundKind: server?.last_inbound_kind,
      lastMessage: last,
      storedStatus: state?.status,
      pendingLiftReview: !!liftReview,
    });
    const status = statusFor(c.id, last, workflow.state);
    const req = requestsByClient.get(c.id);
    const { overdue, pending } = splitRequests(req);
    const signals: ClientSignals = {
      needsReply: workflow.state === "needs_response"
        ? { since: server?.last_inbound_at ?? (last?.sender_role === "client" ? last.created_at : null), detail: workflow.detail }
        : null,
      toReview: reviewByClient.get(c.id) ?? [],
      overdue,
      pending,
      missed: req?.missed ?? 0,
      media: mediaByClient.get(c.id) ?? [],
      pain: painByClient.get(c.id) ?? [],
      sessionRequests: sessionRequestsByClient.get(c.id) ?? 0,
      program: programGaps.byClient.get(c.id) ?? null,
    };
    const tags = signalTags(signals, {
      followUp: workflow.state === "waiting_on_client" && status.waiting === "overdue",
      priority: state?.priority,
    });
    return { client: c, state, last, unread, liftReview, workflow, signals, tags, ...status };
  }), [clients, stateMap, lastByClient, unreadByClient, liftReviewsByClient, inboxByClient, requestsByClient,
    reviewByClient, mediaByClient, painByClient, sessionRequestsByClient, programGaps.byClient]);

  const conversations = useMemo(() => {
    const items = allRows
      .filter((it) => {
        if (search) {
          const s = search.toLowerCase();
          if (!it.client.full_name?.toLowerCase().includes(s) && !it.client.email?.toLowerCase().includes(s)) return false;
        }
        return inFilter(it, filter);
      })
      // Like iMessage / Instagram DMs: the newest activity on top, in every
      // filter. What needs me is the NEEDS RESPONSE chip and its filter, not a
      // different order (a chat from a minute ago sat under 4-day-old ones).
      .sort((a, b) => newestFirst(
        latestOf(a.last?.created_at, a.liftReview?.latestAt),
        latestOf(b.last?.created_at, b.liftReview?.latestAt),
      ));
    // A form's own filter: each row's line leads with where that form stands.
    if (filter === "Weekly" || filter === "Nutrition") {
      const kind = FORM_FILTER_KIND[filter];
      return items.map((it) => ({ ...it, tags: formKindTags(it.tags, it.signals, kind) }));
    }
    return items;
  }, [allRows, search, filter]);

  // The form filters' strip: how many filled in (to review) and how many overdue.
  const formFilterSummary = useMemo(() => {
    if (filter !== "Weekly" && filter !== "Nutrition") return null;
    const kind = FORM_FILTER_KIND[filter];
    let review = 0;
    let overdue = 0;
    for (const it of allRows) {
      if ((it.state?.status ?? "open") === "archived") continue;
      const w = formKindWaiting(it.signals, kind);
      if (w.review) review += 1;
      if (w.overdue) overdue += 1;
    }
    return { kind, review, overdue };
  }, [allRows, filter]);

  // Live badge counts: the very rule the list filters by, over the same rows.
  const filterCounts = useMemo(() => {
    const counts: Partial<Record<Filter, number>> = {};
    for (const it of allRows) {
      for (const f of COUNTED) if (inFilter(it, f)) counts[f] = (counts[f] ?? 0) + 1;
    }
    // Support chats marked Done sit under Archived.
    const doneSupport = supportChats.filter((c) => c.done).length;
    if (doneSupport) counts.Archived = (counts.Archived ?? 0) + doneSupport;
    // Support's number is the chats that need you (its chip shows while there's any Support chat).
    counts.Support = supportQueueCounts(supportChats).needs_me;
    return counts;
  }, [allRows, supportChats]);
  const supportCounts = useMemo(() => supportQueueCounts(supportChats), [supportChats]);

  // The Inbox chip's number: chats with a new message, the same chats and the
  // same number as the Messages tab's badge (messagesBadge).
  const newChats = useMemo(
    () => allRows.filter((it) => it.unread > 0 && (it.state?.status ?? "open") !== "archived").length
      + supportNewChats(supportChats) + personalUnread,
    [allRows, supportChats, personalUnread],
  );

  // Members' Support chats this filter shows, then one list with the coach chats, newest first.
  const supportVisible = useMemo(
    () => supportChats.filter((c) => supportMatches(c, search)
      && (filter === "Support" ? inSupportQueue(c, supportQueue) : supportInFilter(c, filter))),
    [supportChats, search, filter, supportQueue],
  );
  // Group chats this view shows: not under the Filter menu's client filters (those are
  // about one client), archived ones only under Archived.
  const groupsVisible = useMemo(() => {
    if (filter !== "Inbox" && filter !== "Archived") return [];
    const s = search.trim().toLowerCase();
    return groupItems
      .filter((g) => (filter === "Archived" ? g.group.archived : !g.group.archived))
      .filter((g) => !s || g.group.name.toLowerCase().includes(s))
      .sort((a, b) => newestFirst(a.at, b.at));
  }, [groupItems, filter, search]);
  const unreadGroups = useMemo(() => groupItems.filter((g) => g.unread).length, [groupItems]);
  // One list, newest first: clients' chats, members' Support chats and group
  // chats, narrowed by All · Unread · Groups · 1:1 Chats.
  const listRows = useMemo(() => {
    const direct = mergeByRecency(
      conversations, (it) => latestOf(it.last?.created_at, it.liftReview?.latestAt),
      supportVisible, (c) => c.at,
    );
    type ListRow = (typeof direct)[number] | { kind: "group"; item: (typeof groupsVisible)[number] } | { kind: "personal"; item: DirectThread } | { kind: "member"; item: (typeof clients)[number] };
    const at = (r: ListRow) => r.kind === "group" ? r.item.at
      : r.kind === "support" ? r.item.at
      : r.kind === "personal" ? r.item.last_at
      : r.kind === "member" ? ""
        : latestOf(r.item.last?.created_at, r.item.liftReview?.latestAt);
    const merged: ListRow[] = [];
    let i = 0;
    let j = 0;
    while (i < direct.length || j < groupsVisible.length) {
      if (j >= groupsVisible.length) merged.push(direct[i++]);
      else if (i >= direct.length) merged.push({ kind: "group", item: groupsVisible[j++] });
      else if (newestFirst(groupsVisible[j].at, at(direct[i])) < 0) merged.push({ kind: "group", item: groupsVisible[j++] });
      else merged.push(direct[i++]);
    }
    if (filter === "Inbox") {
      const term = search.trim().toLowerCase();
      for (const t of personalThreads) {
        if (!term || `${t.other?.name ?? ""} ${t.last?.body ?? ""}`.toLowerCase().includes(term)) merged.push({ kind: "personal", item: t });
      }
      // Searching for a member starts a personal chat on the first send, without creating empty Support tickets.
      if (term && personalQ.isSuccess) {
        for (const c of clients) {
          if (c.service_tier === "self_serve" && c.user_id && c.user_id !== user?.id && !c.archived && !["Archived", "Inactive", "Deactivated"].includes(c.status ?? "") &&
            !personalThreads.some((t) => t.other?.user_id === c.user_id) && `${c.full_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(term)) merged.push({ kind: "member", item: c });
        }
      }
    }
    return merged.sort((a, b) => newestFirst(at(a), at(b))).filter((r) => inPrimary({
      kind: r.kind === "group" ? "group" : "direct",
      unread: r.kind === "group" ? r.item.unread : r.kind === "personal" ? directUnread(r.item, user?.id) : r.kind === "member" ? false : r.item.unread > 0,
    }, primary));
  }, [conversations, supportVisible, groupsVisible, primary, filter, search, personalThreads, personalQ.isSuccess, clients, user?.id]);
  // Cleo and the coaching queues: the top of All with nothing narrowing it.
  const pinnedSystem = primary === "all" && filter === "Inbox" && !search;

  const briefRow = briefFor ? allRows.find((r) => r.client.id === briefFor) ?? null : null;

  const refreshInbox = () => {
    qc.invalidateQueries({ queryKey: ["staff-inbox-state"] });
    qc.invalidateQueries({ queryKey: ["conversation-states"] });
    qc.invalidateQueries({ queryKey: ["last-messages"] });
    qc.invalidateQueries({ queryKey: ["admin-nav-badges"] });
  };

  const changeWorkflow = async (clientId: string, next: WorkflowStatus, opts: { undoFrom?: WorkflowStatus } = {}) => {
    try {
      await setConversationWorkflow(clientId, next);
      refreshInbox();
      const from = opts.undoFrom;
      toast.success(`Marked ${WORKFLOW_LABEL[next]}`, from && from !== next ? {
        action: { label: "Undo", onClick: () => { void setConversationWorkflow(clientId, from).then(refreshInbox); } },
      } : undefined);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update status");
    }
  };

  const selected = clients.find((c) => c.id === selectedId);
  const selectedState = selectedId ? stateMap.get(selectedId) : undefined;
  // "Live in chat" for the client only while I actually have their chat open.
  // Opening an account is personal. Support is only opened explicitly from its own row.
  const selectedIsMember = selected?.service_tier === "self_serve";
  const openSupport: SupportChat | null = supportId ? supportChats.find((c) => c.threadId === supportId) ?? null : null;
  const supportOpen = !!supportId;
  const openDirect = directId ? personalThreads.find((t) => t.group_id === directId) : selectedIsMember ? personalThreads.find((t) => t.other?.user_id === selected?.user_id) : undefined;
  const openGroup = groupId ? staffGroups.find((g) => g.id === groupId) ?? null : null;
  const paneOpen = !!selected || !!supportId || !!openGroup || !!directId;
  const { peerLive: selectedClientLive } = useChatPresence(selectedId, "admin", !openGroup && !!selected && !selectedIsMember);

  // A client is "active in the app" if they've pinged within the last 3 min.
  const isClientActive = (last_active_at?: string | null) => {
    if (!last_active_at) return false;
    return Date.now() - new Date(last_active_at).getTime() < 3 * 60_000;
  };

  // Start loading a thread on finger-down: the ~150ms before the tap
  // completes is enough that history is usually there when it opens.
  const prefetchThread = (id: string) => {
    void qc.prefetchQuery({ ...threadMessagesQuery(id, "admin"), staleTime: 10_000 });
  };

  const selectClient = (id: string) => {
    setDirectId(null);
    setSupportId(null);
    setGroupId(null);
    setSelectedId(id);
    navigate({ to: "/admin/communication", search: { tab: "messages", client: id } as any, replace: true });
  };
  const selectSupport = (threadId: string) => {
    setDirectId(null);
    setSelectedId(null);
    setGroupId(null);
    setSupportId(threadId);
    navigate({ to: "/admin/communication", search: { tab: "messages", support: threadId } as any, replace: true });
  };
  const selectGroup = (id: string) => {
    setDirectId(null);
    setSelectedId(null);
    setSupportId(null);
    setGroupId(id);
    navigate({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });
  };
  const selectDirect = (id: string) => {
    setSelectedId(null);
    setSupportId(null);
    setGroupId(null);
    setDirectId(id);
    navigate({ to: "/admin/communication", search: { tab: "messages", direct: id } as any, replace: true });
  };
  const clearSelection = () => {
    setDirectId(null);
    setSelectedId(null);
    setSupportId(null);
    setGroupId(null);
    navigate({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });
  };
  const supportAction = async (threadId: string, patch: { status?: "open" | "closed"; read?: boolean; handler?: "cleo" | "human" }, ok: string) => {
    try {
      await updateSupport({ data: { threadId, ...patch } });
      SUPPORT_REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
      toast.success(ok);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update this chat");
    }
  };

  const enterSelectedClientPov = () => {
    if (!selected) return;
    if (!(selected as any).user_id) {
      toast.error("This client doesn't have an app account yet.");
      return;
    }
    clientPov.start(
      {
        id: selected.id,
        user_id: (selected as any).user_id,
        full_name: selected.full_name,
      },
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : `/admin/communication?tab=messages&client=${selected.id}`,
    );
    navigate({ to: CLIENT_VIEW_HOME });
  };

  const updateStatus = async (status: ConversationState["status"]) => {
    if (!selectedId) return;
    await setConversationStatus(selectedId, status);
    qc.invalidateQueries({ queryKey: ["conversation-states"] });
  };
  const updatePriority = async (priority: string) => {
    if (!selectedId) return;
    await setConversationPriority(selectedId, priority);
    qc.invalidateQueries({ queryKey: ["conversation-states"] });
  };

  const handleMarkUnread = async () => {
    if (!selectedId) return;
    await markUnread(selectedId, "admin");
    refreshInbox();
    toast.success("Marked unread");
  };
  const handleMarkRead = async () => {
    if (!selectedId) return;
    await markRead(selectedId, "admin");
    refreshInbox();
  };
  const selectedWorkflow = selectedId
    ? deriveInboxWorkflow({
        workflowStatus: inboxByClient.get(selectedId)?.workflow_status ?? (selectedState as any)?.workflow_status,
        workflowReason: inboxByClient.get(selectedId)?.workflow_reason,
        lastInboundKind: inboxByClient.get(selectedId)?.last_inbound_kind,
        lastMessage: lastByClient.get(selectedId),
        storedStatus: selectedState?.status,
      })
    : null;

  // Full-bleed two-pane layout. On <md: stacked — inbox OR conversation.
  // On md+: persistent inbox sidebar (320–360px) + conversation pane.
  return (
    <div
      className={cn(
        "flex flex-col bg-background",
        embedded
          // Stays inside the workspace shell — the parent (Communication
          // workspace) constrains height to the viewport, so we just fill
          // the remaining space. Avoids landscape/PWA cases where a fixed
          // dvh calc pushed the message list above the viewport and only
          // the composer was visible.
          ? "h-full w-full min-h-0"
          : "phone-column fixed inset-x-0 z-30 md:static md:inset-auto md:z-auto md:h-full md:flex-1",
      )}
      style={
        embedded
          ? undefined
          : {
              // Track the iOS Visual Viewport so the chat shrinks above the
              // keyboard instead of leaving a dead gap. See useKeyboardOpen().
              top: "calc(var(--vv-top, 0px) + var(--app-top-chrome, 0px))",
              height:
                "calc(var(--vv-h, 100dvh) - var(--app-top-chrome, 0px) - var(--bottom-nav-clearance, 0px))",
            }
      }
    >
      <div className="flex min-h-0 flex-1 w-full flex-col">
        <div className="flex min-h-0 flex-1">
      {/* Inbox sidebar */}
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border bg-card md:w-[380px] md:shrink-0",
          paneOpen ? "hidden md:flex" : "flex",
        )}
      >
        <header
          className="border-b border-border pt-2"
          style={
            embedded
              ? undefined
              : { paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }
          }
        >
          <InboxControls
            className="pb-2.5 pt-0"
            query={search}
            onQuery={setSearch}
            placeholder="Search"
            filter={primary}
            onFilter={(f) => { setPrimary(f); if (f === "groups" && filter !== "Inbox" && filter !== "Archived") setFilter("Inbox"); }}
            unread={newChats + unreadGroups}
            actions={<>
              {canCompose && <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="New message" title="New message" onClick={() => { setComposeSearch(""); setComposeOpen(true); }} data-admin-compose><SquarePen className="h-5 w-5" /></Button>}
              <FilterMenu
                filter={filter}
                counts={filterCounts}
                onPick={(f) => { setFilter(f); if (f !== "Inbox" && f !== "Archived" && primary === "groups") setPrimary("all"); }}
              />
              <InboxMoreMenu
                appAlerts={appAlerts}
                onNewGroup={() => setNewGroupOpen(true)}
                onMass={() => setMassOpen(true)}
                onGuide={() => setGuideOpen(true)}
              />
            </>}
            leading={filter !== "Inbox" ? (
              // the Filter menu's view you're on, first in the row: tap to clear it
              <button
                type="button"
                onClick={() => setFilter("Inbox")}
                data-active-filter={filter}
                aria-label={`Clear filter: ${FILTER_LABEL[filter] ?? filter}`}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-foreground pl-3.5 pr-2.5 text-[15px] font-semibold text-background"
              >
                {FILTER_LABEL[filter] ?? filter}
                <X className="h-4 w-4" />
              </button>
            ) : undefined}
          />
          {filter === "Support" && (
            // JF Effect Support's own queue: Needs Me first
            <div className="-mt-0.5 flex gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Support queue">
              {SUPPORT_QUEUE_FILTERS.map(([key, label]) => {
                const on = supportQueue === key;
                const n = key === "needs_me" || key === "unread" ? supportCounts[key] : 0;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    title={SUPPORT_QUEUE_HELP[key]}
                    onClick={() => setSupportQueue(key)}
                    data-support-queue={key}
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center rounded-full border px-3 text-[13px] font-semibold transition",
                      on ? "border-transparent bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-secondary/60",
                    )}
                  >
                    {label}
                    {n > 0 && <span className="ml-1 tabular-nums opacity-80">{badgeNumber(n)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {/* the filter's way out to where its work lives (the forms tracker, program fixes) */}
          <div className="px-4 empty:hidden [&>*]:mb-2 [&>*]:mt-0">
          {formFilterSummary && (
            <Link
              to="/admin/forms"
              search={{ tab: "requests", kind: formFilterSummary.kind } as any}
              data-form-filter-summary
              className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-[13px] font-semibold text-foreground hover:bg-secondary"
            >
              <span className="min-w-0 truncate">
                <span className={formFilterSummary.review ? "text-sky-700 dark:text-sky-400" : "text-muted-foreground"}>{formFilterSummary.review} to review</span>
                <span className="text-muted-foreground"> · </span>
                <span className={formFilterSummary.overdue ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>{formFilterSummary.overdue} overdue</span>
              </span>
              <span className="shrink-0">Every week in the tracker ›</span>
            </Link>
          )}
          {filter === "Program" && (
            <Link
              to="/admin/program-gaps"
              data-program-gaps-strip
              className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-[13px] font-semibold text-foreground hover:bg-secondary"
            >
              <span className="min-w-0 truncate">Every client's missing program data, with fixes</span>
              <span aria-hidden>›</span>
            </Link>
          )}
          {filter === "Overdue" && (
            <Link
              to="/admin/forms"
              search={{ tab: "requests" } as any}
              className="mt-1 flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-[13px] font-semibold text-foreground hover:bg-secondary"
            >
              <span>Manage outstanding requests: open, re-send or delete</span>
              <span aria-hidden>›</span>
            </Link>
          )}
          </div>
        </header>
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            embedded
              ? "pb-[max(env(safe-area-inset-bottom),0.75rem)]"
              : "pb-[calc(var(--bottom-nav-clearance,0px)+max(env(safe-area-inset-bottom),1.5rem))]",
          )}
        >
          {/* Cleo and the coaching queues lead All, pinned like iMessage's pins: a
              normal row each, hidden by a search, another filter or Groups. */}
          {pinnedSystem && cleoOn && (
            // Not a client thread: nothing is ever sent.
            <ChatListRow
              as="div"
              data-cleo-row
              onClick={() => openSummer()}
              avatar={<CleoAvatar size="lg" />}
              name="Cleo"
              preview={`${CLEO_ROLE_LINE} · Ask anything, or tap the mic`}
              pinned
              after={
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openSummer({ dictate: true }); }}
                  className="grid h-10 w-10 place-items-center rounded-full border border-border text-foreground transition hover:bg-muted/60"
                  aria-label="Talk to Cleo"
                  title="Talk to Cleo"
                >
                  <Mic className="h-5 w-5" />
                </button>
              }
            />
          )}
          {/* Replies and follow-ups to pain reports waiting for approval (whoever has automation; it hides itself otherwise). */}
          {pinnedSystem && <RecoveryInboxRow />}
          {pinnedSystem && <CompetitionsInboxRow />}
          {/* New coaching applications, with the AI's read and a text to send (admin). */}
          {role === "admin" && pinnedSystem && <LeadsInboxRow />}
          {/* Free membership applications waiting on a decision (admin). */}
          {role === "admin" && pinnedSystem && <MemberApplicationsInboxRow />}
          {/* Their athletes found on OpenIPF and new meets for the linked ones (a coach sees their own clients'). */}
          {pinnedSystem && <OpenIpfInboxRow />}
          {listRows.length === 0 && clientsState === "loading" ? (
            <ListSkeleton rows={6} className="p-4" label="Loading conversations" />
          ) : listRows.length === 0 && clientsState === "offline" ? (
            <OfflineState what="your conversations" className="m-4" />
          ) : listRows.length === 0 && clientsState === "error" ? (
            <ErrorState error={clientsQ.error} what="your conversations" onRetry={() => clientsQ.refetch()} retrying={clientsQ.isFetching} className="m-4" />
          ) : listRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {filter === "Support" && supportQueue === "needs_me" ? "Nothing needs you in Support. Cleo hands chats to you here."
                : primary === "unread" ? "You're all caught up." : primary === "groups" ? "No group chats yet. Start one from ⋯." : "No conversations."}
            </div>
          ) : listRows.map((row) => row.kind === "group" ? (
            <GroupChatRow
              key={`group:${row.item.group.id}`}
              group={row.item.group}
              last={row.item.last}
              unread={row.item.unread}
              selected={groupId === row.item.group.id}
              onClick={() => selectGroup(row.item.group.id)}
            />
          ) : row.kind === "personal" ? (
            <DirectRow key={`personal:${row.item.group_id}`} thread={row.item} me={user?.id} selected={openDirect?.group_id === row.item.group_id} onClick={() => selectDirect(row.item.group_id)} />
          ) : row.kind === "member" ? (
            <ChatListRow key={`member:${row.item.id}`} onClick={() => selectClient(row.item.id)} selected={selectedId === row.item.id} avatar={<UserAvatar src={row.item.profile_picture_url} name={row.item.full_name ?? "Member"} size={CHAT_ROW_AVATAR} expandable={false} />} name={row.item.full_name ?? "Member"} preview="New message" />
          ) : row.kind === "support" ? (
            <SupportChatRow
              key={`support:${row.item.threadId}`}
              chat={row.item}
              selected={supportId === row.item.threadId}
              onOpen={() => selectSupport(row.item.threadId)}
              onAction={supportAction}
            />
          ) : (({ client, state, last, unread, liftReview, workflow, signals, tags }) => (
            <SwipeableRow
              key={client.id}
              actions={[
                {
                  key: "unread",
                  label: unread > 0 ? "Read" : "Unread",
                  color: "primary",
                  icon: unread > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />,
                  onSelect: async () => {
                    if (unread > 0) {
                      await markRead(client.id, "admin");
                    } else {
                      await markUnread(client.id, "admin");
                    }
                    refreshInbox();
                  },
                },
                // Clear a chat that needs nothing more from either side (a reply of mine, or a closer nobody needs to answer).
                ...(workflow.state === "needs_response" || workflow.state === "waiting_on_client" ? [{
                  key: "done",
                  label: "Done",
                  color: "primary" as const,
                  icon: <Check className="h-4 w-4" />,
                  onSelect: () => changeWorkflow(client.id, "done", { undoFrom: workflow.state as WorkflowStatus }),
                }] : []),
                {
                  key: "archive",
                  label: state?.status === "archived" ? "Unarchive" : "Archive",
                  color: "destructive",
                  icon: state?.status === "archived" ? <Archive className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />,
                  onSelect: async () => {
                    const next = state?.status === "archived" ? "open" : "archived";
                    await setConversationStatus(client.id, next);
                    qc.invalidateQueries({ queryKey: ["conversation-states"] });
                    toast.success(next === "archived" ? "Conversation archived" : "Conversation restored");
                  },
                },
              ]}
            >
            <ChatListRow
              as="div"
              onPointerDown={() => prefetchThread(client.id)}
              onClick={() => selectClient(client.id)}
              selected={selectedId === client.id}
              unread={unread > 0}
              unreadLabel={`${unread} unread message${unread === 1 ? "" : "s"}`}
              at={(liftReview?.latestAt ?? "") > (last?.created_at ?? "") ? liftReview!.latestAt : last?.created_at}
              avatar={
                // Their photo opens the Brief: everything waiting + an AI read.
                <button
                  type="button"
                  data-open-brief
                  aria-label={`Brief: ${client.full_name ?? "client"}${waitingCount(signals) ? `, ${waitingCount(signals)} waiting` : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setBriefFor(client.id); }}
                  className="relative flex shrink-0 rounded-full transition active:scale-95"
                >
                  {/* the same live look as the client's inbox: a dot on the photo */}
                  <LiveAvatar
                    live={isClientActive((client as any).last_active_at) || (client.id === selectedId && selectedClientLive)}
                    size={CHAT_ROW_AVATAR}
                  >
                    <UserAvatar
                      src={client.profile_picture_url}
                      name={client.full_name}
                      size={CHAT_ROW_AVATAR}
                      expandable={false}
                    />
                  </LiveAvatar>
                </button>
              }
              name={client.full_name}
              preview={
                liftReview && liftReview.latestAt >= (last?.created_at ?? "")
                  ? `Lift review · ${liftReview.count} waiting`
                  : last
                    ? previewPrefix(last as any) + (messagePreviewText(last.body, last.attachments) || "(attachment)")
                    : "No messages yet"
              }
              extra={tags.length > 0 && (
                // One quiet line of what's waiting. Tapping it (or their photo) opens the Brief.
                <span className="mt-0.5 flex min-h-6 items-center gap-1.5" data-row-tags>
                  <button
                    type="button"
                    data-open-brief-line
                    aria-label={`Brief: ${client.full_name ?? "client"}. ${tags.map((t) => t.label).join(", ")}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setBriefFor(client.id); }}
                    className="-mx-1 inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-left text-[13px] leading-[18px] transition hover:bg-secondary/60 active:bg-secondary"
                  >
                    <SignalLine tags={tags} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  </button>
                  {workflow.state === "needs_response" && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Mark ${client.full_name ?? "conversation"} done`}
                      title="No reply needed: mark done"
                      onClick={(e) => { e.stopPropagation(); void changeWorkflow(client.id, "done", { undoFrom: "needs_response" }); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void changeWorkflow(client.id, "done", { undoFrom: "needs_response" }); } }}
                      className="ml-auto hidden h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-600 [@media(hover:hover)]:grid"
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </span>
              )}
            />
            </SwipeableRow>
          ))(row.item))}
        </div>
      </aside>

      {/* Conversation pane */}
      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          paneOpen ? "flex" : "hidden md:flex",
        )}
      >
        {openGroup ? (
          <GroupThreadPane key={openGroup.id} group={openGroup} canManage onBack={clearSelection} />
        ) : supportOpen ? (
          <MemberSupportPane
            key={openSupport?.threadId ?? supportId ?? `client:${selected?.id}`}
            threadId={openSupport?.threadId ?? supportId ?? undefined}
            clientId={undefined}
            fallback={openSupport
              ? { name: openSupport.name, avatar: openSupport.avatar }
              : selected ? { name: selected.full_name ?? "Member", avatar: selected.profile_picture_url ?? null } : undefined}
            onBack={clearSelection}
            embedded={embedded}
          />
        ) : openDirect ? (
          <DirectChatView key={openDirect.group_id} thread={openDirect} onBack={clearSelection} />
        ) : directId || selectedIsMember ? (
          personalQ.isError ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5"><p>Could not load your direct chats.</p><Button onClick={() => personalQ.refetch()}>Retry</Button><Button variant="ghost" onClick={clearSelection}>Back</Button></div>
          : !personalQ.isSuccess ? <ListSkeleton rows={5} className="p-4" label="Loading conversation" />
          : !directId && selected?.user_id ? <NewRequestView key={selected.id} staffClientId={selected.id} to={{ user_id: selected.user_id, name: selected.full_name ?? "Member", avatar_url: selected.profile_picture_url ?? null, is_coach: false }} onBack={clearSelection} onSent={async (id) => { await qc.refetchQueries({ queryKey: directThreadsKey }); selectDirect(id); }} />
          : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5"><p>This conversation is unavailable.</p><Button variant="ghost" onClick={clearSelection}>Back</Button></div>
        ) : selected ? (
          <>
            <header
              className="flex items-center gap-1.5 border-b border-border bg-card/80 px-2 py-2 backdrop-blur sm:gap-2 supports-[backdrop-filter]:bg-card/60 md:px-4"
              style={
                embedded
                  ? undefined
                  : { paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }
              }
            >
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 h-8 w-8 shrink-0 md:hidden"
                onClick={clearSelection}
                aria-label="Back to inbox"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <ClientNameLink
                clientId={selected.id}
                ariaLabel={`Open ${selected.full_name ?? "client"} profile`}
                title="Open client profile"
                className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* live: the turning ring, as everywhere (the line under the name says where) */}
                <LiveAvatar live={selectedClientLive || isClientActive((selected as any).last_active_at)} size={40} tag={false}>
                  <UserAvatar
                    src={selected.profile_picture_url}
                    name={selected.full_name}
                    size={40}
                  />
                </LiveAvatar>
              </ClientNameLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-bold">
                  {/* Their name opens the Brief: everything waiting, read for you */}
                  <button
                    type="button"
                    data-open-brief
                    onClick={() => setBriefFor(selected.id)}
                    className="inline-flex min-w-0 items-center gap-1 rounded-md hover:opacity-80"
                    aria-label={`Brief: ${selected.full_name ?? "client"}`}
                  >
                    <span className="truncate">{selected.full_name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                  {(selectedClientLive || isClientActive((selected as any).last_active_at)) && (
                    <LiveMark className="hidden shrink-0 text-[11px] font-semibold sm:inline-flex" size={6}>
                      {selectedClientLive ? "Live in chat" : "Active now"}
                    </LiveMark>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
                  {selectedState?.priority && selectedState.priority !== "Normal" && (
                    <PriorityChip priority={selectedState.priority} />
                  )}
                  {selectedWorkflow && <WorkflowPill state={selectedWorkflow.state} compact />}
                  <span className="hidden truncate sm:inline">{selected.email}</span>
                </div>
              </div>
              {selectedWorkflow?.state === "needs_response" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 shrink-0 gap-1 px-3"
                  onClick={() => void changeWorkflow(selected.id, "done", { undoFrom: "needs_response" })}
                  title="No reply needed — clear it from Needs Response"
                >
                  <Check className="h-4 w-4" /> <span className="hidden sm:inline">Mark</span> Done
                </Button>
              )}
              {/* Three buttons (Done, Call, Notes) and ⋯: View as client and Text live in ⋯. */}
              {(selected as any).call_access_enabled && (selected as any).phone ? (
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  title={`Call ${selected.full_name ?? "client"} (${(selected as any).phone})`}
                >
                  <a href={`tel:${String((selected as any).phone).replace(/[^+\d]/g, "")}`} aria-label="Call client">
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
              {/* everything they've told you in workouts: pain, review notes, exercise notes */}
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                title={`${selected.full_name ?? "Client"}'s workout notes`}
                aria-label="Workout notes"
                onClick={() => setNotesOpen(true)}
                data-thread-notes
              >
                <NotebookPen className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-9 shrink-0 sm:w-10" aria-label="More">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {/* The profile opens from their photo; their name opens the Brief. */}
                  <DropdownMenuItem onClick={enterSelectedClientPov} title="View client POV">
                    <Eye className="mr-2 h-4 w-4" /> View as client
                  </DropdownMenuItem>
                  {(selected as any).phone && !(selected as any).sms_opt_out ? (
                    <DropdownMenuItem onClick={() => setSmsOpen(true)} title={`Send SMS to ${selected.full_name ?? "client"}`}>
                      <MessageSquare className="mr-2 h-4 w-4" /> Send a text (SMS)
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Conversation</DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleMarkUnread}>
                    <Mail className="mr-2 h-4 w-4" /> Mark as unread
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleMarkRead}>
                    <MailOpen className="mr-2 h-4 w-4" /> Mark as read
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Response status</DropdownMenuLabel>
                  {(["needs_response", "waiting_on_client", "done"] as const).map((w) => (
                    <DropdownMenuItem key={w} onClick={() => void changeWorkflow(selected.id, w, { undoFrom: selectedWorkflow?.state === "archived" ? undefined : selectedWorkflow?.state as WorkflowStatus })}>
                      Mark {WORKFLOW_LABEL[w]}{selectedWorkflow?.state === w ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {selectedState?.status === "archived"
                    ? <DropdownMenuItem onClick={() => updateStatus("open")}>Unarchive</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => updateStatus("archived")}>Archive conversation</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Priority</DropdownMenuLabel>
                  {PRIORITIES.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => updatePriority(p)}>
                      {p}{selectedState?.priority === p ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            {/* Their next meeting (Prepare · Join), only when one is booked or follow-ups are open. */}
            <MeetingStrip clientId={selected.id} variant="chat" />
            {/* What the client trained last; tap for any past or upcoming workout. */}
            <ClientWorkoutPeek clientId={selected.id} clientName={selected.full_name} />
            <MessageThread
              clientId={selected.id}
              role="admin"
              focusMessageId={selected.id === initialClient ? initialMessage ?? null : null}
              conversationState={selectedState ?? null}
              hideControls
              fullBleed
              peerName={selected.full_name}
              peerAvatarPath={selected.profile_picture_url}
            />
            <ClientNotesSheet clientId={notesOpen ? selected.id : null} name={selected.full_name ?? null} onClose={() => setNotesOpen(false)} coachNotes />
            <SendSmsDialog
              open={smsOpen}
              onOpenChange={setSmsOpen}
              clientId={selected.id}
              clientName={selected.full_name}
              firstName={(selected as any).first_name}
              phone={(selected as any).phone}
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Select a conversation to start.
          </div>
        )}
      </section>
        </div>
        {canCompose && composeOpen && <TallSheet open={composeOpen} onOpenChange={setComposeOpen} title="New message" sub="Choose someone to message directly.">
          <div className="shrink-0 px-4 pb-3">
            <Input type="search" aria-label="Who to message" placeholder="Search by name or email" value={composeSearch} onChange={(e) => setComposeSearch(e.target.value)} className="h-10 rounded-xl text-base" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2" aria-label="Message recipients">
            {clientsQ.isError ? <div className="p-4 text-center"><p className="mb-2 text-sm text-muted-foreground">Could not load recipients.</p><Button onClick={() => clientsQ.refetch()}>Retry</Button></div>
              : clientsQ.isPending ? <ListSkeleton rows={5} className="p-2" label="Loading recipients" />
              : composePeople.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No matching accounts.</p>
              : composePeople.map((c) => <button key={c.id} type="button" className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-secondary/60 focus-visible:outline focus-visible:outline-primary" onClick={() => { setComposeOpen(false); setComposeSearch(""); setSearch(""); setFilter("Inbox"); setPrimary("all"); selectClient(c.id); }}>
                <UserAvatar src={c.profile_picture_url} name={c.full_name ?? "Member"} size={40} expandable={false} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.full_name ?? c.email ?? "Member"}</span><span className="block truncate text-xs text-muted-foreground">{c.service_tier === "self_serve" ? "Member" : "Client"}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>)}
          </div>
        </TallSheet>}
        <MassMessageDialog open={massOpen} onOpenChange={setMassOpen} />
        <InboxGuideSheet open={guideOpen} onOpenChange={setGuideOpen} filters={GUIDE_FILTERS} />
      <ClientBriefSheet
          open={!!briefRow}
          onOpenChange={(o) => { if (!o) setBriefFor(null); }}
          client={briefRow ? {
            id: briefRow.client.id,
            full_name: briefRow.client.full_name,
            profile_picture_url: briefRow.client.profile_picture_url,
            last_active_at: (briefRow.client as any).last_active_at ?? null,
          } : null}
          signals={briefRow?.signals}
          needsReply={briefRow?.workflow.state === "needs_response"}
          waitingOnClient={briefRow && briefRow.workflow.state === "waiting_on_client" && briefRow.waiting && briefRow.waiting !== "fyi"
            ? { since: lastStaffReplyByClient.get(briefRow.client.id) ?? briefRow.last?.created_at ?? new Date().toISOString(), overdue: briefRow.waiting === "overdue" }
            : null}
          readReceipt={briefRow?.last?.sender_role === "admin"
            ? ((briefRow.last as any).read_by_client_at ? formatReadReceipt((briefRow.last as any).read_by_client_at) : "Not read yet")
            : null}
          onOpenChat={() => { if (briefRow) selectClient(briefRow.client.id); }}
          onMarkDone={() => { if (briefRow) void changeWorkflow(briefRow.client.id, "done", { undoFrom: "needs_response" }); }}
        />
        {newGroupOpen && <CreateGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} />}
      </div>
    </div>
  );
}

/** A Support chat in the list: their face, the latest message, the blue dot, "JF member · Support" (or "Client · JF Effect Support"). */
function SupportChatRow({
  chat, selected, onOpen, onAction,
}: {
  chat: SupportChat;
  selected: boolean;
  onOpen: () => void;
  onAction: (threadId: string, patch: { status?: "open" | "closed"; read?: boolean; handler?: "cleo" | "human" }, ok: string) => Promise<void>;
}) {
  const unread = chat.unread > 0;
  const state = supportStateLine(chat);
  return (
    <SwipeableRow
      actions={[
        {
          key: "unread",
          label: unread ? "Read" : "Unread",
          color: "primary",
          icon: unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />,
          onSelect: () => onAction(chat.threadId, { read: unread }, unread ? "Marked read" : "Marked unread"),
        },
        chat.done
          ? {
              key: "reopen",
              label: "Inbox",
              color: "primary" as const,
              icon: <Archive className="h-4 w-4" />,
              onSelect: () => onAction(chat.threadId, { status: "open" }, "Back in your Inbox"),
            }
          : {
              key: "done",
              label: "Done",
              color: "primary" as const,
              icon: <Check className="h-4 w-4" />,
              onSelect: () => onAction(chat.threadId, { status: "closed" }, "Resolved. If they write again, Cleo answers first."),
            },
      ]}
    >
      <ChatListRow
        data-support-row={chat.threadId}
        onClick={onOpen}
        selected={selected}
        dim={chat.done}
        unread={unread}
        unreadLabel={`${chat.unread} new message${chat.unread === 1 ? "" : "s"}`}
        at={chat.at}
        avatar={<UserAvatar src={chat.avatar} name={chat.name} size={CHAT_ROW_AVATAR} expandable={false} />}
        name={chat.name}
        preview={chat.preview || "New message"}
        extra={<span className="mt-0.5 block truncate text-[13px] leading-[18px] text-muted-foreground" data-support-line>{chat.line} · <span data-support-state>{state}</span></span>}
        label={`${chat.name}, Support chat${unread ? ", new message" : ""}`}
      />
    </SwipeableRow>
  );
}

/**
 * Everything that isn't a chat, out of the way under one ⋯ beside the search:
 * a new group, a mass message, automations, app alerts and the guide.
 */
function InboxMoreMenu({ appAlerts, onNewGroup, onMass, onGuide }: { appAlerts: number; onNewGroup: () => void; onMass: () => void; onGuide: () => void }) {
  const navigate = useNavigate();
  // after the menu has closed, so a dialog takes focus cleanly
  const later = (fn: () => void) => () => window.setTimeout(fn, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="relative h-10 w-10 shrink-0" aria-label={appAlerts ? `More, ${appAlerts} app alerts` : "More"} data-inbox-more>
          <MoreHorizontal className="h-5 w-5" />
          {appAlerts > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem className="min-h-10" onSelect={later(onNewGroup)}>
          <UsersIcon className="mr-2 h-4 w-4" /> New group chat
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" onSelect={later(onMass)}>
          <Megaphone className="mr-2 h-4 w-4" /> Mass message
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" onSelect={() => navigate({ to: "/admin/automations" })}>
          <Zap className="mr-2 h-4 w-4" /> Automations
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" onSelect={() => navigate({ to: "/admin/communication", search: { tab: "support" } as any })} data-inbox-alerts>
          <AlertTriangle className="mr-2 h-4 w-4" /> App alerts
          {appAlerts > 0 && <span className="ml-auto rounded-full bg-destructive px-1.5 text-[11px] font-bold leading-5 text-destructive-foreground tabular-nums">{appAlerts > 99 ? "99+" : appAlerts}</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-10" onSelect={later(onGuide)}>
          <HelpCircle className="mr-2 h-4 w-4" /> How Messages works
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Filter menu's groups, in the order a coach works them. */
const FILTER_GROUPS: { label: string; filters: Filter[] }[] = [
  { label: "Conversations", filters: ["Reply", "Important", "Support"] },
  { label: "Forms", filters: ["Weekly", "Nutrition", "To Review", "Overdue"] },
  { label: "Training", filters: ["Pain", "Media", "Sessions", "Program"] },
  { label: "", filters: ["Archived"] },
];

/**
 * The coach's narrower views in one chip after the four filters: Needs reply,
 * Important, check-ins, Nutrition Updates, forms, pain, photos & videos,
 * session requests, program data and Archived, each with how many chats are
 * in it. On one, the chip says which, and the menu's first line clears it.
 */
function FilterMenu({ filter, counts, onPick }: { filter: Filter; counts: Partial<Record<Filter, number>>; onPick: (f: Filter) => void }) {
  const on = filter !== "Inbox";
  const waiting = FILTERS.some((f) => f !== "Inbox" && !!FILTER_BADGE[f] && (counts[f] ?? 0) > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          data-inbox-filter-menu={on ? filter : "none"}
          aria-label={on ? `Filter: ${FILTER_LABEL[filter] ?? filter}` : waiting ? "Filter, something's waiting" : "Filter"}
          className={cn("relative h-10 w-10 shrink-0", on && "bg-secondary")}
        >
          <SlidersHorizontal className="h-5 w-5" />
          {waiting && !on && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full", UNREAD_DOT)} aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        {on && (
          <>
            <DropdownMenuItem className="min-h-10 font-semibold" onSelect={() => onPick("Inbox")}>
              <X className="mr-2 h-4 w-4" /> Clear filter
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {FILTER_GROUPS.map((g, gi) => (
          <div key={g.label || gi}>
            {gi > 0 && <DropdownMenuSeparator />}
            {g.label && <DropdownMenuLabel className="text-[12px] font-semibold text-muted-foreground">{g.label}</DropdownMenuLabel>}
            {g.filters.map((f) => {
              const n = counts[f] ?? 0;
              return (
                <DropdownMenuItem
                  key={f}
                  className={cn("min-h-10", filter === f && "bg-secondary")}
                  onSelect={() => onPick(f)}
                  data-inbox-filter={f}
                >
                  <span className="flex-1">{FILTER_LABEL[f] ?? f}</span>
                  {n > 0 && (
                    <span
                      data-filter-badge={FILTER_BADGE[f] ?? "count"}
                      className={cn(
                        "ml-2 inline-block h-5 min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold leading-5 tabular-nums",
                        FILTER_BADGE[f] ? BADGE_STYLE[FILTER_BADGE[f]!] : "bg-foreground/10 text-foreground",
                      )}
                    >
                      {badgeNumber(n)}
                    </span>
                  )}
                  {filter === f && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
