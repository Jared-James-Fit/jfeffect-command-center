import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The old Payments page is gone: what clients owe is Sales → Overview (and
 * each client's Billing), and money comes in only as payment rows. Its
 * address lands there.
 */
export function PaymentsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/sales", search: { tab: "overview" } as any, replace: true });
  }, [navigate]);
  return null;
}
