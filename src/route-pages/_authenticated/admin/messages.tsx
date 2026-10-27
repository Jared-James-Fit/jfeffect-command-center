import { Link, redirect, useNavigate } from "@tanstack/react-router";
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
import {
  type ConversationState, type Message,
  setConversationStatus, setConversationPriority, PRIORITIES,
  markUnread, markRead, setConversationWorkflow, type WorkflowStatus,
} from "@/lib/messages";
import { AlertTriangle, CalendarClock, Clock, Hourglass, Image as ImageIcon, ClipboardCheck, Search, ChevronLeft, MoreHorizontal, ExternalLink, Phone, MessageSquare, MailOpen, Mail, Trash2, Archive, Eye, NotebookPen } from "lucide-react";
import { ClientNotesSheet } from "@/components/messages/client-notes-log";
import { SwipeableRow } from "@/components/ui/swipeable-row";
import { toast } from "sonner";
import { SendSmsDialog } from "@/components/send-sms-dialog";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useChatPresence } from "@/hooks/use-chat-presence";
import { LiveAvatar, LiveMark } from "@/components/live-indicator";
import { GroupChatsPane } from "@/components/group-chats-pane";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { MassMessageDialog } from "@/components/mass-message-dialog";
import { Megaphone, Users as UsersIcon } from "lucide-react";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { deriveInboxWorkflow, previewPrefix, WORKFLOW_LABEL, type InboxWorkflowState } from "@/lib/inbox-workflow";
import { formatReadReceipt } from "@/lib/read-receipt";
import { applyMessageChange, INBOX_MESSAGE_COLUMNS } from "@/lib/inbox-cache";
import { waitingState, type WaitingState } from "@/lib/inbox-waiting";
import { deriveRequests, latestToReview, oldestPending, requestChip } from "@/lib/inbox-requests";
import { Check, ChevronRight, MessageCircle, Mic, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { openSummer } from "@/components/summer/summer-assistant";
import { useResyncOnResume, onRealtimeRejoin } from "@/hooks/use-resync-on-resume";
import { listenChannel } from "@/lib/realtime-channel";
import { latestOf, newestFirst } from "@/lib/recency";
import {
  formTitles, matchesSignal, mediaWaitingByClient, painWaitingByClient, reviewItemsByClient, signalTags, splitRequests, waitingCount,
  type ClientSignals, type SignalFilter, type SignalTag,
} from "@/lib/inbox-brief";
import { ClientBriefSheet } from "@/components/messages/client-brief-sheet";
import { messagePreviewText } from "@/lib/message-preview";

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
      className={cn("inline-flex h-5 min-w-0 shrink items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-black uppercase tracking-wide", WORKFLOW_STYLE[state], className)}
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
        {Icon && <Icon className="mr-1 inline h-3 w-3 -translate-y-px" aria-hidden />}
        {first.label}
      </span>
      {more.map((t) => <span key={t.key} data-tag={t.key} className="text-muted-foreground"> · {t.label}</span>)}
      {rest.length > 2 && <span className="text-muted-foreground"> · +{rest.length - 2}</span>}
    </span>
  );
}

// Most pressing first, the same order as the tags on a row.
const FILTERS = [
  "Inbox", "Needs Response", "Pain", "Overdue", "To Review", "Media", "Sessions",
  "Unread", "Follow Up", "Priority", "Waiting on Client", "Done", "Archived",
] as const;
type Filter = typeof FILTERS[number];
const FILTER_LABEL: Partial<Record<Filter, string>> = {
  "Needs Response": "Needs reply",
  "To Review": "Forms to review",
  Overdue: "Overdue forms",
  Media: "Photos & videos",
  Pain: "Pain flagged",
  Sessions: "Session requests",
  "Follow Up": "Follow up",
  "Waiting on Client": "Waiting on client",
};
/** Shown only while something's in them (or picked): the row of filters stays short. */
const ONLY_WHEN_ANY = new Set<Filter>(["To Review", "Overdue", "Media", "Pain", "Sessions", "Priority"]);

/**
 * Filters that are work for me carry a count badge in the colour of their tag
 * on a row (unread in iMessage blue); the rest (Inbox, Waiting on client, Done,
 * Archived) don't, so the numbers only ever mean "this is waiting on you".
 */
const FILTER_BADGE: Partial<Record<Filter, "urgent" | "warn" | "info" | "unread">> = {
  "Needs Response": "urgent", Pain: "urgent",
  Overdue: "warn", "Follow Up": "warn", Priority: "warn",
  "To Review": "info", Media: "info", Sessions: "info",
  Unread: "unread",
};
const BADGE_STYLE = {
  urgent: "bg-red-500 text-white",
  warn: "bg-amber-500/25 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  unread: "bg-[#007AFF] text-white",
} as const;
const COUNTED = FILTERS.filter((f) => FILTER_BADGE[f] || ONLY_WHEN_ANY.has(f));
const badgeNumber = (n: number) => (n > 99 ? "99+" : String(n));

type FilterRow = {
  state?: { status?: string | null; priority?: string | null } | null;
  workflow: { state: string };
  waiting?: string | null;
  signals: ClientSignals;
  unread: number;
  last?: unknown;
  liftReview?: unknown;
};

/** Which chats a filter shows. The list and its count badge both use it, so they always agree. */
function inFilter(it: FilterRow, filter: Filter): boolean {
  const status = it.state?.status ?? "open";
  const priority = it.state?.priority ?? "Normal";
  switch (filter) {
    case "Needs Response": return it.workflow.state === "needs_response" && status !== "archived";
    // Only chats where I'm actually waiting on an answer; closers like "Perf thanks!" aren't.
    case "Waiting on Client": return it.workflow.state === "waiting_on_client" && it.waiting !== "fyi" && status !== "archived";
    case "Follow Up": return it.workflow.state === "waiting_on_client" && it.waiting === "overdue" && status !== "archived";
    case "To Review": case "Overdue": case "Media": case "Pain": case "Sessions":
      return status !== "archived" && matchesSignal(it.signals, filter as SignalFilter);
    case "Unread": return it.unread > 0 && status !== "archived";
    case "Priority": return (priority === "High Priority" || priority === "Important") && status !== "archived";
    case "Done": return it.workflow.state === "done";
    case "Archived": return status === "archived";
    default: return status !== "archived" && (it.workflow.state !== "done" || !!it.last || !!it.liftReview);
  }
}

export function MessagesInbox({
  initialClient,
  embedded = false,
  view,
}: { initialClient?: string; embedded?: boolean; view?: "chats" | "groups" } = {}) {
  const selectedFromUrl = initialClient;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clientPov = useClientImpersonation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("Inbox");
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl ?? null);
  const [smsOpen, setSmsOpen] = useState(false);
  // the selected client's workout notes log (pain, review and exercise notes)
  const [notesOpen, setNotesOpen] = useState(false);
  const [ownTab, setTab] = useState<"chats" | "groups">("chats");
  // The Communication page drives 1:1 vs Groups from its own top tabs.
  const tab = view ?? ownTab;
  const [massOpen, setMassOpen] = useState(false);
  const { role } = useAuth();

  useEffect(() => { if (selectedFromUrl) setSelectedId(selectedFromUrl); }, [selectedFromUrl]);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, user_id, full_name, first_name, last_name, email, phone, call_access_enabled, sms_opt_out, profile_picture_url, archived, status, last_active_at")
        .order("full_name");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });

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
      const [native, checkins] = await Promise.all([
        (supabase.from("nf_submissions") as any).select("id, client_id, form_id, submitted_at, reviewed_at").not("submitted_at", "is", null).is("reviewed_at", null).limit(1000),
        (supabase.from("messenger_checkins") as any).select("id, client_id, task_type, submitted_at, status").eq("status", "completed").is("reviewed_at", null).not("submitted_at", "is", null).limit(1000),
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
  const INBOX_KEYS = ["last-messages", "conversation-states", "staff-inbox-state", "admin-nav-badges", "message-lift-review-inbox", "message-form-checkin-inbox"];
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

  // When I (staff) last replied in each chat: a chat check-in has no reviewed
  // flag, so a reply after it is what counts as reviewing it.
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
      })),
      lastStaffReplyByClient,
    ),
    [pendingSubmissions, lastStaffReplyByClient],
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

  // Blue dot = new inbound client activity *I* (this staff member) haven't viewed.
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
  const sessionRequestsByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of sessionRequestRows) m.set(r.client_id, (m.get(r.client_id) ?? 0) + 1);
    return m;
  }, [sessionRequestRows]);

  const allRows = useMemo(() => clients.map((c) => {
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
    };
    const tags = signalTags(signals, {
      followUp: workflow.state === "waiting_on_client" && status.waiting === "overdue",
      priority: state?.priority,
    });
    return { client: c, state, last, unread, liftReview, workflow, signals, tags, ...status };
  }), [clients, stateMap, lastByClient, unreadByClient, liftReviewsByClient, inboxByClient, requestsByClient,
    reviewByClient, mediaByClient, painByClient, sessionRequestsByClient]);

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
    return items;
  }, [allRows, search, filter]);

  // Live badge counts: the very rule the list filters by, over the same rows.
  const filterCounts = useMemo(() => {
    const counts: Partial<Record<Filter, number>> = {};
    for (const it of allRows) {
      for (const f of COUNTED) if (inFilter(it, f)) counts[f] = (counts[f] ?? 0) + 1;
    }
    return counts;
  }, [allRows]);

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
  const { peerLive: selectedClientLive } = useChatPresence(selectedId, "admin", tab !== "groups" && !!selected);

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
    setSelectedId(id);
    navigate({ to: "/admin/communication", search: { tab: "messages", client: id } as any, replace: true });
  };
  const clearSelection = () => {
    setSelectedId(null);
    navigate({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });
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
          : "fixed inset-x-0 z-30 md:static md:inset-auto md:z-auto md:h-full md:flex-1",
      )}
      style={
        embedded
          ? undefined
          : {
              // Track the iOS Visual Viewport so the chat shrinks above the
              // keyboard instead of leaving a dead gap. See useKeyboardOpen().
              top: "calc(var(--vv-top, 0px) + var(--shell-topbar-h, 0px))",
              height:
                "calc(var(--vv-h, 100dvh) - var(--shell-topbar-h, 0px) - var(--bottom-nav-clearance, 0px))",
            }
      }
    >
      {tab === "groups" ? (
        <div className="flex min-h-0 flex-1 w-full flex-col">
          {!view && <TabsHeader tab={tab} setTab={setTab} onMass={() => setMassOpen(true)} />}
          <div className="min-h-0 flex-1">
            <GroupChatErrorBoundary key="groups-pane">
              <GroupChatsPane asAdmin />
            </GroupChatErrorBoundary>
          </div>
          <MassMessageDialog open={massOpen} onOpenChange={setMassOpen} />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 w-full flex-col">
        {!view && <TabsHeader tab={tab} setTab={setTab} onMass={() => setMassOpen(true)} />}
        <div className="flex min-h-0 flex-1">
      {/* Inbox sidebar */}
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border bg-card md:w-[340px] md:shrink-0",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        <header
          className="border-b border-border px-3 py-2 md:px-4 md:py-3"
          style={
            embedded
              ? undefined
              : { paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }
          }
        >
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-base font-black tracking-tight md:text-lg">Messages</h1>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {conversations.length}
            </span>
            {view && (
              <Button size="sm" variant="ghost" onClick={() => setMassOpen(true)} className="ml-auto h-8 px-2 text-xs" aria-label="Mass message">
                <Megaphone className="h-3.5 w-3.5 md:mr-1" />
                <span className="hidden md:inline">Mass message</span>
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9 text-base sm:text-sm"
              placeholder="Search client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.filter((f) => !ONLY_WHEN_ANY.has(f) || (filterCounts[f] ?? 0) > 0 || filter === f).map((f) => {
              const n = FILTER_BADGE[f] ? filterCounts[f] ?? 0 : 0;
              const on = filter === f;
              const label = FILTER_LABEL[f] ?? f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  data-inbox-filter={f}
                  aria-label={n ? `${label}, ${n}` : label}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full py-1 text-[11px] font-semibold transition",
                    n ? "pl-3 pr-1" : "px-3",
                    on
                      ? "bg-primary text-primary-foreground"
                      : n
                        ? "bg-secondary/60 text-foreground hover:bg-secondary"
                        : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {label}
                  {n > 0 && (
                    <span
                      data-filter-badge={FILTER_BADGE[f]}
                      className={cn(
                        "ml-1.5 inline-block h-[18px] min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums",
                        on ? "bg-primary-foreground/25 text-primary-foreground" : BADGE_STYLE[FILTER_BADGE[f]!],
                      )}
                    >
                      {badgeNumber(n)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {filter === "Overdue" && (
            <Link
              to="/admin/forms"
              search={{ tab: "requests" } as any}
              className="mt-1 flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-secondary"
            >
              <span>Manage outstanding requests: open, re-send or delete</span>
              <span aria-hidden>›</span>
            </Link>
          )}
        </header>
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            embedded
              ? "pb-[max(env(safe-area-inset-bottom),0.75rem)]"
              : "pb-[calc(var(--bottom-nav-clearance,0px)+max(env(safe-area-inset-bottom),1.5rem))]",
          )}
        >
          {role === "admin" && !search && (
            // Cleo's way in on admin: pinned at the top of the inbox (there is
            // no floating button). Not a client thread: nothing is ever sent.
            <div className="flex items-stretch border-b border-border/60 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-pink-500/5">
              <button type="button" onClick={() => openSummer()} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 text-white">
                  <Sparkles className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">Cleo</span>
                  <span className="block truncate text-xs text-muted-foreground">Ask anything, or tap the mic and talk</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => openSummer({ dictate: true })}
                className="flex w-14 shrink-0 items-center justify-center transition hover:bg-secondary/40"
                aria-label="Talk to Cleo"
                title="Talk to Cleo"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 text-white shadow-sm">
                  <Mic className="h-4 w-4" />
                </span>
              </button>
            </div>
          )}
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No conversations.</div>
          ) : conversations.map(({ client, state, last, unread, liftReview, workflow, signals, tags }) => (
            <SwipeableRow
              key={client.id}
              className="border-b border-border/60"
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
            <div
              role="button"
              tabIndex={0}
              onPointerDown={() => prefetchThread(client.id)}
              onClick={() => selectClient(client.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectClient(client.id); } }}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition hover:bg-secondary/40",
                selectedId === client.id && "bg-secondary/60",
              )}
            >
              {/* Their photo opens the Brief: everything waiting + an AI read. */}
              <button
                type="button"
                data-open-brief
                aria-label={`Brief: ${client.full_name ?? "client"}${waitingCount(signals) ? `, ${waitingCount(signals)} waiting` : ""}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setBriefFor(client.id); }}
                className="relative shrink-0 rounded-full transition active:scale-95"
              >
                {/* the same live look as the client's inbox: the turning ring and LIVE tag */}
                <LiveAvatar
                  live={isClientActive((client as any).last_active_at) || (client.id === selectedId && selectedClientLive)}
                  size={44}
                >
                  <UserAvatar
                    src={client.profile_picture_url}
                    name={client.full_name}
                    size={44}
                    ring
                    expandable={false}
                  />
                </LiveAvatar>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", unread > 0 ? "font-bold" : "font-semibold")}>
                    {client.full_name}
                  </span>
                  {(last || liftReview) && (
                    <span className={cn("shrink-0 text-[10px]", unread > 0 ? "font-semibold text-[#007AFF]" : "text-muted-foreground")}>
                      {formatDistanceToNow(
                        parseISO(
                          (liftReview?.latestAt ?? "") > (last?.created_at ?? "")
                            ? liftReview!.latestAt
                            : last!.created_at,
                        ),
                        { addSuffix: false },
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn("truncate flex-1 text-xs", unread > 0 ? "font-semibold text-foreground" : liftReview ? "text-foreground" : "text-muted-foreground")}>
                    {liftReview && liftReview.latestAt >= (last?.created_at ?? "")
                      ? `Lift review · ${liftReview.count} waiting`
                      : last
                        ? previewPrefix(last as any) + (messagePreviewText(last.body, last.attachments) || "(attachment)")
                        : "No messages yet"}
                  </span>
                  {unread > 0 && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#007AFF]"
                      aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}
                      title={`${unread} unread`}
                    />
                  )}
                </div>
                {tags.length > 0 && (
                  // One quiet line of what's waiting. Tapping it (or their photo) opens the Brief.
                  <div className="mt-0.5 flex min-h-5 items-center gap-1.5" data-row-tags>
                    <button
                      type="button"
                      data-open-brief-line
                      aria-label={`Brief: ${client.full_name ?? "client"}. ${tags.map((t) => t.label).join(", ")}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setBriefFor(client.id); }}
                      className="-mx-1 inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-left text-[11px] leading-4 transition hover:bg-secondary/60 active:bg-secondary"
                    >
                      <SignalLine tags={tags} />
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
                    </button>
                    {workflow.state === "needs_response" && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Mark ${client.full_name ?? "conversation"} done`}
                        title="No reply needed: mark done"
                        onClick={(e) => { e.stopPropagation(); void changeWorkflow(client.id, "done", { undoFrom: "needs_response" }); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void changeWorkflow(client.id, "done", { undoFrom: "needs_response" }); } }}
                        className="ml-auto hidden h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-600 [@media(hover:hover)]:grid"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            </SwipeableRow>
          ))}
        </div>
      </aside>

      {/* Conversation pane */}
      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          selected ? "flex" : "hidden md:flex",
        )}
      >
        {selected ? (
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
                    ring
                  />
                </LiveAvatar>
              </ClientNameLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-bold">
                  {/* Their name opens the Brief: everything waiting + an AI read */}
                  <button
                    type="button"
                    data-open-brief
                    onClick={() => setBriefFor(selected.id)}
                    className="inline-flex min-w-0 items-center gap-1 rounded-md hover:opacity-80"
                    aria-label={`Brief: ${selected.full_name ?? "client"}`}
                  >
                    <span className="truncate">{selected.full_name}</span>
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                  </button>
                  {(selectedClientLive || isClientActive((selected as any).last_active_at)) && (
                    <LiveMark className="shrink-0 text-[11px] font-semibold" size={6}>
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
                  className="h-9 shrink-0 gap-1 rounded-full border-emerald-500/40 px-3 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                  onClick={() => void changeWorkflow(selected.id, "done", { undoFrom: "needs_response" })}
                  title="No reply needed — clear it from Needs Response"
                >
                  <Check className="h-4 w-4" /> <span className="hidden sm:inline">Mark</span> Done
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/20"
                title="View client POV"
                aria-label={`View ${selected.full_name ?? "client"} POV`}
                onClick={enterSelectedClientPov}
              >
                <Eye className="h-4 w-4" />
              </Button>
              {(selected as any).call_access_enabled && (selected as any).phone ? (
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                  title={`Call ${selected.full_name ?? "client"} (${(selected as any).phone})`}
                >
                  <a href={`tel:${String((selected as any).phone).replace(/[^+\d]/g, "")}`} aria-label="Call client">
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
              {(selected as any).phone && !(selected as any).sms_opt_out ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  title={`Send SMS to ${selected.full_name ?? "client"}`}
                  onClick={() => setSmsOpen(true)}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              ) : null}
              {/* everything they've told you in workouts: pain, review notes, exercise notes */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9 shrink-0"
                title={`${selected.full_name ?? "Client"}'s workout notes`}
                aria-label="Workout notes"
                onClick={() => setNotesOpen(true)}
                data-thread-notes
              >
                <NotebookPen className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-7 shrink-0 sm:h-9 sm:w-9">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">Conversation</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <ClientNameLink clientId={selected.id}>
                      <ExternalLink className="mr-2 h-4 w-4" /> Open client profile
                    </ClientNameLink>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleMarkUnread}>
                    <Mail className="mr-2 h-4 w-4" /> Mark as unread
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleMarkRead}>
                    <MailOpen className="mr-2 h-4 w-4" /> Mark as read
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Response status</DropdownMenuLabel>
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
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Priority</DropdownMenuLabel>
                  {PRIORITIES.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => updatePriority(p)}>
                      {p}{selectedState?.priority === p ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            {/* What the client trained last; tap for any past or upcoming workout. */}
            <ClientWorkoutPeek clientId={selected.id} clientName={selected.full_name} />
            <MessageThread
              clientId={selected.id}
              role="admin"
              conversationState={selectedState ?? null}
              hideControls
              fullBleed
              peerName={selected.full_name}
              peerAvatarPath={selected.profile_picture_url}
            />
            <ClientNotesSheet clientId={notesOpen ? selected.id : null} name={selected.full_name ?? null} onClose={() => setNotesOpen(false)} />
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
        <MassMessageDialog open={massOpen} onOpenChange={setMassOpen} />
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
      </div>
      )}
    </div>
  );
}

function TabsHeader({
  tab, setTab, onMass,
}: { tab: "chats" | "groups"; setTab: (t: "chats" | "groups") => void; onMass: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-1.5 md:px-4 md:py-2">
      <div className="inline-flex rounded-full bg-secondary/60 p-0.5 text-xs">
        <button
          onClick={() => setTab("chats")}
          className={cn(
            "rounded-full px-3 py-1 font-semibold transition",
            tab === "chats" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          1:1 Chats
        </button>
        <button
          onClick={() => setTab("groups")}
          className={cn(
            "rounded-full px-3 py-1 font-semibold transition",
            tab === "groups" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          <UsersIcon className="mr-1 inline h-3 w-3" /> Groups
        </button>
      </div>
      <div className="flex-1" />
      <Button size="sm" variant="outline" onClick={onMass} className="h-8 shrink-0 px-2 md:px-3" aria-label="Mass message">
        <Megaphone className="h-3.5 w-3.5 md:mr-1" />
        <span className="hidden md:inline">Mass Message</span>
      </Button>
    </div>
  );
}