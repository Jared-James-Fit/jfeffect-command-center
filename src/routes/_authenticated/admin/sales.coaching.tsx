import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { SalesPageEditor } from "@/components/admin/sales-page-editor";

export const Route = createFileRoute("/_authenticated/admin/sales/coaching")({
  component: () => (
    <div className="space-y-5">
      <PageHeader title="Coaching Sales Page" subtitle="Edit the public /coaching page and configure the Apply CTA." />
      <SalesPageEditor pageKey="coaching" />
    </div>
  ),
});