import { createFileRoute } from "@tanstack/react-router";
import { TaxesBooksPage } from "@/components/admin/books/taxes-books-page";
import { useAuth } from "@/lib/auth";

type Search = { tab?: string; filter?: string };

/**
 * Taxes & Books at its own path, so the finance login's Books tab shows as
 * selected (a ?tab= link never can). The data is guarded server-side by
 * finance.read, same as inside Sales.
 */
export const Route = createFileRoute("/_authenticated/admin/finance_/books")({
  head: () => ({ meta: [{ title: "Books — JF Effect" }] }),
  validateSearch: (raw: Record<string, unknown>): Search => ({
    tab: typeof raw?.tab === "string" ? raw.tab : undefined,
    filter: typeof raw?.filter === "string" ? raw.filter : undefined,
  }),
  component: FinanceBooks,
});

function FinanceBooks() {
  const { viewOnly } = useAuth();
  const { tab, filter } = Route.useSearch();
  return <TaxesBooksPage mode={viewOnly ? "finance" : "owner"} initialTab={tab} initialFilter={filter} />;
}
