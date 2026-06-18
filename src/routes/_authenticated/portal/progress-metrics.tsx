import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/progress-metrics")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/progress", hash: "bodyweight" });
  },
  component: () => null,
});

function PortalProgressMetrics() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client-progress", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, preferred_weight_unit").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  if (!client) {
    return (
      <>
        <PageHeader title="Progress Metrics" subtitle="Track your bodyweight and progress over time." />
        <div className="p-6 md:p-8">
          <Card className="border-border bg-card p-10 text-center">
            <Scale className="mx-auto h-10 w-10 text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Your client profile isn't set up yet. Once your coach adds you, you can log here.</p>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Progress Metrics" subtitle="Track your bodyweight and progress over time." />
      <div className="p-6 md:p-8 space-y-6">
        <ProgressMetricsPanel
          clientId={client.id}
          defaultUnit={(client.preferred_weight_unit as WeightUnit) ?? "lb"}
          canEdit
        />
        <ConnectHealthDeviceCard />
      </div>
    </>
  );
}