import { createFileRoute } from "@tanstack/react-router";
import { AutomationsHub } from "@/route-pages/_authenticated/admin/automations";

export const Route = createFileRoute("/_authenticated/admin/automations")({
  component: AutomationsHub,
});
