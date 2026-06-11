import { createFileRoute } from "@tanstack/react-router";
import { SalesPreviewPanel } from "@/components/media/sales-preview-panel";
export const Route = createFileRoute("/_authenticated/media/sales/coaching")({
  component: () => <SalesPreviewPanel pageKey="coaching" slug="coaching" title="Coaching Sales Page" />,
});