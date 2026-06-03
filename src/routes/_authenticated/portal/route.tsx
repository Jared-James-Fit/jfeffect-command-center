import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { clientNav } from "@/lib/admin-nav";

export const Route = createFileRoute("/_authenticated/portal")({
  component: () => (
    <AppShell items={clientNav} title="Client Portal">
      <Outlet />
    </AppShell>
  ),
});