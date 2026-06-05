import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav } from "@/lib/admin-nav";
import { ClientProfilePictureGate } from "@/components/client-profile-picture-gate";

export const Route = createFileRoute("/_authenticated/portal")({
  component: () => (
    <AppShell items={clientNav} title="Client Portal">
      <ClientProfilePictureGate>
        <Outlet />
      </ClientProfilePictureGate>
    </AppShell>
  ),
});