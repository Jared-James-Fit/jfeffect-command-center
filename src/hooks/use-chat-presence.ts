import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { SenderRole } from "@/lib/messages";

/** Realtime presence for a single 1:1 conversation.
 *  Each side joins `chat-presence:{clientId}` and tracks itself by role.
 *  Returns `peerLive` = true while the opposite role is in the chat. */
export function useChatPresence(
  clientId: string | null | undefined,
  myRole: SenderRole,
) {
  const { user } = useAuth();
  const [peerLive, setPeerLive] = useState(false);

  useEffect(() => {
    if (!clientId || !user) {
      setPeerLive(false);
      return;
    }
    const peerRole: SenderRole = myRole === "admin" ? "client" : "admin";
    const channel = supabase.channel(`chat-presence:${clientId}`, {
      config: { presence: { key: `${myRole}:${user.id}` } },
    });

    const recompute = () => {
      const state = channel.presenceState() as Record<string, Array<{ role?: string }>>;
      let found = false;
      for (const k of Object.keys(state)) {
        if (k.startsWith(`${peerRole}:`)) { found = true; break; }
        const arr = state[k];
        if (arr?.some((p) => p?.role === peerRole)) { found = true; break; }
      }
      setPeerLive(found);
    };

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ role: myRole, user_id: user.id, at: Date.now() });
        }
      });

    return () => {
      try { void channel.untrack(); } catch {}
      supabase.removeChannel(channel);
      setPeerLive(false);
    };
  }, [clientId, myRole, user?.id]);

  return { peerLive };
}

/** Pulsing green dot — call out an active/live peer. */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="Live"
      className={
        "relative inline-flex h-2 w-2 shrink-0 " + className
      }
    >
      <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-60 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
    </span>
  );
}