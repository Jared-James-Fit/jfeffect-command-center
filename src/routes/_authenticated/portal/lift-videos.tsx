import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/portal/lift-videos")({
  component: LiftReviewsToMessages,
});

function LiftReviewsToMessages() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/portal/messages", replace: true });
  }, [navigate]);

  return null;
}
