import { createFileRoute } from "@tanstack/react-router";
import { FilloutSubmissionsRedirect } from "@/route-pages/_authenticated/admin/fillout-submissions";

export const Route = createFileRoute("/_authenticated/admin/fillout-submissions")({
  component: FilloutSubmissionsRedirect,
});
