import { createFileRoute } from "@tanstack/react-router";
import { PerformancePage } from "@/components/media/performance-page";
export const Route = createFileRoute("/_authenticated/media/performance")({
  component: PerformancePage,
});