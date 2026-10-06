import { createFileRoute } from "@tanstack/react-router";
import { BusinessSystemsRedirect } from "@/route-pages/_authenticated/admin/business-systems";

export const Route = createFileRoute("/_authenticated/admin/business-systems")({
  component: BusinessSystemsRedirect,
});
