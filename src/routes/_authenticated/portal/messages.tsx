import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { MessageThread } from "@/components/message-thread";
import { NotificationBell } from "@/components/notification-bell";

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
    <div className="flex h-full min-h-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      {/* Slim chat header — coach identity, not a giant page hero */}
      <header className="flex items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/60 md:px-6">
        <img
          src="/logo.png"
          alt="Coach Jared"
          className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-border"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black tracking-tight">Coach Jared</div>
          <div className="truncate text-[11px] text-muted-foreground">Direct line · usually replies within a day</div>
        </div>
        <NotificationBell />
      </header>

      {!client ? (
        <div className="p-6">
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Your coach hasn't set up your profile yet. Messaging will be available once they do.
          </Card>
        </div>
      ) : (
        <MessageThread clientId={client.id} role="client" fullBleed />
      )}
    </div>
  );
}