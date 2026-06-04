import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageThread, UnreadBadge, PriorityChip } from "@/components/message-thread";
import { priorityTone, type ConversationState, type Message } from "@/lib/messages";
import { Search, ExternalLink } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const FILTERS = ["All", "Unread", "Needs Response", "High Priority", "Important", "Resolved", "Archived"] as const;
type Filter = typeof FILTERS[number];

export const Route = createFileRoute("/_authenticated/admin/messages")({
  validateSearch: (s) => z.object({ client: z.string().uuid().optional() }).parse(s),
  component: MessagesInbox,
});

function MessagesInbox() {
  const { client: selectedFromUrl } = Route.useSearch();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl ?? null);

  useEffect(() => { if (selectedFromUrl) setSelectedId(selectedFromUrl); }, [selectedFromUrl]);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, full_name, first_name, last_name, email, profile_picture_url, archived, status").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: states = [] } = useQuery({
    queryKey: ["conversation-states"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("conversation_state") as any).select("*");
      if (error) throw error;
      return (data ?? []) as ConversationState[];
    },
  });

  const { data: lastMessages = [] } = useQuery({
    queryKey: ["last-messages"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("messages") as any)
        .select("id, client_id, body, sender_role, created_at, read_by_admin_at, is_internal_note")
        .eq("is_internal_note", false)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["last-messages"] });
        qc.invalidateQueries({ queryKey: ["conversation-states"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, () => {
        qc.invalidateQueries({ queryKey: ["conversation-states"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const lastByClient = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of lastMessages) if (!m.has(msg.client_id)) m.set(msg.client_id, msg);
    return m;
  }, [lastMessages]);

  const unreadByClient = useMemo(() => {
    const m = new Map<string, number>();
    const stateMap = new Map(states.map((s) => [s.client_id, s]));
    for (const msg of lastMessages) {
      if (msg.sender_role !== "client") continue;
      const s = stateMap.get(msg.client_id);
      const lastRead = s?.admin_last_read_at ? new Date(s.admin_last_read_at).getTime() : 0;
      if (new Date(msg.created_at).getTime() > lastRead) {
        m.set(msg.client_id, (m.get(msg.client_id) ?? 0) + 1);
      }
    }
    return m;
  }, [lastMessages, states]);

  const stateMap = useMemo(() => new Map(states.map((s) => [s.client_id, s])), [states]);

  const conversations = useMemo(() => {
    const items = clients
      .map((c) => {
        const state = stateMap.get(c.id);
        const last = lastByClient.get(c.id);
        const unread = unreadByClient.get(c.id) ?? 0;
        return { client: c, state, last, unread };
      })
      .filter((it) => {
        if (search) {
          const s = search.toLowerCase();
          if (!it.client.full_name?.toLowerCase().includes(s) && !it.client.email?.toLowerCase().includes(s)) return false;
        }
        const status = it.state?.status ?? "open";
        const priority = it.state?.priority ?? "Normal";
        switch (filter) {
          case "Unread": return it.unread > 0;
          case "Needs Response": return status === "needs_response";
          case "High Priority": return priority === "High Priority";
          case "Important": return priority === "Important";
          case "Resolved": return status === "resolved";
          case "Archived": return status === "archived";
          default: return status !== "archived";
        }
      })
      .sort((a, b) => {
        const at = a.last?.created_at ?? "";
        const bt = b.last?.created_at ?? "";
        return bt.localeCompare(at);
      });
    return items;
  }, [clients, stateMap, lastByClient, unreadByClient, search, filter]);

  const selected = clients.find((c) => c.id === selectedId);
  const selectedState = selectedId ? stateMap.get(selectedId) : undefined;

  return (
    <>
      <PageHeader title="Messages" subtitle="Client conversations in one inbox." />
      <div className="grid gap-4 p-6 md:p-8 lg:grid-cols-[360px_1fr]">
        <Card className="border-border bg-card flex flex-col overflow-hidden">
          <div className="border-b border-border p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-[600px] flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No conversations.</div>
            ) : conversations.map(({ client, state, last, unread }) => (
              <button
                key={client.id}
                onClick={() => setSelectedId(client.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition hover:bg-secondary/40",
                  selectedId === client.id && "bg-secondary/60",
                )}
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={client.profile_picture_url ?? undefined} />
                  <AvatarFallback>{(client.full_name ?? "?").slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{client.full_name}</span>
                    {last && <span className="shrink-0 text-[10px] text-muted-foreground">{formatDistanceToNow(parseISO(last.created_at), { addSuffix: true })}</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-xs text-muted-foreground flex-1">
                      {last ? (last.sender_role === "admin" ? "You: " : "") + (last.body || "(attachment)") : "No messages yet"}
                    </span>
                    <UnreadBadge count={unread} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {state?.status === "needs_response" && <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">Needs Response</Badge>}
                    <PriorityChip priority={state?.priority} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          {selected ? (
            <>
              <Card className="flex flex-wrap items-center justify-between gap-3 border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={selected.profile_picture_url ?? undefined} />
                    <AvatarFallback>{(selected.full_name ?? "?").slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-bold">{selected.full_name}</div>
                    <div className="text-xs text-muted-foreground">{selected.email}</div>
                  </div>
                </div>
                <Link to="/admin/clients/$id" params={{ id: selected.id }} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  Open client profile <ExternalLink className="h-3 w-3" />
                </Link>
              </Card>
              <MessageThread clientId={selected.id} role="admin" conversationState={selectedState ?? null} />
            </>
          ) : (
            <Card className="grid h-[600px] place-items-center border-border bg-card text-sm text-muted-foreground">
              Select a conversation to start.
            </Card>
          )}
        </div>
      </div>
    </>
  );
}