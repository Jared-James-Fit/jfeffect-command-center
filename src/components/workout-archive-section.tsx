import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Archive, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { listArchivedBlocks, getBlockSummary, unarchiveBlock } from "@/lib/pl-programs";

type Mode = "admin" | "client";
type SortKey = "newest" | "oldest" | "name" | "range" | "completion";

export function WorkoutArchiveSection({ clientId, mode }: { clientId: string; mode: Mode }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>("newest");
  const [open, setOpen] = useState(false);
  const { data: blocks = [] } = useQuery({
    queryKey: ["archived-blocks", clientId],
    queryFn: () => listArchivedBlocks(clientId),
  });

  const sorted = useMemo(() => {
    const arr = [...(blocks as any[])];
    arr.sort((a, b) => {
      switch (sort) {
        case "oldest": return new Date(a.archived_at ?? a.created_at).getTime() - new Date(b.archived_at ?? b.created_at).getTime();
        case "name": return (a.name ?? "").localeCompare(b.name ?? "");
        case "range": {
          const ad = a.start_date ?? "";
          const bd = b.start_date ?? "";
          return bd.localeCompare(ad);
        }
        case "completion": return (a.completion_method ?? "").localeCompare(b.completion_method ?? "");
        default: return new Date(b.archived_at ?? b.created_at).getTime() - new Date(a.archived_at ?? a.created_at).getTime();
      }
    });
    return arr;
  }, [blocks, sort]);

  if (sorted.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left hover:bg-secondary/30"
      >
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Workout Archive</h3>
          <Badge variant="outline" className="text-[10px]">{sorted.length}</Badge>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <div className="flex justify-end">
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Block name</SelectItem>
                <SelectItem value="range">Date range</SelectItem>
                <SelectItem value="completion">Completion status</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
        {sorted.map((b: any) => (
          <ArchivedRow key={b.id} block={b} mode={mode} onUnarchive={async () => {
            try {
              await unarchiveBlock(b.id);
              qc.invalidateQueries({ queryKey: ["archived-blocks", clientId] });
              qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
              toast.success("Block restored");
            } catch (e: any) { toast.error(e.message); }
          }} />
        ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ArchivedRow({ block, mode, onUnarchive }: { block: any; mode: Mode; onUnarchive: () => void }) {
  const { data: summary } = useQuery({
    queryKey: ["block-summary", block.id],
    queryFn: () => getBlockSummary(block.id),
  });
  const inner = (
    <div className="flex-1 rounded-md border border-border bg-secondary/30 p-3 hover:bg-secondary/50 transition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold">{block.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {block.start_date && block.end_date
              ? `${format(parseISO(block.start_date), "MMM d, yyyy")} – ${format(parseISO(block.end_date), "MMM d, yyyy")}`
              : block.weeks + " weeks"}
            {" · "}{block.weeks} weeks
            {block.completion_method ? ` · ${block.completion_method === "manual" ? "Manually" : "Auto"} completed` : ""}
          </div>
          {summary && (
            <div className="text-[11px] text-muted-foreground">
              {summary.completed_workouts}/{summary.total_workouts} workouts · {summary.progress_pct}% complete
            </div>
          )}
          {block.archived_at && (
            <div className="text-[10px] text-muted-foreground">Archived {format(parseISO(block.archived_at), "MMM d, yyyy")}</div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </div>
  );
  return (
    <div className="flex items-stretch gap-1">
      {mode === "admin" ? (
        <Link to="/admin/blocks/$blockId" params={{ blockId: block.id }} className="flex-1 min-w-0">{inner}</Link>
      ) : (
        <Link to="/portal/workouts" className="flex-1 min-w-0">{inner}</Link>
      )}
      {mode === "admin" && (
        <Button variant="ghost" size="icon" className="h-auto w-9" title="Restore from archive" onClick={onUnarchive}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}