import { createFileRoute } from "@tanstack/react-router";
import { AgreementsAdminRedirect } from "@/route-pages/_authenticated/admin/agreements.index";

export const Route = createFileRoute("/_authenticated/admin/agreements/")({
  component: AgreementsAdminRedirect,
});
