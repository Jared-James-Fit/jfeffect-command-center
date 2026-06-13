import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyLegalStatus } from "@/lib/legal.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LifeBuoy, LogOut } from "lucide-react";
import { ClientLegalSafety } from "./client-legal-safety";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

/**
 * Portal-level legal gate.
 *
 * SAFETY: The gate only HARD-BLOCKS the portal when at least one outstanding
 * required document has effective_enforcement = 'full_portal_gate'. That mode
 * must be explicitly opted into by an admin AND enforcement_enabled AND past
 * effective_at. Workflow / onboarding / notice-only modes do NOT block the
 * portal here — they surface inside the workflow itself or in the Legal &
 * Safety centre.
 *
 * Even when blocked, the user can:
 *   - open Legal & Safety to review/accept
 *   - reach account support
 *   - sign out
 *
 * The global kill switch turns this off entirely (handled server-side in
 * legal_effective_enforcement → 'inactive').
 */
export function LegalAcceptanceGate() {
  const fn = useServerFn(listMyLegalStatus);
  const { data = [] } = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => fn(),
    staleTime: 60 * 1000,
  });

  // Only documents whose EFFECTIVE enforcement is 'full_portal_gate' AND
  // which the user has not accepted yet should hard-block the portal.
  const blocking = (data as any[]).filter(
    (d) => d.is_required && !d.accepted_at && d.effective_enforcement === "full_portal_gate",
  );
  const open = blocking.length > 0;
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Please review and accept to continue
          </DialogTitle>
          <DialogDescription>
            One or more required agreements must be accepted before continuing. You can review them below, contact support, or sign out.
          </DialogDescription>
        </DialogHeader>
        <ClientLegalSafety />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/portal/account"><LifeBuoy className="mr-1 h-4 w-4" /> Account support</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}