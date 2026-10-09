import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scanReceipt } from "@/lib/business-books.functions";
import type { ExpenseRow } from "@/lib/business-books";
import { uploadReceiptFile } from "@/lib/receipt-upload";

export const BOOKS_KEY = ["books-data"];

export type SnapResult = { count: number; last: ExpenseRow | null; filed: number; unread: number };

/**
 * Snap receipt: upload each photo/PDF, let Cleo read it into an expense, then
 * refresh the books. Shared by Taxes & Books and the finance home.
 */
export function useSnapReceipts() {
  const qc = useQueryClient();
  const scanFn = useServerFn(scanReceipt);
  const [scanState, setScanState] = useState<{ done: number; total: number } | null>(null);

  const snap = async (files: FileList | null): Promise<SnapResult | null> => {
    const list = Array.from(files ?? []);
    if (!list.length) return null;
    setScanState({ done: 0, total: list.length });
    let last: ExpenseRow | null = null;
    let filed = 0;
    let unread = 0;
    for (const [i, file] of list.entries()) {
      try {
        const { path, mime } = await uploadReceiptFile(file);
        const res: any = await scanFn({ data: { path, mime } });
        last = res.expense as ExpenseRow;
        if (res.read && last.status === "reviewed") filed++;
        else unread++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      }
      setScanState({ done: i + 1, total: list.length });
    }
    setScanState(null);
    await qc.invalidateQueries({ queryKey: BOOKS_KEY });
    return { count: list.length, last, filed, unread };
  };

  const label = scanState
    ? `Reading ${scanState.done + (scanState.done < scanState.total ? 1 : 0)} of ${scanState.total}`
    : "Snap receipt";

  return { snap, scanning: !!scanState, label };
}
