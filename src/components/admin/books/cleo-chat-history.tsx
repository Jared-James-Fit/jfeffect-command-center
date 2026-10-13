/**
 * Cleo's History: every chat from the last year, newest first, grouped by
 * day. Tap one to open it (and keep talking); search finds anything said.
 * Deleting asks once, inline, so a stray tap never loses a chat.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageSquare, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteSummerChat, listSummerChats } from "@/lib/business-books.functions";
import { groupChats, type CleoChat } from "@/lib/cleo-chats";

export const CHATS_KEY = ["summer-chats"];

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-CA");
  return d.toLocaleDateString("en-CA") === today
    ? d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function CleoChatHistory({ activeId, onOpen, onBack, onDeleted }: {
  activeId: string | null;
  onOpen: (chat: CleoChat) => void;
  onBack: () => void;
  /** A chat was deleted (null: all of them), so the open one can be let go. */
  onDeleted: (chatId: string | null) => void;
}) {
  const list = useServerFn(listSummerChats);
  const remove = useServerFn(deleteSummerChat);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data: chats = [], isLoading, isFetching } = useQuery({
    queryKey: [...CHATS_KEY, term],
    queryFn: () => list({ data: { q: term || null } }) as Promise<CleoChat[]>,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const del = async (chatId: string | null) => {
    setBusy(chatId ?? "all");
    try {
      await remove({ data: { chatId } });
      onDeleted(chatId);
      toast.success(chatId ? "Chat deleted" : "All chats deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete that");
    } finally {
      setBusy(null);
      setConfirming(null);
      await qc.invalidateQueries({ queryKey: CHATS_KEY });
    }
  };

  const groups = groupChats(chats);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack} aria-label="Back to chat">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your chats" className="h-9 pl-8" aria-label="Search your chats" />
          {isFetching && term && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!isLoading && !chats.length && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-6 w-6" />
            {term ? `Nothing in your chats matches "${term}".` : "No past chats yet. They show up here once you start a new one."}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
            <ul className="space-y-0.5">
              {g.chats.map((c) => (
                <li key={c.id} className={cn("group flex items-center gap-1 rounded-xl pr-1", c.id === activeId ? "bg-primary/10" : "hover:bg-accent")}>
                  <button type="button" className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => onOpen(c)}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm font-medium", c.id === activeId && "text-primary")}>{c.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{when(c.last_message_at)}</span>
                    </span>
                    {c.preview && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.preview}</span>}
                  </button>
                  {confirming === c.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="destructive" className="h-8 px-2.5" disabled={!!busy} onClick={() => void del(c.id)}>
                        {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" disabled={!!busy} onClick={() => setConfirming(null)}>Keep</Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirming(c.id)}
                      aria-label={`Delete "${c.title}"`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-[11px] text-muted-foreground">
        <span>Chats are kept for a year after you last use them.</span>
        {chats.length > 0 && !term && (
          confirming === "all" ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => void del(null)}>
                {busy === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete all"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => setConfirming(null)}>Keep</Button>
            </span>
          ) : (
            <button type="button" className="shrink-0 underline-offset-2 hover:text-destructive hover:underline" onClick={() => setConfirming("all")}>
              Delete all
            </button>
          )
        )}
      </div>
    </div>
  );
}

