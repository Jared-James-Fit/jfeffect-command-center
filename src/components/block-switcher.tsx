import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { listClientBlocks } from "@/lib/pl-programs";
import { cn } from "@/lib/utils";

/**
 * Compact one-click switcher for jumping between every training block
 * that belongs to the same client. Drops into the block editor's sticky
 * toolbar so a coach can flip between "Block 1 — Accumulation",
 * "Block 2 — Intensification", etc. without going back to the client
 * program list first.
 *
 * Order matches listClientBlocks (sort_order, then created_at), so pills
 * appear in the same order as the client-programs page.
 */
export function BlockSwitcher({
  clientId,
  currentBlockId,
}: {
  clientId: string;
  currentBlockId: string;
}) {
  const { data: blocks = [] } = useQuery({
    queryKey: ["pl-blocks", clientId],
    queryFn: () => listClientBlocks(clientId),
    staleTime: 30_000,
  });

  if (!blocks.length || blocks.length < 2) return null;

  return (
    <div className="flex w-full items-center gap-1.5 overflow-x-auto py-1 -mx-1 px-1">
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3" /> Blocks
      </span>
      {(blocks as any[]).map((b) => {
        const active = b.id === currentBlockId;
        return (
          <Link
            key={b.id}
            to="/admin/blocks/$blockId"
            params={{ blockId: b.id }}
            title={`${b.name}${b.start_date ? ` · ${b.start_date}` : ""}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-secondary/50 text-foreground hover:border-primary/50 hover:bg-secondary",
            )}
          >
            <span className="max-w-[180px] truncate">{b.name}</span>
            {b.status && !active && (
              <span className="text-[9px] text-muted-foreground">· {b.status}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}