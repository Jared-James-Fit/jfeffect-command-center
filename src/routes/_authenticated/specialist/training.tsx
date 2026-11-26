import { createFileRoute } from "@tanstack/react-router";
import { TrainingTab } from "@/components/specialist/training-tab";

export const Route = createFileRoute("/_authenticated/specialist/training")({
  head: () => ({ meta: [{ title: "Training — JF Effect" }] }),
  component: TrainingTab,
});
