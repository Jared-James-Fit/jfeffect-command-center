import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { suggestClients } from "@/lib/client-file-notes";
import { cn } from "@/lib/utils";

type PickClient = { id: string; full_name: string | null; profile_picture_url: string | null };

/**
 * Pick the client a Quick Note belongs to. Clients named in the note are suggested first
 * (typo-tolerant), so most notes are one tap.
 */
export function ClientLinkDialog({
  open, noteText, currentClientId, onPick, onClose,
  title = "Save to client file",
  description = "The note syncs to their profile. If you delete it here, it stays in their notes archive.",
  suggestedLabel = "Mentioned in this note",
}: {
  open: boolean;
  noteText: string;
  currentClientId?: string;
  onPick: (c: { id: string; name: string }) => void;
  onClose: () => void;
  title?: string;
  description?: string;
  suggestedLabel?: string;
}) {
  const [q, setQ] = useState("");
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["client-link-picker"],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("id, full_name, profile_picture_url")
        .eq("archived", false).order("full_name").limit(500);
      if (error) throw error;
      return (data ?? []) as PickClient[];
    },
  });

  const suggested = useMemo(
    () => (q.trim() ? [] : suggestClients(noteText, clients).filter((c) => c.id !== currentClientId)),
    [noteText, clients, q, currentClientId],
  );
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ids = new Set(suggested.map((c) => c.id));
    return clients.filter((c) => !ids.has(c.id) && (!s || (c.full_name ?? "").toLowerCase().includes(s)));
  }, [clients, q, suggested]);

  const row = (c: PickClient, hint?: string) => {
    const name = c.full_name?.trim() || "Client";
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => { onPick({ id: c.id, name }); setQ(""); }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-secondary/60 active:scale-[0.99]",
            c.id === currentClientId && "bg-primary/10",
          )}
        >
          <UserAvatar src={c.profile_picture_url ?? undefined} name={name} size={32} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
          {hint && <span className="shrink-0 text-[10px] font-semibold text-primary">{hint}</span>}
          {c.id === currentClientId && <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">Current</span>}
        </button>
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setQ(""); onClose(); } }}>
      <DialogContent className="z-[90] flex max-h-[80dvh] max-w-md flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 rounded-lg border border-border px-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients"
            className="h-10 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/60 md:text-sm"
          />
        </label>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {suggested.length > 0 && (
            <>
              <div className="flex items-center gap-1 px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Sparkles className="h-3 w-3" /> {suggestedLabel}
              </div>
              <ul>{suggested.map((c) => row(c, "Suggested"))}</ul>
              <div className="my-2 h-px bg-border" />
            </>
          )}
          {isLoading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading clients…</p>
          ) : list.length === 0 && suggested.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No clients match.</p>
          ) : (
            <ul>{list.map((c) => row(c))}</ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
