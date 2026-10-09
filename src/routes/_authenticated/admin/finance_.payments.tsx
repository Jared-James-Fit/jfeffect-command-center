import { createFileRoute } from "@tanstack/react-router";
import { FinancePayments } from "@/components/admin/finance/finance-payments";

export const Route = createFileRoute("/_authenticated/admin/finance_/payments")({
  head: () => ({ meta: [{ title: "Payments — JF Effect" }] }),
  component: FinancePayments,
});
