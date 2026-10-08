import { createFileRoute } from "@tanstack/react-router";
import { CrmDashboardPage } from "@/route-pages/_authenticated/admin/crm.index";

export const Route = createFileRoute("/_authenticated/admin/crm/")({
  component: CrmDashboardPage,
});
