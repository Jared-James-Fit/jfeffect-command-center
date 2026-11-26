import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { VirtualAccountsPage } from "@/components/admin/virtual-accounts/virtual-accounts-page";

/** Disclosed virtual Crew accounts (Crew → Virtual Accounts; also Settings → Developer tools). Admins only. */
export const Route = createFileRoute("/_authenticated/admin/virtual-accounts")({
  head: () => ({ meta: [{ title: "Virtual Crew accounts · JF Effect" }] }),
  component: () => (
    <>
      <PageHeader title="Virtual Crew accounts" backTo="/admin/community" />
      <VirtualAccountsPage />
    </>
  ),
});
