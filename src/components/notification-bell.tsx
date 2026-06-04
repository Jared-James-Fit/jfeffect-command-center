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
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const { data } = useQuery({
    queryKey: ["unread-counts", role, user?.id],
    enabled: !!user && !!role,
    queryFn: async () => {
      if (role === "admin") {
        const [{ data: msgs }, { data: states }] = await Promise.all([
          (supabase.from("messages") as any).select("client_id, body, created_at, sender_role, is_internal_note").eq("sender_role", "client").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(200),
          (supabase.from("conversation_state") as any).select("client_id, admin_last_read_at"),
        ]);
        const stateMap = new Map<string, ConversationState>((states ?? []).map((s: any) => [s.client_id, s]));
        const { data: clients } = await supabase.from("clients").select("id, full_name");
        const cMap = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
        const unread: { clientId: string; name: string; body: string; created_at: string }[] = [];
        const seen = new Set<string>();
        for (const m of (msgs ?? []) as Message[]) {
          if (seen.has(m.client_id)) continue;
          const lastRead = stateMap.get(m.client_id)?.admin_last_read_at;
          if (!lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime()) {
            seen.add(m.client_id);
            unread.push({ clientId: m.client_id, name: cMap.get(m.client_id) ?? "Client", body: m.body, created_at: m.created_at });
          }
        }
        return { count: unread.length, items: unread };
      } else {
        const { data: client } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
        if (!client) return { count: 0, items: [] };
        const [{ data: msgs }, { data: state }] = await Promise.all([
          (supabase.from("messages") as any).select("body, created_at, sender_role").eq("client_id", client.id).eq("sender_role", "admin").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(20),
          (supabase.from("conversation_state") as any).select("client_last_read_at").eq("client_id", client.id).maybeSingle(),
        ]);
        const lastRead = state?.client_last_read_at;
        const unread = (msgs ?? []).filter((m: any) => !lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime());
        return {
          count: unread.length,
          items: unread.map((m: any) => ({ clientId: client.id, name: "Coach Jared", body: m.body, created_at: m.created_at })),
        };
      }
    },
  });

  const count = data?.count ?? 0;
  const items = useMemo<{ clientId: string; name: string; body: string; created_at: string }[]>(
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
              to={role === "admin" ? "/admin/messages" : "/portal/messages"}
              search={role === "admin" ? { client: it.clientId } : undefined}
              className="block"
            >
              <div className="text-xs font-semibold">{role === "admin" ? `New message from ${it.name}` : `New message from Coach Jared`}</div>
              <div className="line-clamp-1 text-[11px] text-muted-foreground">{it.body || "(attachment)"}</div>
              <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(parseISO(it.created_at), { addSuffix: true })}</div>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}