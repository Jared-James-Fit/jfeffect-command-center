import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { SenderRole } from "@/lib/messages";

/** Realtime presence for a single 1:1 conversation.
 *  Each side joins `chat-presence:{clientId}` to see the other, but only
 *  counts as there itself (tracks) while `inConversation` is true and the app
 *  is on screen: the chat is actually open, not the list, another tab, or the
 *  app in the background. Returns `peerLive` = true while the opposite role
 *  is in the chat. */
export function useChatPresence(
  clientId: string | null | undefined,
  myRole: SenderRole,
  inConversation = true,
) {
  const { user } = useAuth();
  const [peerLive, setPeerLive] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const here = inConversation && visible;
  const hereRef = useRef(here);
  hereRef.current = here;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onVis);
    window.addEventListener("pageshow", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, []);

  useEffect(() => {
    if (!clientId || !user) {
      setPeerLive(false);
      return;
    }
    const peerRole: SenderRole = myRole === "admin" ? "client" : "admin";
    const channel = supabase.channel(`chat-presence:${clientId}`, {
      config: {
        private: true,
        presence: { key: `${myRole}:${user.id}` },
      },
    });
    channelRef.current = channel;
    subscribedRef.current = false;

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
          subscribedRef.current = true;
          if (hereRef.current) void channel.track({ role: myRole, user_id: user.id, at: Date.now() });
        }
      });

    return () => {
      try { void channel.untrack(); } catch {}
      supabase.removeChannel(channel);
      channelRef.current = null;
      subscribedRef.current = false;
      setPeerLive(false);
    };
  }, [clientId, myRole, user?.id]);

  // Opening / leaving the conversation (or the app going to the background)
  // starts / stops counting as there, without dropping the channel.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !subscribedRef.current || !user) return;
    if (here) void ch.track({ role: myRole, user_id: user.id, at: Date.now() });
    else void ch.untrack();
  }, [here, myRole, user?.id]);

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