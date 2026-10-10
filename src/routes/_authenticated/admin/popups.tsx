import { createFileRoute } from "@tanstack/react-router";
import { PopupsSettingsPage } from "@/route-pages/_authenticated/admin/popups";

export const Route = createFileRoute("/_authenticated/admin/popups")({
  component: PopupsSettingsPage,
});
