import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Legacy resource library route — superseded by /media/assets.
// Preserves any bookmarked URLs by redirecting in place. Existing
// data has been migrated transparently (same tables and storage).
export const Route = createFileRoute("/_authenticated/media/resources")({
  component: RedirectToAssets,
});

function RedirectToAssets() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/media/assets", replace: true });
  }, [navigate]);
  return null;
}
