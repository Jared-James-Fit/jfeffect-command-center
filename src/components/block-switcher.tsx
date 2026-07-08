import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { listClientBlocks, getBlockTree } from "@/lib/pl-programs";
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
  onBeforeNavigate,
}: {
  clientId: string;
  currentBlockId: string;
  /** Called before navigating away — use to save unsaved changes. */
  onBeforeNavigate?: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);

  const { data: blocks = [] } = useQuery({
    queryKey: ["pl-blocks", clientId],
    queryFn: () => listClientBlocks(clientId),
    staleTime: 30_000,
  });

  if (!blocks.length || blocks.length < 2) return null;

  const handleClick = async (e: React.MouseEvent, blockId: string) => {
    if (blockId === currentBlockId || switching) return;
    e.preventDefault();
    setSwitching(blockId);
    try {
      if (onBeforeNavigate) {
        await onBeforeNavigate();
      }
      await navigate({ to: "/admin/blocks/$blockId", params: { blockId } });
    } finally {
      setSwitching(null);
    }
  };

  const handleMouseEnter = (blockId: string) => {
    if (blockId === currentBlockId) return;
    qc.prefetchQuery({
      queryKey: ["pl-block-tree", blockId],
      queryFn: () => getBlockTree(blockId),
      staleTime: 30_000,
    });
  };

  return (
    <div className="flex w-full items-center gap-1.5 overflow-x-auto py-1 -mx-1 px-1">
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3" /> Blocks
      </span>
      {(blocks as any[]).map((b) => {
        const active = b.id === currentBlockId;
        const isSwitching = switching === b.id;
        return (
          <button
            key={b.id}
            type="button"
            disabled={!!switching}
            title={`${b.name}${b.start_date ? ` · ${b.start_date}` : ""}`}
            onClick={(e) => handleClick(e, b.id)}
            onMouseEnter={() => handleMouseEnter(b.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : isSwitching
                  ? "border-primary/50 bg-secondary opacity-70 cursor-wait"
                  : "border-border bg-secondary/50 text-foreground hover:border-primary/50 hover:bg-secondary cursor-pointer",
            )}
          >
            {isSwitching ? (
              <>
                <svg className="h-3 w-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="max-w-[180px] truncate">{b.name}</span>
              </>
            ) : (
              <>
                <span className="max-w-[180px] truncate">{b.name}</span>
                {b.status && !active && (
                  <span className="text-[9px] text-muted-foreground">· {b.status}</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}