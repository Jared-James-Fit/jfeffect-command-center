import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getReceivables } from "@/lib/business-books.functions";
import type { OpenSaleRow } from "@/lib/business-books";
import type { Receivables } from "@/lib/books/receivables";

export const RECEIVABLES_KEY = ["books-receivables"];

/** What clients owe, read from each client's Billing (getReceivables). */
export function useReceivables() {
  const fn = useServerFn(getReceivables);
  return useQuery({ queryKey: RECEIVABLES_KEY, queryFn: () => fn() as Promise<Receivables>, staleTime: 60_000 });
}

/** Receivables as the finance pages' collect list rows: overdue first, then the biggest. */
export function owedRows(r: Receivables | null | undefined): OpenSaleRow[] {
  return (r?.lines ?? []).map((l) => ({
    id: l.saleId,
    client: l.client,
    offer: l.label,
    status: l.overdueCents > 0 ? "Overdue" : l.how === "auto_pay" ? "On auto-pay" : l.unscheduledCents > 0 ? "No payment dates" : "On schedule",
    outstandingMinor: l.outstandingCents,
    createdOn: l.overdueSince,
    clientId: l.clientId,
    rate: l.rate,
    nextCents: l.next?.cents ?? null,
    viaStripe: l.how === "auto_pay" || l.how === "stripe" || l.how === "subscription",
  }));
}
