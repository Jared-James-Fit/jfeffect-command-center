import { createFileRoute } from "@tanstack/react-router";
import { PagesPage } from "@/components/media/pages-page";
export const Route = createFileRoute("/_authenticated/media/pages")({
  component: PagesPage,
});