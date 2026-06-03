import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/check-in")({ component: CheckIn });

function CheckIn() {
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
      <PageHeader title="Weekly Check-In" subtitle="Submit your week — your coach reviews every one." />
      <div className="p-6 md:p-8">
        <Card className="border-border bg-card p-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-xl font-black">Submit Weekly Check-In</h2>
          {client?.checkin_form_link ? (
            <a href={client.checkin_form_link} target="_blank" rel="noreferrer">
              <Button size="lg" className="mt-6 bg-gradient-primary font-bold uppercase">
                Open Check-In Form <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </a>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Your check-in form will appear here once your coach links it.</p>
          )}
        </Card>
      </div>
    </>
  );
}