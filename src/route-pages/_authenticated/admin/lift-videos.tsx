import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Lift reviews were retired: form checks happen in the chat (send the video
 * in Messages). Old links and pushes to /admin/lift-videos land in Messages.
 */
export function LiftVideosRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });
  }, [navigate]);
  return null;
}
