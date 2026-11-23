import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { UsagePage } from "@/components/admin/intel/usage-page";

/**
 * Usage & spend: AI and texts, cost and reliability, budgets and limits (Nov 23 2026). Admin only
 * (the server checks again); AI & Cleo keeps who has Cleo, the models and credit allowances.
 */
export const Route = createFileRoute("/_authenticated/admin/usage")({
  head: () => ({ meta: [{ title: "Usage & spend · JF Effect" }] }),
  component: UsageRoute,
});

function UsageRoute() {
  const { accountRole, loading } = useAuth();
  if (loading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (accountRole !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <PageHeader title="Usage & spend" />
        <Card className="p-4 text-[13px] text-muted-foreground">Only an admin can see this page.</Card>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="Usage & spend" />
      <UsagePage />
    </>
  );
}
