/**
 * Cleo's conversations (Nov 24 2026): Pinned, Today, Yesterday, Previous 7
 * days, Previous 30 days, then by month, the most recently active first, in the
 * person's own time zone. Search reads titles and everything said; filters
 * narrow by client, topic and dates. Each conversation can be pinned, renamed,
 * archived (or brought back) and deleted (asked first: deleting is for good,
 * archiving never is). The archive is its own view, by year, month and day,
 * just as searchable; sending in an archived conversation brings it back.
 *
 * Titles and topics are Cleo's (named after the first answer); the coach never
 * has to file anything.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ListFilter, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Search, SquarePen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  CLEO_CATEGORIES,
  chatWhen,
  groupArchive,
  groupChats,
  localTimeZone,
  type CleoCategory,
  type CleoChat,
} from "@/lib/cleo-chats";
import { cleoConversationClients, deleteCleoConversation, listCleoConversations, updateCleoConversation } from "@/lib/cleo-conversations.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HISTORY_KEY, convKey } from "./use-cleo-conversation";

type Filters = { client: string; category: CleoCategory | ""; from: string; to: string };
const NO_FILTERS: Filters = { client: "", category: "", from: "", to: "" };

function Row({
  chat,
  active,
  tz,
  onOpen,
  onChanged,
  onDelete,
}: {
  chat: CleoChat;
  active: boolean;
  tz: string;
  onOpen: () => void;
  onChanged: (patch: { pinned?: boolean; archived?: boolean; title?: string }) => Promise<void>;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const meta = [chat.client_name, chat.category && chat.category !== "general" ? CATEGORY_LABEL[chat.category] : null].filter(Boolean).join(" · ");
  if (renaming !== null)
    return (
      <form
        className="flex items-center gap-1 px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!renaming.trim()) return;
          void onChanged({ title: renaming }).then(() => setRenaming(null));
        }}
      >
        <input
          value={renaming}
          autoFocus
          maxLength={120}
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-foreground/40"
          aria-label="Conversation name"
        />
        <button type="submit" className="h-9 cursor-pointer rounded-lg bg-foreground px-3 text-sm font-medium text-background">Save</button>
        <button type="button" onClick={() => setRenaming(null)} className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </form>
    );
  return (
    <div className={cn("group flex items-center rounded-lg", active ? "bg-muted" : "hover:bg-muted/60")} data-cleo-history-row>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left">
        <span className="flex items-center gap-1.5">
          {chat.pinned_at && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
          <span className="truncate text-sm font-medium">{chat.title}</span>
          {!!chat.pending && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Something waiting" title="Something's waiting in this conversation" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
          {meta && <span className="truncate">{meta}</span>}
          {meta && <span aria-hidden>·</span>}
          <span className="shrink-0">{chatWhen(chat.last_message_at, new Date(), tz)}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mr-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-100"
            aria-label={`More for ${chat.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {!chat.archived_at && (
            <DropdownMenuItem onSelect={() => void onChanged({ pinned: !chat.pinned_at })}>
              {chat.pinned_at ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
              {chat.pinned_at ? "Unpin" : "Pin"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setRenaming(chat.title)}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onChanged({ archived: !chat.archived_at })}>
            {chat.archived_at ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {chat.archived_at ? "Move back to conversations" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CleoHistory({
  activeChatId,
  onOpen,
  onNew,
  onClose,
  onDeleted,
  className,
}: {
  activeChatId: string | null;
  onOpen: (chat: CleoChat) => void;
  onNew: () => void;
  /** A drawer: the ✕ (a sidebar has none). */
  onClose?: () => void;
  onDeleted: (chatId: string) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCleoConversations);
  const clientsFn = useServerFn(cleoConversationClients);
  const updateFn = useServerFn(updateCleoConversation);
  const deleteFn = useServerFn(deleteCleoConversation);
  const tz = useMemo(() => localTimeZone(), []);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [deleting, setDeleting] = useState<CleoChat | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const activeFilters = (filters.client ? 1 : 0) + (filters.category ? 1 : 0) + (filters.from || filters.to ? 1 : 0);
  const query = {
    q: term || null,
    clientId: filters.client && filters.client !== "general" ? filters.client : null,
    general: filters.client === "general",
    category: filters.category || null,
    from: filters.from || null,
    to: filters.to || null,
    archived,
    tz,
  };
  const { data: chats = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [...HISTORY_KEY, query],
    queryFn: () => listFn({ data: query }) as Promise<CleoChat[]>,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["cleo-history-clients"],
    queryFn: () => clientsFn() as Promise<Array<{ id: string; name: string }>>,
    enabled: showFilters,
    staleTime: 60_000,
  });

  const change = async (chat: CleoChat, patch: { pinned?: boolean; archived?: boolean; title?: string }) => {
    try {
      await updateFn({ data: { chatId: chat.id, ...patch } });
      void qc.invalidateQueries({ queryKey: HISTORY_KEY });
      void qc.invalidateQueries({ queryKey: convKey(chat.id) });
      if (patch.archived !== undefined) {
        toast.success(patch.archived ? "Archived. It's in Archived, never deleted." : "Back in your conversations.", {
          action: { label: "Undo", onClick: () => void change(chat, { archived: !patch.archived }) },
        });
        if (patch.archived) void qc.invalidateQueries({ queryKey: ["cleo-conv-place"] });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change that.");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await deleteFn({ data: { chatId: deleting.id } });
      onDeleted(deleting.id);
      void qc.invalidateQueries({ queryKey: HISTORY_KEY });
      toast.success("Conversation deleted");
      setDeleting(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete that.");
    } finally {
      setBusyDelete(false);
    }
  };

  const groups = archived ? null : groupChats(chats, new Date(), tz);
  const archive = archived ? groupArchive(chats, tz) : null;
  const row = (c: CleoChat) => (
    <Row key={c.id} chat={c} active={c.id === activeChatId} tz={tz} onOpen={() => onOpen(c)} onChanged={(p) => change(c, p)} onDelete={() => setDeleting(c)} />
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-cleo-history>
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-9 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm font-medium hover:bg-muted"
            data-cleo-new
          >
            <SquarePen className="h-4 w-4" /> New conversation
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close conversations">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={archived ? "Search archived" : "Search"}
              className="h-9 w-full rounded-lg bg-muted/60 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
              aria-label="Search conversations"
              type="search"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-pressed={showFilters}
            className={cn("relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground", (showFilters || activeFilters) && "text-foreground")}
            aria-label="Filter"
            title="Filter by client, topic or date"
          >
            <ListFilter className="h-4 w-4" />
            {activeFilters > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden />}
          </button>
        </div>
        {showFilters && (
          <div className="space-y-2 rounded-lg bg-muted/40 p-2" data-cleo-filters>
            <select
              value={filters.client}
              onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
              aria-label="Client"
            >
              <option value="">Every client</option>
              <option value="general">General (no client)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="-mx-0.5 flex flex-wrap gap-1">
              {CLEO_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, category: f.category === c ? "" : c }))}
                  aria-pressed={filters.category === c}
                  className={cn(
                    "h-7 cursor-pointer rounded-full border px-2.5 text-[12px]",
                    filters.category === c ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm text-foreground" aria-label="From" />
              <span>to</span>
              <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm text-foreground" aria-label="To" />
            </div>
            {activeFilters > 0 && (
              <button type="button" onClick={() => setFilters(NO_FILTERS)} className="cursor-pointer text-[12px] font-medium underline underline-offset-2">
                Clear filters
              </button>
            )}
          </div>
        )}
        <div className="flex gap-1 text-[13px]" role="tablist" aria-label="Which conversations">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              type="button"
              role="tab"
              aria-selected={archived === a}
              onClick={() => setArchived(a)}
              className={cn("h-8 cursor-pointer rounded-lg px-2.5 font-medium", archived === a ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {a ? "Archived" : "Conversations"}
            </button>
          ))}
          {isFetching && !isLoading && <Loader2 className="ml-auto h-3.5 w-3.5 self-center animate-spin text-muted-foreground" />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isLoading ? (
          <div className="space-y-2 px-2 pt-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 jf-skeleton rounded-lg bg-muted" />)}
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            Couldn't load your conversations.{" "}
            <button type="button" onClick={() => void refetch()} className="cursor-pointer font-medium text-foreground underline underline-offset-2">Try again</button>
          </div>
        ) : !chats.length ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            {term || activeFilters ? "Nothing matches." : archived ? `Nothing archived. Conversations quiet for a while are archived here, never deleted.` : "No conversations yet."}
          </p>
        ) : groups ? (
          groups.map((g) => (
            <div key={g.label} className="mt-2">
              <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">{g.label}</p>
              {g.chats.map(row)}
            </div>
          ))
        ) : (
          archive!.map((y) => (
            <div key={y.year} className="mt-2">
              <p className="px-2.5 pt-1 text-[12px] font-semibold">{y.year}</p>
              {y.months.map((m) => (
                <div key={m.label}>
                  <p className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">{m.label}</p>
                  {m.days.map((d) => (
                    <div key={d.label}>
                      <p className="px-2.5 pt-1 text-[11px] text-muted-foreground/80">{d.label}</p>
                      {d.chats.map(row)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and everything in it is deleted for good. To keep it out of the way instead, archive it: archived conversations stay searchable and can be picked up again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            {deleting && !deleting.archived_at && (
              <AlertDialogAction
                className="bg-secondary text-foreground hover:bg-secondary/80"
                onClick={() => {
                  const c = deleting;
                  setDeleting(null);
                  void change(c, { archived: true });
                }}
              >
                Archive instead
              </AlertDialogAction>
            )}
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busyDelete} onClick={(e) => { e.preventDefault(); void remove(); }}>
              {busyDelete ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
