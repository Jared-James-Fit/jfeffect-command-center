import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { getSignupStats } from "@/lib/membership-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/membership/signup-stats")({
  component: SignupStats,
});

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-black">{value}</div>
    </Card>
  );
}

function SignupStats() {
  const fetch = useServerFn(getSignupStats);
  const { data, isLoading } = useQuery({ queryKey: ["jf-signup-stats"], queryFn: () => fetch() });
  return (
    <MembershipLeaf title="Signup Stats" subtitle="Track JF Membership growth over time.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Last 7 days" value={isLoading ? "…" : data?.last_7_days ?? 0} />
        <Tile label="Last 30 days" value={isLoading ? "…" : data?.last_30_days ?? 0} />
        <Tile label="Last 90 days" value={isLoading ? "…" : data?.last_90_days ?? 0} />
        <Tile label="All time" value={isLoading ? "…" : data?.all_time ?? 0} />
        <Tile label="Churn (30d)" value={isLoading ? "…" : data?.churn_30d ?? 0} />
      </div>
    </MembershipLeaf>
  );
}