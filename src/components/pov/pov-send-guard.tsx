import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useClientImpersonation, useViewingAsClient } from "@/lib/client-impersonation";

/**
 * Safety net for coach/admin "View as client": anything sent from a client POV goes out
 * under the client's name. Ask first, so it can't happen on the wrong account by accident.
 *
 *   const povGuard = usePovSendGuard();
 *   if (!(await povGuard.confirm("what's being sent"))) return;   // no-op outside POV
 *   ...
 *   return <>{...}{povGuard.dialog}</>;
 */
export function usePovSendGuard(): {
  active: boolean;
  confirm: (preview?: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const viewingAsClient = useViewingAsClient();
  // POV state can outlive the portal (it's stored until you tap "Coach"), and staff messaging from
  // the admin screens is *supposed* to go out as staff. Only the client portal sends as the client.
  const inPortal = useRouterState({ select: (st) => st.location.pathname.startsWith("/portal") });
  const active = viewingAsClient && inPortal;
  const { client } = useClientImpersonation();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (text?: string) => {
      if (!active) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        // A second send while one is waiting cancels the first instead of stacking prompts.
        resolver.current?.(false);
        resolver.current = resolve;
        setPreview((text ?? "").trim());
        setOpen(true);
      });
    },
    [active],
  );

  const settle = (ok: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setOpen(false);
    r?.(ok);
  };

  const name = client?.full_name?.trim() || "this client";
  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
      <AlertDialogContent className="max-w-sm border-destructive/40">
        <AlertDialogHeader>
          <div className="mx-auto mb-1 grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </div>
          <AlertDialogTitle className="text-center">Send as {name}?</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            You're viewing as {name}. This message will go out under their name, not yours.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview ? (
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm">{preview}</div>
        ) : null}
        <AlertDialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <AlertDialogAction
            onClick={() => settle(true)}
            className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Yes, send as {name}
          </AlertDialogAction>
          <AlertDialogCancel onClick={() => settle(false)} className="mt-0 w-full">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { active, confirm, dialog };
}
