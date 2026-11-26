import { createFileRoute } from "@tanstack/react-router";
import { FootageTab } from "@/components/specialist/footage-tab";

export const Route = createFileRoute("/_authenticated/specialist/")({
  head: () => ({ meta: [{ title: "Footage — JF Effect" }] }),
  component: FootageTab,
});
