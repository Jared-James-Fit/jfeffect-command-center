import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { memberNav } from "@/lib/admin-nav";
import { PovBanner, getPovFlag } from "@/components/admin-pov";
import { BroadcastPopupGate } from "@/components/broadcast-popup-gate";
import { SubscriptionRestrictedBanner } from "@/components/subscription-restricted-banner";
import { useMemberAccess } from "@/lib/member-access";

function MemberLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const pov = getPovFlag();
  const { status, subscriptionActive } = useMemberAccess();
  useEffect(() => {
    if (loading) return;
    if (role === "client") navigate({ to: "/portal", replace: true });
    // Admins are allowed into /m only while POV mode is active; otherwise send back to /admin.
    else if ((role === "admin" || role === "coach") && !pov.active) {
      navigate({ to: "/admin", replace: true });
    }
  }, [role, loading, navigate, pov.active]);
  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  return (
    <AppShell items={memberNav} title="Member">
      <PovBanner />
      {!subscriptionActive && status && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <SubscriptionRestrictedBanner status={status} />
        </div>
      )}
      <Outlet />
      <BroadcastPopupGate />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/m")({ component: MemberLayout });