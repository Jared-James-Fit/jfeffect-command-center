import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { SalesPageEditor } from "@/components/admin/sales-page-editor";

export const Route = createFileRoute("/_authenticated/admin/sales/membership")({
  component: () => (
    <div className="space-y-5">
      <PageHeader title="Membership Sales Page" subtitle="Edit the public /join page that customers see." />
      <SalesPageEditor pageKey="join" />
    </div>
  ),
});