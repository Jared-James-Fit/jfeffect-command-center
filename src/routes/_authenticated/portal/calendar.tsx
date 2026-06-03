import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalIcon, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/calendar")({ component: CalendarPage });

function CalendarPage() {
  const { user } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle()).data,
  });
  return (
    <>
      <PageHeader title="Calendar" subtitle="Book a call with Jared." />
      <div className="p-6 md:p-8">
        <Card className="border-border bg-card p-8 text-center">
          <CalIcon className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-xl font-black">Book a Call</h2>
          {client?.calendar_link ? (
            <a href={client.calendar_link} target="_blank" rel="noreferrer">
              <Button size="lg" className="mt-6 bg-gradient-primary font-bold uppercase">
                Open Booking <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </a>
          ) : <p className="mt-2 text-sm text-muted-foreground">No calendar link set yet.</p>}
        </Card>
      </div>
    </>
  );
}