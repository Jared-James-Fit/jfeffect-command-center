import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Layers, Pencil } from "lucide-react";
import { listClientBlocks, getBlockTree } from "@/lib/pl-programs";
import { blockStatusTone, type CanonicalBlockStatus } from "@/lib/block-status";
import { cn } from "@/lib/utils";
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
  hasUnsavedChanges = false,
  currentBlockName,
  onDiscardUnsaved,
  statusMap,
}: {
  clientId: string;
  currentBlockId: string;
  /** Called before navigating away — use to save unsaved changes. */
  onBeforeNavigate?: () => Promise<void>;
  /** True when the current block editor has unsaved edits. */
  hasUnsavedChanges?: boolean;
  /** Display name of the current block, used in the confirm prompt. */
  currentBlockName?: string;
  /** Called when the coach chooses "Discard and switch" — must drop the
   *  local unsaved edits without touching the database. */
  onDiscardUnsaved?: () => void;
  /** Canonical per-block display statuses (deriveBlockStatuses). When
   *  omitted, falls back to the raw DB status. */
  statusMap?: Map<string, CanonicalBlockStatus>;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);

  const { data: blocks = [] } = useQuery({
    queryKey: ["pl-blocks", clientId],
    queryFn: () => listClientBlocks(clientId),
    staleTime: 30_000,
  });

  if (!blocks.length || blocks.length < 2) return null;

  const doNavigate = async (blockId: string) => {
    setSwitching(blockId);
    try {
      await navigate({ to: "/admin/blocks/$blockId", params: { blockId } });
    } finally {
      setSwitching(null);
    }
  };

  const handleClick = async (e: React.MouseEvent, blockId: string) => {
    if (blockId === currentBlockId || switching) return;
    e.preventDefault();
    // Unsaved-change protection: prompt before navigating so the coach
    // can save, discard, or cancel. Silent auto-save was hiding the
    // decision — coaches asked to see the choice explicitly.
    if (hasUnsavedChanges) {
      setPendingBlockId(blockId);
      return;
    }
    await doNavigate(blockId);
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
    <>
    <div className="flex w-full items-center gap-1.5 overflow-x-auto py-1 -mx-1 px-1">
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3" /> Blocks
      </span>
      {(blocks as any[]).map((b) => {
        const active = b.id === currentBlockId;
        const isSwitching = switching === b.id;
        const status: string | null = statusMap?.get(b.id) ?? b.status ?? null;
        const missingDates = !b.start_date && (status === "Upcoming" || status === "Draft");
        const dateRange = b.start_date
          ? `${b.start_date}${b.end_date ? ` → ${b.end_date}` : ""}`
          : "No dates scheduled";
        return (
          <button
            key={b.id}
            type="button"
            disabled={!!switching}
            title={`${b.name} · ${status ?? "—"} · ${dateRange}`}
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
                {active ? (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide opacity-90">
                    <Pencil className="h-2.5 w-2.5" /> Editing
                  </span>
                ) : (
                  status && (
                    <span className={cn("rounded-full border px-1 py-px text-[9px] font-semibold", blockStatusTone(status))}>
                      {status}
                    </span>
                  )
                )}
                {missingDates && (
                  <AlertTriangle
                    className="h-3 w-3 shrink-0 text-amber-500"
                    aria-label="No dates scheduled for this block"
                  />
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
    <AlertDialog
      open={!!pendingBlockId}
      onOpenChange={(v) => { if (!v) setPendingBlockId(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Unsaved changes in {currentBlockName ?? "this block"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Save your edits before switching, discard them, or stay on this block.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={async () => {
              const target = pendingBlockId;
              setPendingBlockId(null);
              if (onDiscardUnsaved) onDiscardUnsaved();
              if (target) await doNavigate(target);
            }}
          >
            Discard and switch
          </button>
          <AlertDialogAction
            onClick={async (e) => {
              e.preventDefault();
              const target = pendingBlockId;
              setPendingBlockId(null);
              try {
                if (onBeforeNavigate) await onBeforeNavigate();
              } catch (err) {
                // If saving failed, don't navigate — leave the coach on
                // the current block so they can fix and retry.
                // eslint-disable-next-line no-console
                console.error("[block-switcher] save-before-switch failed", err);
                return;
              }
              if (target) await doNavigate(target);
            }}
          >
            Save and switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}