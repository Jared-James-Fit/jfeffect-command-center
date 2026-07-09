import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav, clientBottomNav } from "@/lib/admin-nav";
import { ClientPovBanner } from "@/components/client-pov-banner";
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat";
import { BroadcastPopupGate } from "@/components/broadcast-popup-gate";
import { ClientBirthdayCard } from "@/components/client-birthday-card";
import { EventPopupGate } from "@/components/events/event-popup-gate";
import { HomeScreenSetupGate } from "@/components/home-screen-setup-gate";
import { FormPopupGate } from "@/components/form-popup-gate";
import { LegalAcceptanceGate } from "@/components/legal/legal-acceptance-gate";

function PortalLayout() {
  useActivityHeartbeat();
  return (
    <>
      <ClientPovBanner />
      <AppShell items={clientNav} bottomItems={clientBottomNav} title="Client Portal">
        {/* Onboarding requirements (profile photo, basic info, training schedule,
            Goals & Setup) are surfaced as a non-blocking checklist on the Home
            page — they must never lock the portal. See
            <SetupChecklistBanner /> in /portal/index.tsx. */}
        <Outlet />
        <BroadcastPopupGate />
        <EventPopupGate />
        <FormPopupGate />
        <HomeScreenSetupGate />
        <LegalAcceptanceGate />
        {/* Birthday card mounts LAST so its dialog stacks above other portal
            gates (setup prompts, event/form popups). */}
        <ClientBirthdayCard />
      </AppShell>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalLayout,
});