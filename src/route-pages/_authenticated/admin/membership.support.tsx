import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Members' Support chats are rows in Messages → 1:1 Chats now (answered like
 * any chat), so the old Member Support page lands there.
 */
export function SupportInboxRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    nav({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });
  }, [nav]);
  return null;
}
