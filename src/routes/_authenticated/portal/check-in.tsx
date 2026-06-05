import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ExternalLink, MessageCircle } from "lucide-react";

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

  const { data: assignedLink } = useQuery({
    queryKey: ["my-assigned-checkin-link", (client as any)?.assigned_check_in_link_id],
    enabled: !!(client as any)?.assigned_check_in_link_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("check_in_links" as any)
        .select("*")
        .eq("id", (client as any).assigned_check_in_link_id)
        .maybeSingle();
      return data as any;
    },
  });

  const link = assignedLink ?? null;
  const formUrl: string | null = link?.url ?? client?.checkin_form_link ?? null;
  const title: string = link?.title ?? "Weekly Check-In";
  const dueDay: string | null = link?.due_day ?? client?.checkin_due_day ?? null;
  const instructions: string | null = link?.description ?? client?.checkin_instructions ?? null;

  return (
    <>
      <PageHeader title="Weekly Check-In" subtitle="Coach Jared reviews every submission." />
      <div className="flex min-h-[60vh] items-center justify-center p-4 md:p-8">
        <Card className="w-full max-w-lg border-border bg-card p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-primary/10">
            <ClipboardCheck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mt-5 text-2xl font-black">{title}</h2>
          {dueDay && (
            <p className="mt-1 text-sm text-muted-foreground">Due: <span className="font-semibold text-foreground">{dueDay}</span></p>
          )}
          {instructions ? (
            <p className="mt-4 text-sm text-muted-foreground whitespace-pre-wrap">{instructions}</p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Tap the button below to fill out your weekly check-in form.</p>
          )}

          <div className="mt-8">
            {formUrl ? (
              <a href={formUrl} target="_blank" rel="noreferrer">
                <Button size="lg" className="bg-gradient-primary font-bold uppercase px-8 py-6 text-base">
                  Start Check-In <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </a>
            ) : (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm text-left">
                Your weekly check-in link has not been added yet. Message Coach Jared if you need help.
                <div className="mt-3">
                  <a href="/portal/messages">
                    <Button variant="outline" size="sm">
                      <MessageCircle className="mr-2 h-4 w-4" />Message Coach
                    </Button>
                  </a>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
