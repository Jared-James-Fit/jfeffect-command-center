import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/components/media/campaigns-page";
export const Route = createFileRoute("/_authenticated/media/campaigns")({
  component: CampaignsPage,
});
