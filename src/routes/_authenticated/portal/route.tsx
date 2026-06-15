import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav, clientBottomNav } from "@/lib/admin-nav";
import { ClientProfilePictureGate } from "@/components/client-profile-picture-gate";
import { ClientPovBanner } from "@/components/client-pov-banner";
import { ClientBasicInfoGate } from "@/components/client-basic-info-gate";
import { ClientTrainingScheduleGate } from "@/components/client-training-schedule-gate";
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
        <ClientProfilePictureGate>
          <ClientBasicInfoGate>
            <ClientTrainingScheduleGate>
              <Outlet />
              <BroadcastPopupGate />
              <ClientBirthdayCard />
              <EventPopupGate />
              <FormPopupGate />
              <HomeScreenSetupGate />
              <LegalAcceptanceGate />
            </ClientTrainingScheduleGate>
          </ClientBasicInfoGate>
        </ClientProfilePictureGate>
      </AppShell>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalLayout,
});