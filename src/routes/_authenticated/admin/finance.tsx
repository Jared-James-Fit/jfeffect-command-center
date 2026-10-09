import { createFileRoute } from "@tanstack/react-router";
import { FinanceHome } from "@/components/admin/finance/finance-home";

export const Route = createFileRoute("/_authenticated/admin/finance")({
  head: () => ({ meta: [{ title: "Finance — JF Effect" }] }),
  component: FinanceHome,
});
