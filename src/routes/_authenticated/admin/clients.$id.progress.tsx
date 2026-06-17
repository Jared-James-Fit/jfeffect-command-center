import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { ProgressSection } from "@/components/progress/progress-section";
import { CheckInScheduleCard } from "@/components/progress/check-in-schedule-card";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/progress")({
  component: AdminClientProgress,
});

function AdminClientProgress() {
  const { id } = useParams({ from: "/_authenticated/admin/clients/$id/progress" });
  const { role } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["admin-client-progress", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, user_id, preferred_weight_unit, assigned_coach_id")
        .eq("id", id).maybeSingle();
      return data;
    },
  });

  if (!client) {
    return (
      <>
        <PageHeader title="Client Progress" />
        <div className="p-6"><Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`${client.full_name ?? "Client"} — Progress`} subtitle="Photos, videos, weight, measurements." />
      <div className="px-3 md:px-6 pt-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/clients/$id" params={{ id }}><ChevronLeft className="h-4 w-4" />Back to client</Link>
        </Button>
      </div>
      <ProgressSection
        ctx={{
          userId: (client as any).user_id,
          ownerType: "client",
          clientId: client.id,
          memberId: null,
          assignedCoachId: (client as any).assigned_coach_id,
          viewerRole: role === "admin" ? "admin" : "coach",
          preferredWeightUnit: ((client as any).preferred_weight_unit as any) ?? "lb",
          canRequestReview: false,
        }}
      />
      {(client as any).user_id ? (
        <div className="px-3 md:px-6 pb-6">
          <CheckInScheduleCard
            userId={(client as any).user_id}
            readOnly={role !== "admin"}
            subtitle={role === "admin"
              ? "Set how often this client is reminded for each check-in."
              : "Cadence set by admin — read-only."}
          />
        </div>
      ) : null}
    </>
  );
}
