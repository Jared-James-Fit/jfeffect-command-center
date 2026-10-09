import { createFileRoute } from "@tanstack/react-router";
import { FinancePayments } from "@/components/admin/finance/finance-payments";
import { MoneySwitcher } from "@/components/admin/finance/money-switcher";

export const Route = createFileRoute("/_authenticated/admin/finance_/payments")({
  head: () => ({ meta: [{ title: "Payments — JF Effect" }] }),
  component: () => (
    <>
      <MoneySwitcher page="payments" />
      <FinancePayments />
    </>
  ),
});
