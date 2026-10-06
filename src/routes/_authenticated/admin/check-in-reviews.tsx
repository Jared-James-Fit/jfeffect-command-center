import { createFileRoute } from "@tanstack/react-router";
import { CheckInReviewsRedirect } from "@/route-pages/_authenticated/admin/check-in-reviews";

export const Route = createFileRoute("/_authenticated/admin/check-in-reviews")({
  component: CheckInReviewsRedirect,
});
