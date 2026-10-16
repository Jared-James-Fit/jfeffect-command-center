import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { CLIENT_VIEW_HOME } from "@/lib/launch-home";

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
  const [busy, setBusy] = useState(false);
  // A view-only login (or a team preview) can't open client view: the server refuses it.
  const canPov = (role === "admin" || role === "coach") && !viewOnly;

  const enter = async (clientId: string, opts: { to?: string; fallbackName?: string | null } = {}) => {
    if (busy || !canPov) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("clients").select("user_id, full_name").eq("id", clientId).single();
      if (error) throw error;
      const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin/clients";
      impersonation.start({ id: clientId, user_id: data?.user_id ?? null, full_name: data?.full_name ?? opts.fallbackName ?? null }, returnTo);
      if (!data?.user_id) {
        toast.message("Entering POV preview — client account isn't set up yet, so personal data will be empty.");
      }
      window.location.href = opts.to ?? CLIENT_VIEW_HOME;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enter POV");
      setBusy(false);
    }
  };

  return { enter, busy, canPov };
}
