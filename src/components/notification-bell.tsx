import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { markRead } from "@/lib/messages";
import { markClientViewed, markAdminViewed } from "@/lib/lift-videos";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, parseISO, isToday, isYesterday } from "date-fns";
import type { ConversationState, Message, MessageAttachment } from "@/lib/messages";
import { useServerFn } from "@tanstack/react-start";
import { listUpcomingForBell, listMyPortalAppointments } from "@/lib/appointments.functions";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type BellItem = {
  kind: "message" | "lift_video" | "agreement" | "exercise_note" | "group_message" | "check_in_review" | "appointment";
  clientId: string;
  groupId?: string;
  videoId?: string;
  agreementId?: string;
  noteId?: string;
  reviewId?: string;
  appointmentId?: string;
  meetLink?: string | null;
  name: string;
  title: string;
  body: string;
  created_at: string;
};

/** Build "unread group message" bell items for any user (admin/coach/client).
 *  Uses chat_group_members.last_read_at vs latest group_messages.created_at. */
async function fetchUnreadGroupItems(userId: string): Promise<BellItem[]> {
  // 1) Groups I'm a member of (with my last_read_at)
  const { data: mem } = await (supabase.from("chat_group_members") as any)
    .select("group_id, last_read_at")
    .eq("user_id", userId);
  const memberships = (mem ?? []) as { group_id: string; last_read_at: string | null }[];
  if (memberships.length === 0) return [];
  const groupIds = memberships.map((m) => m.group_id);

  // 2) Group metadata (name)
  const { data: groups } = await (supabase.from("chat_groups") as any)
    .select("id, name, archived")
    .in("id", groupIds);
  const gMap = new Map<string, { name: string; archived: boolean }>(
    (groups ?? []).map((g: any) => [g.id, { name: g.name, archived: !!g.archived }]),
  );

  // 3) Recent messages across those groups
  const { data: msgs } = await (supabase.from("group_messages") as any)
    .select("id, group_id, sender_id, sender_role, body, attachments, created_at, deleted_at")
    .in("group_id", groupIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const lastReadByGroup = new Map(memberships.map((m) => [m.group_id, m.last_read_at]));
  const seen = new Set<string>();
  const items: BellItem[] = [];
  for (const m of (msgs ?? []) as any[]) {
    if (seen.has(m.group_id)) continue; // newest per group only
    if (m.sender_id === userId) { seen.add(m.group_id); continue; }
    const meta = gMap.get(m.group_id);
    if (!meta || meta.archived) { seen.add(m.group_id); continue; }
    const lastRead = lastReadByGroup.get(m.group_id);
    if (lastRead && new Date(m.created_at).getTime() <= new Date(lastRead).getTime()) {
      seen.add(m.group_id);
      continue;
    }
    seen.add(m.group_id);
    const atts = (m.attachments ?? []) as any[];
    const hasVoice = atts.some((a) => a?.type === "audio");
    const hasMedia = atts.some((a) => a?.type === "image" || a?.type === "video");
    const summary = hasVoice ? "Voice message"
      : hasMedia ? "Photo / video"
      : atts.length ? "Attachment"
      : (m.body || "");
    items.push({
      kind: "group_message",
      clientId: "",
      groupId: m.group_id,
      name: meta.name,
      title: `New in ${meta.name}`,
      body: summary,
      created_at: m.created_at,
    });
  }
  return items;
}

export function useNotificationFeed() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const adminUpcoming = useServerFn(listUpcomingForBell);
  const portalAppts = useServerFn(listMyPortalAppointments);

  // Realtime invalidation
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      }, 300);
    };
    const ch = supabase
      .channel("bell-messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "agreements" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_exercise_notes" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_check_in_reviews" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, invalidate)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [user, qc]);

  const query = useQuery({
    queryKey: ["unread-counts", role, user?.id],
    enabled: !!user && !!role,
    queryFn: async () => {
      if (role === "admin") {
        const [{ data: msgs }, { data: states }, { data: vids }, { data: agreements }, { data: exNotes }] = await Promise.all([
          (supabase.from("messages") as any).select("client_id, body, attachments, created_at, sender_role, is_internal_note").eq("sender_role", "client").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(200),
          (supabase.from("conversation_state") as any).select("client_id, admin_last_read_at"),
          (supabase.from("lift_videos") as any)
            .select("id, client_id, exercise, client_notes, created_at, admin_last_viewed_at, status")
            .order("created_at", { ascending: false })
            .limit(50),
          (supabase.from("agreements") as any)
            .select("id, client_id, agreement_type, template_name, status, signer_mismatch, verification_status, webhook_last_event, updated_at")
            .or("signer_mismatch.eq.true,status.in.(Error,Manual Action Needed,Needs Resend,Needs Manual Verification,Expired)")
            .order("updated_at", { ascending: false })
            .limit(20),
          (supabase.from("pl_exercise_notes") as any)
            .select("id, client_id, day_id, exercise_name, content, status, created_at, updated_at, coach_seen_at")
            .is("coach_seen_at", null)
            .order("updated_at", { ascending: false })
            .limit(30),
        ]);
        const stateMap = new Map<string, ConversationState>((states ?? []).map((s: any) => [s.client_id, s]));
        const { data: clients } = await supabase.from("clients").select("id, full_name");
        const cMap = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
        const items: BellItem[] = [];
        const seen = new Set<string>();
        for (const m of (msgs ?? []) as Message[]) {
          if (seen.has(m.client_id)) continue;
          const lastRead = stateMap.get(m.client_id)?.admin_last_read_at;
          if (!lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime()) {
            seen.add(m.client_id);
            const name = cMap.get(m.client_id) ?? "Client";
            const atts = m.attachments ?? [];
            const hasVoice = atts.some((a) => a.type === "audio");
            const hasMedia = atts.some((a) => a.type === "image" || a.type === "video");
            const title = hasVoice ? `${name} sent a voice message`
              : hasMedia ? `${name} sent a photo/video`
              : atts.length ? `${name} sent an attachment`
              : `New message from ${name}`;
            items.push({ kind: "message", clientId: m.client_id, name, title, body: m.body, created_at: m.created_at });
          }
        }
        for (const v of (vids ?? []) as any[]) {
          if (v.admin_last_viewed_at) continue;
          const name = cMap.get(v.client_id) ?? "Client";
          items.push({
            kind: "lift_video",
            clientId: v.client_id,
            videoId: v.id,
            name,
            title: `New lift video from ${name}`,
            body: v.client_notes || v.exercise || "Sent a lift video for review.",
            created_at: v.created_at,
          });
        }
        for (const a of (agreements ?? []) as any[]) {
          const name = cMap.get(a.client_id) ?? "Client";
          const label = a.signer_mismatch ? "Signer name mismatch"
            : a.status === "Error" ? "SignNow error"
            : a.status === "Manual Action Needed" ? "Agreement needs manual action"
            : a.status === "Needs Resend" ? "Agreement needs resend"
            : a.status === "Needs Manual Verification" ? "Agreement needs verification"
            : a.status === "Expired" ? "Agreement expired"
            : `Agreement: ${a.status}`;
          items.push({
            kind: "agreement",
            clientId: a.client_id,
            agreementId: a.id,
            name,
            title: `${label} — ${name}`,
            body: a.agreement_type ?? a.template_name ?? "Agreement",
            created_at: a.updated_at,
          });
        }
        for (const n of (exNotes ?? []) as any[]) {
          const name = cMap.get(n.client_id) ?? "Client";
          const verb = n.status === "edited" ? "edited a note on" : "added a note on";
          items.push({
            kind: "exercise_note",
            clientId: n.client_id,
            noteId: n.id,
            name,
            title: `${name} ${verb} ${n.exercise_name}`,
            body: n.content,
            created_at: n.updated_at,
          });
        }
        items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        // Group chat unreads (admin sees all groups they can read)
        const groupItems = await fetchUnreadGroupItems(user!.id);
        for (const gi of groupItems) items.push(gi);
        // Upcoming appointments (next 24h)
        try {
          const upcoming: any[] = await adminUpcoming();
          for (const a of upcoming) {
            const mins = Math.round((new Date(a.starts_at).getTime() - Date.now()) / 60000);
            if (mins < -5) continue;
            const when = mins <= 60
              ? (mins <= 0 ? "now" : `in ${mins}m`)
              : new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            const who = a.client?.full_name || "external attendee";
            items.push({
              kind: "appointment",
              clientId: "",
              appointmentId: a.id,
              meetLink: a.meet_link,
              name: who,
              title: `Upcoming: ${a.title} (${when})`,
              body: `With ${who}`,
              created_at: a.starts_at,
            });
          }
        } catch { /* ignore */ }
        items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        return { count: items.length, items };
      } else {
        const { data: client } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
        if (!client) return { count: 0, items: [] };
        const [{ data: msgs }, { data: state }, { data: vids }, { data: vcomments }] = await Promise.all([
          (supabase.from("messages") as any).select("body, attachments, created_at, sender_role").eq("client_id", client.id).eq("sender_role", "admin").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(20),
          (supabase.from("conversation_state") as any).select("client_last_read_at").eq("client_id", client.id).maybeSingle(),
          (supabase.from("lift_videos") as any)
            .select("id, exercise, watched_at, liked_at, reviewed_at, status, client_last_viewed_at, updated_at")
            .eq("client_id", client.id)
            .order("updated_at", { ascending: false })
            .limit(30),
          (supabase.from("lift_video_comments") as any)
            .select("video_id, body, created_at, author_role, is_internal_note")
            .eq("client_id", client.id)
            .eq("author_role", "admin")
            .eq("is_internal_note", false)
            .order("created_at", { ascending: false })
            .limit(30),
        ]);
        const { data: reviews } = await (supabase.from("manual_check_in_reviews") as any)
          .select("id, title, message, created_at, read_at, dismissed_at, notify_client")
          .eq("client_id", client.id)
          .eq("notify_client", true)
          .is("read_at", null)
          .is("dismissed_at", null)
          .order("created_at", { ascending: false })
          .limit(10);
        const lastRead = state?.client_last_read_at;
        const unread = (msgs ?? []).filter((m: any) => !lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime());
        const items: BellItem[] = unread.map((m: any) => {
          const atts = (m.attachments ?? []) as MessageAttachment[];
          const hasVoice = atts.some((a) => a.type === "audio");
          const hasMedia = atts.some((a) => a.type === "image" || a.type === "video");
          const title = hasVoice ? "Coach Jared sent a voice message"
            : hasMedia ? "Coach Jared sent a photo/video"
            : atts.length ? "Coach Jared sent an attachment"
            : "New message from Coach Jared";
          return { kind: "message", clientId: client.id, name: "Coach Jared", title, body: m.body, created_at: m.created_at };
        });
        const vidMap = new Map<string, any>();
        for (const v of (vids ?? []) as any[]) {
          vidMap.set(v.id, v);
          const seen = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
          const events: { at: string; verb: string }[] = [];
          if (v.watched_at && new Date(v.watched_at).getTime() > seen) events.push({ at: v.watched_at, verb: "watched" });
          if (v.liked_at && new Date(v.liked_at).getTime() > seen) events.push({ at: v.liked_at, verb: "liked" });
          if (v.reviewed_at && new Date(v.reviewed_at).getTime() > seen) events.push({ at: v.reviewed_at, verb: "marked reviewed" });
          if (v.status === "Needs Follow-Up" && (!v.client_last_viewed_at || new Date(v.updated_at).getTime() > seen)) {
            events.push({ at: v.updated_at, verb: "requested follow-up on" });
          }
          for (const e of events) {
            items.push({
              kind: "lift_video", clientId: client.id, videoId: v.id, name: "Coach Jared",
              title: `Coach Jared ${e.verb} your lift video`,
              body: v.exercise || "Lift video",
              created_at: e.at,
            });
          }
        }
        for (const c of (vcomments ?? []) as any[]) {
          const v = vidMap.get(c.video_id);
          const seen = v?.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
          if (new Date(c.created_at).getTime() <= seen) continue;
          items.push({
            kind: "lift_video", clientId: client.id, videoId: c.video_id, name: "Coach Jared",
            title: "Coach Jared commented on your lift video",
            body: c.body, created_at: c.created_at,
          });
        }
        for (const r of (reviews ?? []) as any[]) {
          items.push({
            kind: "check_in_review", clientId: client.id, reviewId: r.id, name: "Coach Jared",
            title: `Coach Jared sent: ${r.title || "Check-In Review"}`,
            body: r.message || "New check-in review from your coach.",
            created_at: r.created_at,
          });
        }
        items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        // Group chat unreads for this client
        const groupItems = await fetchUnreadGroupItems(user!.id);
        for (const gi of groupItems) items.push(gi);
        // Upcoming appointments for the client (next 24h)
        try {
          const { upcoming } = await portalAppts();
          for (const a of (upcoming ?? []) as any[]) {
            const mins = Math.round((new Date(a.starts_at).getTime() - Date.now()) / 60000);
            if (mins > 24 * 60 || mins < -5) continue;
            const when = mins <= 60
              ? (mins <= 0 ? "now" : `in ${mins}m`)
              : new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            items.push({
              kind: "appointment",
              clientId: client.id,
              appointmentId: a.id,
              meetLink: a.meet_link,
              name: a.host_coach?.full_name ?? "Coach",
              title: `Upcoming: ${a.title} (${when})`,
              body: `With ${a.host_coach?.full_name ?? "your coach"}`,
              created_at: a.starts_at,
            });
          }
        } catch { /* ignore */ }
        items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        return { count: items.length, items };
      }
    },
  });
  return { query, role, user, qc };
}

export function NotificationBell() {
  const { query, role, user, qc } = useNotificationFeed();
  const data = query.data;
  const count = data?.count ?? 0;
  const allItems = useMemo<BellItem[]>(() => data?.items ?? [], [data]);
  const items = useMemo<BellItem[]>(() => allItems.slice(0, 10), [allItems]);

  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const trigger = (
    <button
      type="button"
      aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
      className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <Badge className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </Badge>
      )}
    </button>
  );

  const panel = (
    <NotificationPanel
      items={items}
      role={role}
      count={count}
      onItemClick={(it) => { markItem(it, role); qc.invalidateQueries({ queryKey: ["unread-counts"] }); setOpen(false); }}
      onMarkAllRead={async () => {
        await markAllRead(allItems, role, user?.id);
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      }}
      onViewAll={() => setOpen(false)}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Notifications</SheetTitle>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function destinationFor(it: BellItem, role: string | null) {
  const isAdmin = role === "admin";
  switch (it.kind) {
    case "lift_video": return { to: isAdmin ? "/admin/lift-videos" : "/portal/lift-videos" } as const;
    case "agreement": return isAdmin
      ? { to: "/admin/clients/$id", params: { id: it.clientId }, search: { tab: "agreements" as any } }
      : { to: "/portal" } as const;
    case "exercise_note": return isAdmin
      ? { to: "/admin/clients/$id", params: { id: it.clientId }, search: { tab: "training" as any } }
      : { to: "/portal" } as const;
    case "check_in_review": return { to: "/portal" } as const;
    case "appointment": return { to: isAdmin ? "/admin/appointments" : "/portal/appointments" } as const;
    case "group_message": return { to: isAdmin ? "/admin/messages" : "/portal/messages" } as const;
    default: return isAdmin
      ? { to: "/admin/messages", search: { client: it.clientId } }
      : { to: "/portal/messages" } as const;
  }
}

function markItem(it: BellItem, role: string | null) {
  if (it.kind === "message") {
    markRead(it.clientId, role === "admin" ? "admin" : "client").catch(() => {});
  } else if (it.kind === "lift_video" && it.videoId) {
    (role === "admin" ? markAdminViewed(it.videoId) : markClientViewed(it.videoId)).catch(() => {});
  } else if (it.kind === "exercise_note" && it.noteId && role === "admin") {
    (supabase.from("pl_exercise_notes") as any).update({ coach_seen_at: new Date().toISOString() }).eq("id", it.noteId).then(() => {});
  } else if (it.kind === "group_message" && it.groupId) {
    // No user_id filter so RLS scopes to current user
    (supabase.from("chat_group_members") as any).update({ last_read_at: new Date().toISOString() }).eq("group_id", it.groupId).then(() => {});
  } else if (it.kind === "check_in_review" && it.reviewId) {
    (supabase.from("manual_check_in_reviews") as any).update({ read_at: new Date().toISOString() }).eq("id", it.reviewId).then(() => {});
  }
}

async function markAllRead(items: BellItem[], role: string | null, _userId: string | undefined) {
  const isAdmin = role === "admin";
  const messageClients = new Set<string>();
  const videoIds = new Set<string>();
  const noteIds = new Set<string>();
  const groupIds = new Set<string>();
  const reviewIds = new Set<string>();
  for (const it of items) {
    if (it.kind === "message" && it.clientId) messageClients.add(it.clientId);
    else if (it.kind === "lift_video" && it.videoId) videoIds.add(it.videoId);
    else if (it.kind === "exercise_note" && it.noteId && isAdmin) noteIds.add(it.noteId);
    else if (it.kind === "group_message" && it.groupId) groupIds.add(it.groupId);
    else if (it.kind === "check_in_review" && it.reviewId) reviewIds.add(it.reviewId);
  }
  const now = new Date().toISOString();
  const tasks: Promise<unknown>[] = [];
  for (const cid of messageClients) tasks.push(markRead(cid, isAdmin ? "admin" : "client").catch(() => {}));
  for (const vid of videoIds) tasks.push((isAdmin ? markAdminViewed(vid) : markClientViewed(vid)).catch(() => {}));
  if (noteIds.size > 0) tasks.push((supabase.from("pl_exercise_notes") as any).update({ coach_seen_at: now }).in("id", Array.from(noteIds)));
  if (groupIds.size > 0) tasks.push((supabase.from("chat_group_members") as any).update({ last_read_at: now }).in("group_id", Array.from(groupIds)));
  if (reviewIds.size > 0) tasks.push((supabase.from("manual_check_in_reviews") as any).update({ read_at: now }).in("id", Array.from(reviewIds)));
  await Promise.all(tasks);
}

function groupByDate(items: BellItem[]): Array<{ label: string; items: BellItem[] }> {
  const today: BellItem[] = [];
  const yesterday: BellItem[] = [];
  const earlier: BellItem[] = [];
  for (const it of items) {
    const d = parseISO(it.created_at);
    if (isToday(d)) today.push(it);
    else if (isYesterday(d)) yesterday.push(it);
    else earlier.push(it);
  }
  const out: Array<{ label: string; items: BellItem[] }> = [];
  if (today.length) out.push({ label: "Today", items: today });
  if (yesterday.length) out.push({ label: "Yesterday", items: yesterday });
  if (earlier.length) out.push({ label: "Earlier", items: earlier });
  return out;
}

function NotificationPanel({
  items, role, count, onItemClick, onMarkAllRead, onViewAll,
}: {
  items: BellItem[];
  role: string | null;
  count: number;
  onItemClick: (it: BellItem) => void;
  onMarkAllRead: () => Promise<void>;
  onViewAll: () => void;
}) {
  const [marking, setMarking] = useState(false);
  const groups = useMemo(() => groupByDate(items), [items]);

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{count > 99 ? "99+" : count} new</Badge>
          )}
        </div>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={marking}
            onClick={async () => {
              setMarking(true);
              try { await onMarkAllRead(); } finally { setMarking(false); }
            }}
          >
            {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary">
              <CheckCheck className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">You're all caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">New notifications will appear here.</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 bg-popover/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {g.label}
              </div>
              {g.items.map((it, i) => {
                const dest = destinationFor(it, role);
                return (
                  <Link
                    key={`${it.kind}-${it.clientId}-${it.videoId ?? it.noteId ?? it.groupId ?? it.reviewId ?? it.appointmentId ?? i}`}
                    {...(dest as any)}
                    onClick={() => onItemClick(it)}
                    className={cn(
                      "relative block border-l-2 border-primary bg-primary/5 px-3 py-2.5 transition hover:bg-primary/10",
                      "focus-visible:outline-none focus-visible:bg-primary/10",
                    )}
                  >
                    <span className="absolute right-3 top-3 inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
                    <div className="pr-5 text-xs font-semibold leading-tight">{it.title}</div>
                    {it.body && (
                      <div className="mt-0.5 line-clamp-2 pr-5 text-[11px] text-muted-foreground">{it.body}</div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(parseISO(it.created_at), { addSuffix: true })}
                    </div>
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="border-t px-3 py-2">
        <Link
          to="/notifications"
          onClick={onViewAll}
          className="block text-center text-xs font-medium text-primary hover:underline"
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}