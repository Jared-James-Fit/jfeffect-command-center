/**
 * Bulk-action Undo helper.
 *
 * Pairs with `pl_bulk_operations` (server) so Undo survives a refresh:
 * the recent operation list is fetched via `listRecentBulkOperations`.
 * The toast offers one-tap Undo for ~10 seconds; afterwards the user
 * can still find recent ops via the builder's "Recent operations" panel.
 */
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { undoBulkOperation } from "./pl-bulk.functions";

export interface BulkOperationDescriptor {
  operationId: string;
  /** Human-readable summary used in the toast. */
  label: string;
  /** Called after Undo succeeds — typically a queryClient.invalidateQueries(). */
  onUndone?: () => void | Promise<void>;
}

export function useBulkUndo() {
  const undo = useServerFn(undoBulkOperation);

  return (op: BulkOperationDescriptor) => {
    toast.success(op.label, {
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            await undo({ data: { operationId: op.operationId } });
            await op.onUndone?.();
            toast.success("Undone");
          } catch (err: any) {
            toast.error(err?.message ?? "Undo failed");
          }
        },
      },
    });
  };
}

/** Generate a stable operation id for a click. Use crypto.randomUUID. */
export function newOperationId(): string {
  // Fallback for older environments (very unlikely in this stack).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}