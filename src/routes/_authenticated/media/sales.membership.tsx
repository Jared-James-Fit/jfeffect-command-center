import { createFileRoute } from "@tanstack/react-router";
import { SalesPreviewPanel } from "@/components/media/sales-preview-panel";
export const Route = createFileRoute("/_authenticated/media/sales/membership")({
  component: () => <SalesPreviewPanel pageKey="membership" slug="join" title="JF Membership Sales Page" />,
});