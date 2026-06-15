import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Archive, Search, ExternalLink, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { listArchivedBlocks } from "@/lib/pl-programs";

export function WorkoutArchiveDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  clientName?: string | null;
}) {
  const [q, setQ] = useState("");
  const { data: blocks = [], isLoading } = useQuery({
    queryKey: ["archived-blocks", clientId],
    enabled: open,
    queryFn: () => listArchivedBlocks(clientId),
  });

  const filtered = useMemo(() => {
    const arr = (blocks as any[]).slice().sort(
      (a, b) =>
        new Date(b.archived_at ?? b.created_at).getTime() -
        new Date(a.archived_at ?? a.created_at).getTime(),
    );
    const needle = q.trim().toLowerCase();
    if (!needle) return arr;
    return arr.filter((b) => {
      const hay = [
        b.name,
        b.training_focus,
        b.training_style,
        b.notes,
        b.completion_method,
        b.start_date,
        b.end_date,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [blocks, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-primary" />
            Workout Archive
            {!isLoading && (
              <Badge variant="outline" className="ml-1 text-[10px]">
                {blocks.length}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {clientName ? `${clientName} · ` : ""}
            Browse past programs. Click one to open it in a new tab — this view
            stays put.
          </DialogDescription>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, focus, style, date…"
              className="pl-9 h-10"
            />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading archive…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {blocks.length === 0
                ? "No archived programs yet."
                : `No programs match "${q}".`}
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((b: any) => (
                <li key={b.id}>
                  <a
                    href={`/admin/blocks/${b.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3 transition hover:border-primary/40 hover:bg-secondary/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground">
                          {b.name || "Untitled program"}
                        </span>
                        {b.completion_method && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                          >
                            {b.completion_method === "manual"
                              ? "Manual"
                              : "Auto"}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {b.start_date && b.end_date
                          ? `${format(parseISO(b.start_date), "MMM d, yyyy")} – ${format(parseISO(b.end_date), "MMM d, yyyy")}`
                          : `${b.weeks ?? "?"} weeks`}
                        {b.weeks ? ` · ${b.weeks} weeks` : ""}
                        {b.training_focus ? ` · ${b.training_focus}` : ""}
                      </div>
                      {b.archived_at && (
                        <div className="text-[10px] text-muted-foreground">
                          Archived{" "}
                          {format(parseISO(b.archived_at), "MMM d, yyyy")}
                        </div>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}