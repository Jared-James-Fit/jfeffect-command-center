import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { MessageThread } from "@/components/message-thread";

export const Route = createFileRoute("/_authenticated/portal/messages")({
  component: ClientMessages,
});

function ClientMessages() {
  const portalUserId = usePortalUserId();

  const { data: client } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  return (
    <>
      <PageHeader title="Messages" subtitle="Direct line to Coach Jared." />
      <div className="space-y-4 p-6 md:p-8">
        {!client ? (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Your coach hasn't set up your profile yet. Messaging will be available once they do.
          </Card>
        ) : (
          <MessageThread clientId={client.id} role="client" />
        )}
      </div>
    </>
  );
}