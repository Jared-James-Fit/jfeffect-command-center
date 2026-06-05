import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav } from "@/lib/admin-nav";
import { ClientProfilePictureGate } from "@/components/client-profile-picture-gate";
import { ClientPovBanner } from "@/components/client-pov-banner";
import { ClientBasicInfoGate } from "@/components/client-basic-info-gate";

export const Route = createFileRoute("/_authenticated/portal")({
  component: () => (
    <>
      <ClientPovBanner />
      <AppShell items={clientNav} title="Client Portal">
        <ClientProfilePictureGate>
          <ClientBasicInfoGate>
            <Outlet />
          </ClientBasicInfoGate>
        </ClientProfilePictureGate>
      </AppShell>
    </>
  ),
});