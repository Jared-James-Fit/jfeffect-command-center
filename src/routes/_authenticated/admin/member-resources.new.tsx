import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { MemberResourceForm } from "@/components/member-resource-form";

export const Route = createFileRoute("/_authenticated/admin/member-resources/new")({ component: NewResource });

function NewResource() {
  return (
    <div className="space-y-5">
      <PageHeader title="New Resource" subtitle="Add a guide, PDF, video, link, or tool." />
      <MemberResourceForm />
    </div>
  );
}