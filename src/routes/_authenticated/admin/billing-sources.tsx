import { createFileRoute } from "@tanstack/react-router";
import { BillingSourcesPage } from "@/route-pages/_authenticated/admin/billing-sources";

export const Route = createFileRoute("/_authenticated/admin/billing-sources")({
  component: BillingSourcesPage,
  head: () => ({
    meta: [
      { title: "Billing Sources & Legacy Migration · Admin · JF Effect" },
      { name: "description", content: "Manage dual billing sources and legacy Trainerize client migration into the JF Effect app." },
    ],
  }),
});
