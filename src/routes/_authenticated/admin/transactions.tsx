import { createFileRoute } from "@tanstack/react-router";
import { AdminTransactionsPage } from "@/route-pages/_authenticated/admin/transactions";

export const Route = createFileRoute("/_authenticated/admin/transactions")({
  component: () => <AdminTransactionsPage />,
});
