import { useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { ConversationState, Message } from "@/lib/messages";

type BellItem = {
  kind: "message" | "lift_video";
  clientId: string;
  videoId?: string;
  name: string;
  title: string;
  body: string;
  created_at: string;
};

export function NotificationBell() {
  const { role, user } = useAuth();
  const qc = useQueryClient();

  // Realtime invalidation
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("bell-messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, () => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, () => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments" }, () => {
        qc.invalidateQueries({ queryKey: ["unread-counts"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const { data } = useQuery({
    queryKey: ["unread-counts", role, user?.id],
    enabled: !!user && !!role,
    queryFn: async () => {
      if (role === "admin") {
        const [{ data: msgs }, { data: states }, { data: vids }] = await Promise.all([
          (supabase.from("messages") as any).select("client_id, body, attachments, created_at, sender_role, is_internal_note").eq("sender_role", "client").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(200),
          (supabase.from("conversation_state") as any).select("client_id, admin_last_read_at"),
          (supabase.from("lift_videos") as any)
            .select("id, client_id, exercise, client_notes, created_at, admin_last_viewed_at, status")
            .order("created_at", { ascending: false })
            .limit(50),
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
        items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        return { count: items.length, items };
      }
    },
  });

  const count = data?.count ?? 0;
  const items = useMemo<BellItem[]>(
    () => (data?.items ?? []).slice(0, 8),
    [data],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-secondary">
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <Badge className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">You're all caught up.</div>
        ) : items.map((it, i) => (
          <DropdownMenuItem asChild key={`${it.clientId}-${i}`}>
            <Link
              to={
                it.kind === "lift_video"
                  ? (role === "admin" ? "/admin/lift-videos" : "/portal/lift-videos")
                  : (role === "admin" ? "/admin/messages" : "/portal/messages")
              }
              search={role === "admin" && it.kind === "message" ? { client: it.clientId } : undefined}
              className="block"
            >
              <div className="text-xs font-semibold">{it.title}</div>
              <div className="line-clamp-1 text-[11px] text-muted-foreground">{it.body || "(attachment)"}</div>
              <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(parseISO(it.created_at), { addSuffix: true })}</div>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}