import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { CLIENT_VIEW_HOME } from "@/lib/launch-home";
import { todayLocalISO } from "@/lib/today";
import { beginPov } from "@/lib/pov/pov-client";
import type { PovMode } from "@/lib/pov/pov-rules";
import { purgeClientData } from "@/lib/pov/purge-client-cache";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Client view straight onto a day's workout (today by default): the Workouts
 * page opens it when that day holds exactly one, else shows that day, where a
 * workout can be picked or moved. Logging there saves as the client.
 */
export function clientWorkoutHref(date: string = todayLocalISO()): string {
  return `/portal/workouts?open=${date}`;
}

/**
 * Open the app as a client ("View as client"), landing on `to` (default
 * Crew, where their app opens). Coming back out returns to the page you left from.
 *
 * Uses a full page load instead of navigate(): the portal reads the stored
 * POV on mount, and a client-side navigation can render the portal before the
 * impersonation state has propagated.
 */
export function useEnterClientPov() {
  const { role, viewOnly } = useAuth();
  const impersonation = useClientImpersonation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // A view-only login (or a team preview) can't open client view: the server refuses it.
  const canPov = (role === "admin" || role === "coach") && !viewOnly;

  const enter = async (
    clientId: string,
    opts: { to?: string; fallbackName?: string | null; mode?: PovMode } = {},
  ) => {
    if (busy || !canPov) return;
    setBusy(true);
    try {
      // One tap, nothing asked: the server decides (an admin any account, a coach only their
      // assigned clients; a refusal is on the access record) and it opens view-only.
      const { data } = await supabase.from("clients").select("user_id, full_name").eq("id", clientId).maybeSingle();
      const name = data?.full_name ?? opts.fallbackName ?? null;
      // Opening today's workout is logging a session: it starts with edits on.
      const logging = !!opts.to?.startsWith("/portal/workouts?open=");
      let pov;
      try {
        pov = await beginPov(clientId, { mode: opts.mode ?? (logging ? "edit" : "view") });
      } catch (e) {
        // no access (reassigned, removed): nothing about the account stays on this device
        purgeClientData(qc, [clientId, data?.user_id]);
        throw e;
      }
      if (!pov) {
        setBusy(false);
        return;
      }
      const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin/clients";
      impersonation.start({ id: clientId, user_id: data?.user_id ?? null, full_name: name, pov }, returnTo);
      if (!data?.user_id) {
        toast.message("Their account isn't set up yet, so most of it will be empty.");
      }
      window.location.href = opts.to ?? CLIENT_VIEW_HOME;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enter POV");
      setBusy(false);
    }
  };

  return { enter, busy, canPov };
}
