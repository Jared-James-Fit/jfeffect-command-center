import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { lostAccess, purgeClientData } from "@/lib/pov/purge-client-cache";

const EVERY_MS = 3 * 60_000;

/**
 * A coach's access follows their assigned clients, and the database enforces it at once. This
 * keeps the device in step: every few minutes and when the app comes back, it reads which
 * clients the coach still reaches (coached_client_ids) and forgets everything loaded about any
 * that went (reassigned, removed), saved copy included, leaving their account if it was open.
 * Never for the admin (they reach everyone) and never with nobody signed in. Draws nothing.
 */
export function AccessRevocationWatch() {
  const { role, user } = useAuth() as { role: string | null; user: { id: string } | null };
  const qc = useQueryClient();
  const { client, isImpersonating, stop } = useClientImpersonation();
  const known = useRef<string[] | null>(null);
  const watching = role === "coach" && !!user?.id;

  useEffect(() => {
    if (!watching) {
      known.current = null;
      return;
    }
    let alive = true;
    const check = async () => {
      const { data, error } = await (supabase as any).rpc("coached_client_ids");
      if (!alive || error || !Array.isArray(data)) return;
      const now = (data as unknown[]).map((x) => (typeof x === "string" ? x : (x as any)?.coached_client_ids ?? String(x)));
      const before = known.current;
      known.current = now;
      if (!before) return;
      const gone = lostAccess(before, now);
      if (!gone.length) return;
      purgeClientData(qc, gone);
      if (isImpersonating && client && gone.includes(client.id)) stop();
    };
    void check();
    const t = window.setInterval(() => void check(), EVERY_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [watching, qc, isImpersonating, client, stop]);

  return null;
}
