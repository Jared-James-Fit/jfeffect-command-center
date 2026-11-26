import { createFileRoute } from "@tanstack/react-router";
import { PerformanceTab } from "@/components/specialist/performance-tab";

export const Route = createFileRoute("/_authenticated/specialist/performance")({
  head: () => ({ meta: [{ title: "Performance — JF Effect" }] }),
  component: PerformanceTab,
});
