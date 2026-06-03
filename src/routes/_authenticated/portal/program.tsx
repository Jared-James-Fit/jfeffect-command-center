import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, Heart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/program")({ component: MyProgram });

function MyProgram() {
  const { user } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: cardio = [] } = useQuery({
    queryKey: ["my-cardio", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cardio_targets").select("*").eq("client_id", client!.id)
        .neq("status", "Archived").order("start_date", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader title="My Program" subtitle={client?.program_phase ?? "Current training phase"} />
      <div className="p-6 md:p-8 space-y-6">
        <Card className="border-border bg-card p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-xl font-black">Your Training Program</h2>
          {client?.program_sheet_link ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">Opens in Google Sheets — bookmark it on your phone.</p>
              <a href={client.program_sheet_link} target="_blank" rel="noreferrer">
                <Button size="lg" className="mt-6 bg-gradient-primary font-bold uppercase">
                  Access My Program <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </a>
              {client.last_program_update && (
                <p className="mt-4 text-xs text-muted-foreground">Last updated {client.last_program_update}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Your coach hasn't linked your program yet. Check back soon.</p>
          )}
        </Card>

        {cardio.length > 0 && (
          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Heart className="h-4 w-4" /> Cardio Targets
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {cardio.map((c: any) => (
                <div key={c.id} className="rounded-md border border-border bg-secondary/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{c.cardio_type === "Custom" ? c.custom_type : c.cardio_type}</span>
                    <Badge variant="outline" className="text-[10px]">{c.start_date} → {c.end_date ?? "ongoing"}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {c.frequency_per_week && <Item label="Frequency" value={`${c.frequency_per_week}x / week`} />}
                    {c.duration_minutes && <Item label="Duration" value={`${c.duration_minutes} min`} />}
                    {c.intensity && <Item label="Intensity" value={c.intensity} />}
                    {c.heart_rate_zone && <Item label="HR Zone" value={c.heart_rate_zone} />}
                    {c.step_target && <Item label="Steps" value={c.step_target.toLocaleString()} />}
                    {c.machine_preference && <Item label="Machine" value={c.machine_preference} />}
                  </div>
                  {c.client_notes && <p className="mt-3 text-xs text-muted-foreground">{c.client_notes}</p>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}