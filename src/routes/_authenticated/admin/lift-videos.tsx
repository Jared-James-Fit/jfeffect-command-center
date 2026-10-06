import { createFileRoute } from "@tanstack/react-router";
import { LiftVideosRedirect } from "@/route-pages/_authenticated/admin/lift-videos";

export const Route = createFileRoute("/_authenticated/admin/lift-videos")({
  component: LiftVideosRedirect,
});
