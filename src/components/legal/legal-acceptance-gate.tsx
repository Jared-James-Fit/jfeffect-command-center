import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyLegalStatus } from "@/lib/legal.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShieldAlert } from "lucide-react";
import { ClientLegalSafety } from "./client-legal-safety";

/**
 * Soft onboarding / re-acceptance gate.
 *
 * Surfaces required published legal documents the user has not yet accepted.
 * The dialog is modal but non-dismissible from the X — they must accept
 * required documents to proceed. Optional consents do NOT trigger this gate.
 *
 * Mounted once in the portal layout.
 */
export function LegalAcceptanceGate() {
  const fn = useServerFn(listMyLegalStatus);
  const { data = [] } = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => fn(),
    staleTime: 60 * 1000,
  });

  const outstanding = data.filter((d: any) => d.is_required && !d.accepted_at);
  const open = outstanding.length > 0;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideClose
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Please review and accept
          </DialogTitle>
          <DialogDescription>
            We've updated the agreements that apply to your account. Please review and accept the items below to continue using JF Effect.
          </DialogDescription>
        </DialogHeader>
        <ClientLegalSafety />
      </DialogContent>
    </Dialog>
  );
}