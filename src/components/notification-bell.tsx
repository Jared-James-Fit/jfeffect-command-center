import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, CheckCheck, Loader2, MoreHorizontal, Archive, ArchiveRestore, MailOpen, Mail,
  Inbox, Filter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { markRead } from "@/lib/messages";
import { markClientViewed, markAdminViewed } from "@/lib/lift-videos";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow, parseISO, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import type { ConversationState, Message, MessageAttachment } from "@/lib/messages";
import { useServerFn } from "@tanstack/react-start";
import { listUpcomingForBell, listMyPortalAppointments } from "@/lib/appointments.functions";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export type BellKind =
  | "message" | "lift_video" | "agreement" | "exercise_note"
  | "group_message" | "check_in_review" | "appointment";

export type BellItem = {
  /** Stable per-user id: `${kind}:${sourceId}` */
  id: string;
  kind: BellKind;
  sourceId: string;
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
  /** Source-implicit OR notification_state.read_at */
  isRead: boolean;
  /** notification_state.archived_at */
  isArchived: boolean;
};

type NotifStateRow = {
  kind: string;
  source_id: string;
  read_at: string | null;
  archived_at: string | null;
};

// =============================================================================
// Source-id helpers
// =============================================================================

function sourceIdOf(kind: BellKind, raw: Partial<BellItem>): string {
  switch (kind) {
    case "message": return raw.clientId ?? "";
    case "lift_video": return raw.videoId ?? "";
    case "agreement": return raw.agreementId ?? "";
    case "exercise_note": return raw.noteId ?? "";
    case "group_message": return raw.groupId ?? "";
    case "check_in_review": return raw.reviewId ?? "";
    case "appointment": return raw.appointmentId ?? "";
  }
}

function makeId(kind: BellKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

// =============================================================================
// Group-chat unread fetcher (unchanged behavior)
// =============================================================================

async function fetchUnreadGroupItems(userId: string): Promise<Omit<BellItem, "isRead" | "isArchived">[]> {
  const { data: mem } = await (supabase.from("chat_group_members") as any)
    .select("group_id, last_read_at")
    .eq("user_id", userId);
  const memberships = (mem ?? []) as { group_id: string; last_read_at: string | null }[];
  if (memberships.length === 0) return [];
  const groupIds = memberships.map((m) => m.group_id);

  const { data: groups } = await (supabase.from("chat_groups") as any)
    .select("id, name, archived")
    .in("id", groupIds);
  const gMap = new Map<string, { name: string; archived: boolean }>(
    (groups ?? []).map((g: any) => [g.id, { name: g.name, archived: !!g.archived }]),
  );

  const { data: msgs } = await (supabase.from("group_messages") as any)
    .select("id, group_id, sender_id, sender_role, body, attachments, created_at, deleted_at")
    .in("group_id", groupIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const lastReadByGroup = new Map(memberships.map((m) => [m.group_id, m.last_read_at]));
  const seen = new Set<string>();
  const items: Omit<BellItem, "isRead" | "isArchived">[] = [];
  for (const m of (msgs ?? []) as any[]) {
    if (seen.has(m.group_id)) continue;
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
      id: makeId("group_message", m.group_id),
      kind: "group_message",
      sourceId: m.group_id,
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

// =============================================================================
// Feed hook — derives items from existing source tables + overlays state
// =============================================================================

export function useNotificationFeed() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const adminUpcoming = useServerFn(listUpcomingForBell);
  const portalAppts = useServerFn(listMyPortalAppointments);

  // ---- Realtime: one consolidated channel per user ----------------------
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }, 300);
    };
    const ch = supabase
      .channel(`notifications-${user.id}`)
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
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_state", filter: `user_id=eq.${user.id}` }, invalidate)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [user, qc]);

  const query = useQuery({
    queryKey: ["notifications", role, user?.id],
    enabled: !!user && !!role,
    staleTime: 15_000,
    queryFn: async () => {
      // ---- Collect raw items (source-implicit unread or noteworthy) -----
      const raw: Omit<BellItem, "isRead" | "isArchived">[] = [];

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
            raw.push({
              id: makeId("message", m.client_id),
              kind: "message", sourceId: m.client_id, clientId: m.client_id, name, title,
              body: m.body, created_at: m.created_at,
            });
          }
        }
        for (const v of (vids ?? []) as any[]) {
          if (v.admin_last_viewed_at) continue;
          const name = cMap.get(v.client_id) ?? "Client";
          raw.push({
            id: makeId("lift_video", v.id),
            kind: "lift_video", sourceId: v.id, clientId: v.client_id, videoId: v.id, name,
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
          raw.push({
            id: makeId("agreement", a.id),
            kind: "agreement", sourceId: a.id, clientId: a.client_id, agreementId: a.id, name,
            title: `${label} — ${name}`,
            body: a.agreement_type ?? a.template_name ?? "Agreement",
            created_at: a.updated_at,
          });
        }
        for (const n of (exNotes ?? []) as any[]) {
          const name = cMap.get(n.client_id) ?? "Client";
          const verb = n.status === "edited" ? "edited a note on" : "added a note on";
          raw.push({
            id: makeId("exercise_note", n.id),
            kind: "exercise_note", sourceId: n.id, clientId: n.client_id, noteId: n.id, name,
            title: `${name} ${verb} ${n.exercise_name}`,
            body: n.content, created_at: n.updated_at,
          });
        }
        const groupItems = await fetchUnreadGroupItems(user!.id);
        for (const gi of groupItems) raw.push(gi);
        try {
          const upcoming: any[] = await adminUpcoming();
          for (const a of upcoming) {
            const mins = Math.round((new Date(a.starts_at).getTime() - Date.now()) / 60000);
            if (mins < -5) continue;
            const when = mins <= 60
              ? (mins <= 0 ? "now" : `in ${mins}m`)
              : new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            const who = a.client?.full_name || "external attendee";
            raw.push({
              id: makeId("appointment", a.id),
              kind: "appointment", sourceId: a.id, clientId: "", appointmentId: a.id,
              meetLink: a.meet_link, name: who,
              title: `Upcoming: ${a.title} (${when})`,
              body: `With ${who}`, created_at: a.starts_at,
            });
          }
        } catch { /* ignore */ }
      } else {
        const { data: client } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
        if (!client) return { items: [] as BellItem[] };
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
        // Collapse messages to one entry per client (the most recent unread).
        if (unread.length > 0) {
          const m = unread[0] as any;
          const atts = (m.attachments ?? []) as MessageAttachment[];
          const hasVoice = atts.some((a) => a.type === "audio");
          const hasMedia = atts.some((a) => a.type === "image" || a.type === "video");
          const title = hasVoice ? "Coach Jared sent a voice message"
            : hasMedia ? "Coach Jared sent a photo/video"
            : atts.length ? "Coach Jared sent an attachment"
            : "New message from Coach Jared";
          raw.push({
            id: makeId("message", client.id),
            kind: "message", sourceId: client.id, clientId: client.id, name: "Coach Jared",
            title, body: m.body, created_at: m.created_at,
          });
        }
        const vidMap = new Map<string, any>();
        for (const v of (vids ?? []) as any[]) {
          vidMap.set(v.id, v);
          const seenAt = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
          const events: { at: string; verb: string }[] = [];
          if (v.watched_at && new Date(v.watched_at).getTime() > seenAt) events.push({ at: v.watched_at, verb: "watched" });
          if (v.liked_at && new Date(v.liked_at).getTime() > seenAt) events.push({ at: v.liked_at, verb: "liked" });
          if (v.reviewed_at && new Date(v.reviewed_at).getTime() > seenAt) events.push({ at: v.reviewed_at, verb: "marked reviewed" });
          if (v.status === "Needs Follow-Up" && (!v.client_last_viewed_at || new Date(v.updated_at).getTime() > seenAt)) {
            events.push({ at: v.updated_at, verb: "requested follow-up on" });
          }
          if (events.length > 0) {
            const e = events[events.length - 1];
            raw.push({
              id: makeId("lift_video", v.id),
              kind: "lift_video", sourceId: v.id, clientId: client.id, videoId: v.id, name: "Coach Jared",
              title: `Coach Jared ${e.verb} your lift video`,
              body: v.exercise || "Lift video", created_at: e.at,
            });
          }
        }
        for (const c of (vcomments ?? []) as any[]) {
          const v = vidMap.get(c.video_id);
          const seenAt = v?.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
          if (new Date(c.created_at).getTime() <= seenAt) continue;
          // Use comment-coalesced id by video so repeated comments collapse.
          raw.push({
            id: makeId("lift_video", c.video_id),
            kind: "lift_video", sourceId: c.video_id, clientId: client.id, videoId: c.video_id, name: "Coach Jared",
            title: "Coach Jared commented on your lift video",
            body: c.body, created_at: c.created_at,
          });
        }
        for (const r of (reviews ?? []) as any[]) {
          raw.push({
            id: makeId("check_in_review", r.id),
            kind: "check_in_review", sourceId: r.id, clientId: client.id, reviewId: r.id, name: "Coach Jared",
            title: `Coach Jared sent: ${r.title || "Check-In Review"}`,
            body: r.message || "New check-in review from your coach.",
            created_at: r.created_at,
          });
        }
        const groupItems = await fetchUnreadGroupItems(user!.id);
        for (const gi of groupItems) raw.push(gi);
        try {
          const { upcoming } = await portalAppts();
          for (const a of (upcoming ?? []) as any[]) {
            const mins = Math.round((new Date(a.starts_at).getTime() - Date.now()) / 60000);
            if (mins > 24 * 60 || mins < -5) continue;
            const when = mins <= 60
              ? (mins <= 0 ? "now" : `in ${mins}m`)
              : new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            raw.push({
              id: makeId("appointment", a.id),
              kind: "appointment", sourceId: a.id, clientId: client.id, appointmentId: a.id,
              meetLink: a.meet_link, name: a.host_coach?.full_name ?? "Coach",
              title: `Upcoming: ${a.title} (${when})`,
              body: `With ${a.host_coach?.full_name ?? "your coach"}`,
              created_at: a.starts_at,
            });
          }
        } catch { /* ignore */ }
      }

      // Deduplicate by id, keep newest.
      const byId = new Map<string, typeof raw[number]>();
      for (const r of raw) {
        const prev = byId.get(r.id);
        if (!prev || new Date(r.created_at) > new Date(prev.created_at)) byId.set(r.id, r);
      }
      const unique = Array.from(byId.values());

      // Overlay notification_state for this user.
      // Filter by BOTH kind list AND source_id list so the query stays
      // bounded by the current derived feed (~300 rows max) instead of
      // returning the user's entire lifetime archive of state rows.
      let stateMap = new Map<string, NotifStateRow>();
      if (unique.length > 0) {
        const kinds = Array.from(new Set(unique.map((u) => u.kind)));
        const sourceIds = Array.from(new Set(unique.map((u) => u.sourceId)));
        const { data: states } = await (supabase.from("notification_state") as any)
          .select("kind, source_id, read_at, archived_at")
          .eq("user_id", user!.id)
          .in("kind", kinds)
          .in("source_id", sourceIds);
        for (const s of (states ?? []) as NotifStateRow[]) {
          stateMap.set(makeId(s.kind as BellKind, s.source_id), s);
        }
      }

      const items: BellItem[] = unique.map((u) => {
        const st = stateMap.get(u.id);
        return {
          ...u,
          isRead: !!st?.read_at,
          isArchived: !!st?.archived_at,
        };
      });
      items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      return { items };
    },
  });

  const items = query.data?.items ?? [];
  const unreadCount = items.reduce((n, it) => n + (!it.isRead && !it.isArchived ? 1 : 0), 0);

  return { query, role, user, qc, items, unreadCount };
}

// =============================================================================
// Mutations against notification_state
// =============================================================================

type IdPair = { kind: string; source_id: string };

function toPairs(items: Pick<BellItem, "kind" | "sourceId">[]): IdPair[] {
  return items.map((i) => ({ kind: i.kind, source_id: i.sourceId }));
}

async function rpc(name: "notif_mark_read" | "notif_mark_unread" | "notif_archive" | "notif_restore", pairs: IdPair[]) {
  if (pairs.length === 0) return;
  const { error } = await (supabase.rpc as any)(name, { items: pairs });
  if (error) throw error;
}

// Best-effort: also mark the underlying source so the item naturally
// disappears from the derived feed on next refetch.
async function markSourceRead(it: Pick<BellItem, "kind" | "clientId" | "videoId" | "noteId" | "groupId" | "reviewId">, role: string | null) {
  try {
    if (it.kind === "message" && it.clientId) {
      await markRead(it.clientId, role === "admin" ? "admin" : "client");
    } else if (it.kind === "lift_video" && it.videoId) {
      await (role === "admin" ? markAdminViewed(it.videoId) : markClientViewed(it.videoId));
    } else if (it.kind === "exercise_note" && it.noteId && role === "admin") {
      await (supabase.from("pl_exercise_notes") as any)
        .update({ coach_seen_at: new Date().toISOString() }).eq("id", it.noteId);
    } else if (it.kind === "group_message" && it.groupId) {
      await (supabase.from("chat_group_members") as any)
        .update({ last_read_at: new Date().toISOString() }).eq("group_id", it.groupId);
    } else if (it.kind === "check_in_review" && it.reviewId) {
      await (supabase.from("manual_check_in_reviews") as any)
        .update({ read_at: new Date().toISOString() }).eq("id", it.reviewId);
    }
  } catch { /* swallow — notification_state is the source of truth for the bell */ }
}

function patchCache(qc: ReturnType<typeof useQueryClient>, role: string | null, userId: string | undefined, patch: (it: BellItem) => BellItem) {
  qc.setQueryData<{ items: BellItem[] }>(["notifications", role, userId], (old) => {
    if (!old) return old as any;
    return { items: old.items.map(patch) };
  });
}

// Legacy exports retained for compatibility ----------------------------------

export function markItem(it: BellItem, role: string | null) {
  // Fire-and-forget: source mark-read + notification_state.
  void markSourceRead(it, role);
  void rpc("notif_mark_read", toPairs([it]));
}

export async function markAllRead(items: BellItem[], role: string | null, _userId: string | undefined) {
  const targets = items.filter((i) => !i.isRead && !i.isArchived);
  await Promise.all([
    rpc("notif_mark_read", toPairs(targets)),
    ...targets.map((i) => markSourceRead(i, role)),
  ]);
}

// =============================================================================
// Navigation
// =============================================================================

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
    case "check_in_review": return isAdmin && it.clientId
      ? { to: "/admin/clients/$id", params: { id: it.clientId }, search: { tab: "check-ins" as any } }
      : { to: "/portal" } as const;
    case "appointment": return { to: isAdmin ? "/admin/appointments" : "/portal/appointments" } as const;
    case "group_message": return { to: isAdmin ? "/admin/messages" : "/portal/messages" } as const;
    default: return isAdmin
      ? { to: "/admin/messages", search: { client: it.clientId } }
      : { to: "/portal/messages" } as const;
  }
}

// =============================================================================
// Date grouping
// =============================================================================

function groupByDate(items: BellItem[]): Array<{ label: string; items: BellItem[] }> {
  const today: BellItem[] = [], yesterday: BellItem[] = [], earlier: BellItem[] = [];
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

// =============================================================================
// Bell button
// =============================================================================

export function NotificationBell() {
  const { unreadCount } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const trigger = (
    <button
      type="button"
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <Badge className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </Badge>
      )}
    </button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Notifications</SheetTitle>
          </SheetHeader>
          <NotificationPanel compact onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-0">
        <NotificationPanel compact onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// Panel (used by bell + full page)
// =============================================================================

type View = "new" | "all" | "archived";

export function NotificationPanel({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { query, role, user, qc, items, unreadCount } = useNotificationFeed();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("new");
  const [archiveAllOpen, setArchiveAllOpen] = useState(false);
  const [clearReadOpen, setClearReadOpen] = useState(false);
  const [visible, setVisible] = useState(compact ? 10 : 20);

  const userId = user?.id;

  // Filtered items per view
  const filtered = useMemo(() => {
    if (view === "archived") return items.filter((i) => i.isArchived);
    if (view === "new") return items.filter((i) => !i.isRead && !i.isArchived);
    return items.filter((i) => !i.isArchived);
  }, [items, view]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const hasMore = filtered.length > shown.length;
  const groups = useMemo(() => groupByDate(shown), [shown]);

  // ---- Mutations with optimistic UI -------------------------------------

  const markReadMut = useMutation({
    mutationFn: async (target: BellItem) => {
      await Promise.all([rpc("notif_mark_read", toPairs([target])), markSourceRead(target, role)]);
    },
    onMutate: (target) => {
      patchCache(qc, role, userId, (it) => it.id === target.id ? { ...it, isRead: true } : it);
    },
    onError: () => { toast.error("That notification could not be updated. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const markUnreadMut = useMutation({
    mutationFn: async (target: BellItem) => { await rpc("notif_mark_unread", toPairs([target])); },
    onMutate: (target) => {
      patchCache(qc, role, userId, (it) => it.id === target.id ? { ...it, isRead: false } : it);
    },
    onError: () => { toast.error("That notification could not be updated. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const archiveMut = useMutation({
    mutationFn: async (target: BellItem) => { await rpc("notif_archive", toPairs([target])); },
    onMutate: (target) => {
      patchCache(qc, role, userId, (it) => it.id === target.id ? { ...it, isArchived: true, isRead: true } : it);
    },
    onError: () => { toast.error("That notification could not be updated. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const restoreMut = useMutation({
    mutationFn: async (target: BellItem) => { await rpc("notif_restore", toPairs([target])); },
    onMutate: (target) => {
      patchCache(qc, role, userId, (it) => it.id === target.id ? { ...it, isArchived: false } : it);
    },
    onError: () => { toast.error("That notification could not be updated. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const markAllMut = useMutation({
    mutationFn: async () => {
      const targets = items.filter((i) => !i.isRead && !i.isArchived);
      await Promise.all([
        rpc("notif_mark_read", toPairs(targets)),
        ...targets.map((i) => markSourceRead(i, role)),
      ]);
    },
    onMutate: () => {
      patchCache(qc, role, userId, (it) => it.isArchived ? it : { ...it, isRead: true });
    },
    onSuccess: () => toast.success("All notifications marked as read."),
    onError: () => { toast.error("Couldn't mark notifications as read. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const clearReadMut = useMutation({
    mutationFn: async () => {
      const targets = items.filter((i) => i.isRead && !i.isArchived);
      await rpc("notif_archive", toPairs(targets));
    },
    onMutate: () => {
      patchCache(qc, role, userId, (it) => (it.isRead && !it.isArchived) ? { ...it, isArchived: true } : it);
    },
    onSuccess: () => toast.success("Read notifications cleared."),
    onError: () => { toast.error("Couldn't clear notifications. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const archiveAllMut = useMutation({
    mutationFn: async () => {
      const targets = items.filter((i) => !i.isArchived);
      await rpc("notif_archive", toPairs(targets));
    },
    onMutate: () => { patchCache(qc, role, userId, (it) => ({ ...it, isArchived: true, isRead: true })); },
    onSuccess: () => toast.success("All notifications archived."),
    onError: () => { toast.error("Couldn't archive notifications. Try again."); qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  // ---- Row click: navigate + mark read -----------------------------------
  const handleRowClick = useCallback(
    (it: BellItem) => {
      if (!it.isRead) markReadMut.mutate(it);
      const dest = destinationFor(it, role);
      try { navigate(dest as any); } catch { /* ignore */ }
      onNavigate?.();
    },
    [markReadMut, navigate, onNavigate, role],
  );

  const readCount = items.filter((i) => i.isRead && !i.isArchived).length;
  const hasAny = items.length > 0;

  return (
    <div className={cn("flex flex-col", compact ? "max-h-[80vh]" : "")}>
      {/* Header: filters + actions */}
      <div className="flex flex-col gap-2 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <FilterChip active={view === "new"} onClick={() => setView("new")}>
              New
              {unreadCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </FilterChip>
            <FilterChip active={view === "all"} onClick={() => setView("all")}>All</FilterChip>
            {view === "archived" && (
              <FilterChip active onClick={() => setView("archived")}>Archived</FilterChip>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs"
              disabled={markAllMut.isPending || unreadCount === 0}
              onClick={() => markAllMut.mutate()}
              title={unreadCount === 0 ? "You have no new notifications." : "Mark all as read"}
            >
              {markAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More notification actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={readCount === 0}
                  onSelect={(e) => { e.preventDefault(); setClearReadOpen(true); }}
                >
                  <Archive className="mr-2 h-3.5 w-3.5" /> Clear read ({readCount})
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setView(view === "archived" ? "new" : "archived")}>
                  <Inbox className="mr-2 h-3.5 w-3.5" />
                  {view === "archived" ? "Back to inbox" : "View archived"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!hasAny}
                  onSelect={(e) => { e.preventDefault(); setArchiveAllOpen(true); }}
                >
                  <Archive className="mr-2 h-3.5 w-3.5" /> Archive all notifications
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="flex items-center justify-center px-6 py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.isError ? (
          <EmptyState
            title="Notifications couldn't be loaded."
            body="Try again."
            action={<Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              view === "archived" ? "No archived notifications."
                : view === "new" ? "You're all caught up."
                : "No notifications yet."
            }
            body={view === "new" ? "New updates will appear here." : undefined}
          />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.label}>
                <div className="sticky top-0 z-10 bg-popover/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {g.label}
                </div>
                {g.items.map((it) => (
                  <NotificationRow
                    key={it.id}
                    item={it}
                    onClick={() => handleRowClick(it)}
                    onMarkRead={() => markReadMut.mutate(it)}
                    onMarkUnread={() => markUnreadMut.mutate(it)}
                    onArchive={() => archiveMut.mutate(it)}
                    onRestore={() => restoreMut.mutate(it)}
                  />
                ))}
              </div>
            ))}
            {hasMore && (
              <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full text-xs"
                  onClick={() => setVisible((n) => n + (compact ? 10 : 20))}>
                  Load older notifications
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                    {filtered.length - shown.length}
                  </Badge>
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {compact && (
        <div className="border-t px-3 py-2">
          <Link
            to="/notifications"
            onClick={onNavigate}
            className="block text-center text-xs font-medium text-primary hover:underline"
          >
            View all notifications
          </Link>
        </div>
      )}

      {/* Confirm: Clear read */}
      <AlertDialog open={clearReadOpen} onOpenChange={setClearReadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all read notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes read notifications from your notification list. New notifications will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => clearReadMut.mutate()}>Clear read</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: Archive all */}
      <AlertDialog open={archiveAllOpen} onOpenChange={setArchiveAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive all notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove both read and unread notifications from your list. You may miss items you have not opened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveAllMut.mutate()}>Archive all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================================================
// Small UI bits
// =============================================================================

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium transition",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary">
        <CheckCheck className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {body && <p className="mt-1 text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function NotificationRow({
  item, onClick, onMarkRead, onMarkUnread, onArchive, onRestore,
}: {
  item: BellItem;
  onClick: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isUnread = !item.isRead && !item.isArchived;
  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 border-b px-3 py-2.5 transition last:border-b-0",
        isUnread ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-secondary/60",
        item.isArchived && "opacity-70",
      )}
    >
      {/* Unread dot */}
      <div className="mt-1.5 w-2 shrink-0">
        {isUnread && <span className="block h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
      </div>
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left focus-visible:outline-none"
      >
        <div className={cn(
          "truncate pr-1 text-xs leading-tight",
          isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
        )}>
          {item.title}
        </div>
        {item.body && (
          <div className="mt-0.5 line-clamp-2 pr-1 text-[11px] text-muted-foreground">
            {item.body}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
        </div>
      </button>

      {/* Per-row actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
            aria-label="Notification actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {item.isArchived ? (
            <DropdownMenuItem onSelect={onRestore}>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore
            </DropdownMenuItem>
          ) : isUnread ? (
            <DropdownMenuItem onSelect={onMarkRead}>
              <MailOpen className="mr-2 h-3.5 w-3.5" /> Mark as read
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onMarkUnread}>
              <Mail className="mr-2 h-3.5 w-3.5" /> Mark as unread
            </DropdownMenuItem>
          )}
          {!item.isArchived && (
            <DropdownMenuItem onSelect={onArchive}>
              <Archive className="mr-2 h-3.5 w-3.5" /> Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Re-export Filter icon for downstream pages
export { Filter };
