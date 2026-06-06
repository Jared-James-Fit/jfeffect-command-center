import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MessageThread, UnreadBadge, PriorityChip } from "@/components/message-thread";
import {
  type ConversationState, type Message,
  setConversationStatus, setConversationPriority, PRIORITIES,
} from "@/lib/messages";
import { Search, ChevronLeft, MoreHorizontal, ExternalLink, Filter } from "lucide-react";
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
  const navigate = useNavigate();
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

  const selectClient = (id: string) => {
    setSelectedId(id);
    navigate({ to: "/admin/messages", search: { client: id }, replace: true });
  };
  const clearSelection = () => {
    setSelectedId(null);
    navigate({ to: "/admin/messages", search: {}, replace: true });
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

  // Full-bleed two-pane layout. On <md: stacked — inbox OR conversation.
  // On md+: persistent inbox sidebar (320–360px) + conversation pane.
  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex bg-background md:static md:inset-auto md:z-auto md:h-full md:flex-1"
      style={{ height: "100dvh" }}
    >
      {/* Inbox sidebar */}
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border bg-card md:w-[340px] md:shrink-0",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        <header
          className="border-b border-border px-4 py-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-lg font-black tracking-tight">Messages</h1>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {conversations.length}
            </span>
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
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No conversations.</div>
          ) : conversations.map(({ client, state, last, unread }) => (
            <button
              key={client.id}
              onClick={() => selectClient(client.id)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition hover:bg-secondary/40",
                selectedId === client.id && "bg-secondary/60",
              )}
            >
              <Avatar className="h-11 w-11 shrink-0">
                <AvatarImage src={client.profile_picture_url ?? undefined} />
                <AvatarFallback>{(client.full_name ?? "?").slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", unread > 0 ? "font-bold" : "font-semibold")}>
                    {client.full_name}
                  </span>
                  {last && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(parseISO(last.created_at), { addSuffix: false })}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn("truncate flex-1 text-xs", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                    {last
                      ? (last.sender_role === "admin" ? "You: " : "") + (last.body || "(attachment)")
                      : "No messages yet"}
                  </span>
                  <UnreadBadge count={unread} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {state?.status === "needs_response" && (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
                      Needs Response
                    </Badge>
                  )}
                  <PriorityChip priority={state?.priority} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation pane */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          selected ? "flex" : "hidden md:flex",
        )}
      >
        {selected ? (
          <>
            <header
              className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/60 md:px-4"
              style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 md:hidden"
                onClick={clearSelection}
                aria-label="Back to inbox"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={selected.profile_picture_url ?? undefined} />
                <AvatarFallback>{(selected.full_name ?? "?").slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{selected.full_name}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {selectedState?.priority && selectedState.priority !== "Normal" && (
                    <PriorityChip priority={selectedState.priority} />
                  )}
                  {selectedState?.status === "needs_response" && (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
                      Needs Response
                    </Badge>
                  )}
                  {selectedState?.status === "resolved" && (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 text-[10px]">
                      Resolved
                    </Badge>
                  )}
                  <span className="truncate">{selected.email}</span>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">Conversation</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link to="/admin/clients/$id" params={{ id: selected.id }}>
                      <ExternalLink className="mr-2 h-4 w-4" /> Open client profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => updateStatus("open")}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateStatus("needs_response")}>Needs Response</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateStatus("resolved")}>Resolved</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateStatus("archived")}>Archived</DropdownMenuItem>
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
            <MessageThread
              clientId={selected.id}
              role="admin"
              conversationState={selectedState ?? null}
              hideControls
              fullBleed
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Select a conversation to start.
          </div>
        )}
      </section>
    </div>
  );
}