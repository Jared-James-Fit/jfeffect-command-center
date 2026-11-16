import { createContext, useContext } from "react";
import type { BooksData, ExpenseRow, RevenueRow } from "@/lib/business-books";
import type { BooksSnapshot, ExpenseEntry, TaxSettings } from "@/lib/business-tax";
import type { CompareMode, Period } from "@/lib/books/period";
import type { LedgerFilter, MoneyFigures } from "@/lib/books/money-view";
import type { Receivables } from "@/lib/books/receivables";
import type { BooksMode } from "@/components/admin/books/books-mode";

export type MoneyView = "overview" | "transactions" | "taxes" | "reports";

export const MONEY_VIEWS: Array<{ key: MoneyView; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "transactions", label: "Transactions" },
  { key: "taxes", label: "Taxes" },
  { key: "reports", label: "Reports" },
];

export type MoneyCtx = {
  data: BooksData;
  mode: BooksMode;
  today: string;
  settings: TaxSettings;
  period: Period;
  compare: CompareMode;
  vs: { start: string; end: string; label: string } | null;
  revenue: RevenueRow[];
  expenses: ExpenseEntry[];
  figures: MoneyFigures;
  /** Income tax + CPP the period's profit adds to the year's estimate (periodTaxReserve). */
  reserve: { minor: number; ratesExact: boolean };
  prev: MoneyFigures | null;
  /** The tax year the period ends in, as Taxes & Books reads it. */
  snapshot: BooksSnapshot;
  receivables: Receivables | null;
  receivablesError: string | null;
  setPeriod: (p: Period) => void;
  go: (view: MoneyView, ledger?: Partial<LedgerFilter>) => void;
  /** What the Transactions view opens with (set by a tap elsewhere). */
  ledgerPreset: Partial<LedgerFilter> | null;
  openExpense: (row: ExpenseRow | "new") => void;
  snapReceipt: () => void;
  snapping: boolean;
  snapLabel: string;
  refresh: () => void;
};

export const MoneyContext = createContext<MoneyCtx | null>(null);

export function useMoney(): MoneyCtx {
  const ctx = useContext(MoneyContext);
  if (!ctx) throw new Error("useMoney outside MoneyWorkspace");
  return ctx;
}
