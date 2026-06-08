import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminGetResource } from "@/lib/member-resources.functions";
import { PageHeader } from "@/components/app-shell";
import { MemberResourceForm } from "@/components/member-resource-form";

export const Route = createFileRoute("/_authenticated/admin/member-resources/$resourceId")({ component: EditResource });

function EditResource() {
  const { resourceId } = Route.useParams();
  const fetchFn = useServerFn(adminGetResource);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-resource", resourceId],
    queryFn: () => fetchFn({ data: { id: resourceId } }),
  });
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.resource) return <div className="p-6 text-sm text-muted-foreground">Not found.</div>;
  return (
    <div className="space-y-5">
      <PageHeader title={data.resource.title} subtitle="Edit resource" />
      <MemberResourceForm initial={data.resource as any} />
    </div>
  );
}