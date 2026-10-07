import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav, clientBottomNav } from "@/lib/admin-nav";
import { ClientPovBanner, PovFrame } from "@/components/client-pov-banner";
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat";
import { BroadcastPopupGate } from "@/components/broadcast-popup-gate";
import { ClientBirthdayCard } from "@/components/client-birthday-card";
import { EventPopupGate } from "@/components/events/event-popup-gate";
import { HomeScreenSetupGate } from "@/components/home-screen-setup-gate";
import { FormPopupGate } from "@/components/form-popup-gate";
import { LegalAcceptanceGate } from "@/components/legal/legal-acceptance-gate";
import { LeagueRecapGate } from "@/components/portal/league-recap";
import { useClientImpersonation } from "@/lib/client-impersonation";

function PortalLayout() {
  useActivityHeartbeat();
  const { isImpersonating } = useClientImpersonation();
  return (
    <>
      <PovFrame />
      <ClientPovBanner />
      <AppShell items={clientNav} bottomItems={clientBottomNav} title="Client Portal">
        {/* Onboarding requirements (profile photo, basic info, training schedule,
            Goals & Setup) are surfaced as a non-blocking checklist on the Home
            page — they must never lock the portal. See
            <SetupChecklistBanner /> in /portal/index.tsx. */}
        <Outlet />
        {/* Popup gates run off the signed-in session, so in coach "View as
            client" they'd show the coach's own popups/legal status — skip. */}
        {!isImpersonating && (
          <>
            <BroadcastPopupGate />
            <EventPopupGate />
            <FormPopupGate />
            <HomeScreenSetupGate />
            <LegalAcceptanceGate />
          </>
        )}
        {/* Previous month's League Recap — first week of each month, once. */}
        <LeagueRecapGate />
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