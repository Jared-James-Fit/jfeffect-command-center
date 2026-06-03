import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText } from "lucide-react";

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

  return (
    <>
      <PageHeader title="My Program" subtitle={client?.program_phase ?? "Current training phase"} />
      <div className="p-6 md:p-8">
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
      </div>
    </>
  );
}