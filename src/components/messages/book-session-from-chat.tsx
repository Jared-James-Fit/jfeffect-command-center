import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lazyWithRetry } from "@/lib/lazy-chunk";

/** The booking dialog, loaded the first time the coach opens it from a chat (the chat stays light). */
export const ChatBookingDialog = lazyWithRetry(() =>
  import("@/components/pt-session-dialog").then((m) => ({ default: m.PtSessionDialog })),
);

/**
 * Book a session from the coach's chat with a client (the + menu's Book
 * Session): the same booking dialog as the calendar, already on this client,
 * so Charge for it puts the payment card right in this chat.
 */
export function BookSessionFromChat({ clientId, open, onOpenChange }: { clientId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { if (open) setMounted(true); }, [open]);
  const { data: client } = useQuery({
    queryKey: ["chat-book-client", clientId],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () =>
      (await supabase
        .from("clients")
        .select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used")
        .eq("id", clientId)
        .maybeSingle()).data as any,
  });
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <ChatBookingDialog open={open} onOpenChange={onOpenChange} clientId={clientId} clients={client ? [client] : []} />
    </Suspense>
  );
}
