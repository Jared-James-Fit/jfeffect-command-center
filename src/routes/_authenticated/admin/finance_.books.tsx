import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { MoneySwitcher } from "@/components/admin/finance/money-switcher";
import { MoneyWorkspace } from "@/components/admin/money/money-workspace";
import type { MoneyView } from "@/components/admin/money/money-context";
import type { CompareMode } from "@/lib/books/period";

type Search = { view?: MoneyView; p?: string; cmp?: CompareMode; filter?: string };

const VIEWS: MoneyView[] = ["overview", "transactions", "taxes", "reports"];
/** The old Taxes & Books tabs → today's views. */
const OLD_TABS: Record<string, MoneyView> = { overview: "overview", expenses: "transactions", gst: "taxes", "year-end": "taxes", settings: "taxes" };

/**
 * The books at their own path, so the finance login's Books tab shows as
 * selected: Overview · Transactions · Taxes · Reports. The data is guarded
 * server-side by finance.read, same as inside Sales.
 */
export const Route = createFileRoute("/_authenticated/admin/finance_/books")({
  head: () => ({ meta: [{ title: "Books — JF Effect" }] }),
  validateSearch: (raw: Record<string, unknown>): Search => {
    const v = typeof raw?.view === "string" ? raw.view : typeof raw?.tab === "string" ? OLD_TABS[raw.tab] ?? raw.tab : undefined;
    return {
      view: VIEWS.includes(v as MoneyView) ? (v as MoneyView) : undefined,
      p: typeof raw?.p === "string" ? raw.p : undefined,
      cmp: ["previous", "last_year", "none"].includes(raw?.cmp as string) ? (raw.cmp as CompareMode) : undefined,
      filter: typeof raw?.filter === "string" ? raw.filter : undefined,
    };
  },
  component: FinanceBooks,
});

function FinanceBooks() {
  const { viewOnly } = useAuth();
  const { view, p, cmp, filter } = Route.useSearch();
  const navigate = useNavigate();
  // An old "receipts to check" link: Transactions, money out, what needs a look.
  const initialLedger = filter ? { type: "out" as const, attention: true } : null;
  return (
    <>
      <MoneySwitcher page="books" />
      <MoneyWorkspace
        tabs
        view={view ?? "overview"}
        periodCode={p}
        compare={cmp ?? "previous"}
        mode={viewOnly ? "finance" : "owner"}
        initialLedger={initialLedger}
        onState={(patch) =>
          navigate({
            to: "/admin/finance/books" as any,
            search: ((s: any) => ({ view: patch.view ?? s.view, p: patch.p ?? s.p, cmp: patch.cmp ?? s.cmp })) as any,
            replace: !patch.view,
          } as any)
        }
      />
    </>
  );
}
