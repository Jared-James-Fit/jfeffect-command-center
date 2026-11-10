import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { RESTORE_DAYS, restoreGateCopy, selfDeleteCopy } from "@/lib/recently-deleted";

const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);
const PREVIEW = "Preview only: this is how it looks to them.";

/**
 * Account → Delete account: in the app, one sheet that says what happens
 * before the tap. Nothing is deleted on the spot: the account goes to
 * Recently deleted for 30 days (account_delete_request), they're signed out,
 * and signing back in before then offers Restore (AccountDeletionGate).
 */
export function DeleteAccountButton() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const copy = selfDeleteCopy();

  const confirm = async () => {
    setPending(true);
    try {
      const { error } = await rpc("account_delete_request", { _reason: reason.trim() || null });
      if (error) throw error;
      setOpen(false);
      toast.success(
        `Your account is in Recently deleted. Sign back in within ${RESTORE_DAYS} days to restore it.`,
        {
          duration: 10000,
        },
      );
      await signOut();
      navigate({ to: "/auth", replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete your account. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your account waits in Recently deleted for {RESTORE_DAYS} days first, so you can change
          your mind. After that it's deleted for good.
        </p>
        <Button
          variant="outline"
          className="h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => (isImpersonating ? toast.message(PREVIEW) : setOpen(true))}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete my account
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {copy.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Why are you leaving? (optional)"
            className="min-h-[72px] text-base"
            aria-label="Why are you leaving? (optional)"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              {copy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type PendingDeletion = {
  id: string;
  purge_after: string;
  requested_at: string;
  source: "self" | "admin";
};

/**
 * Signed in while your account is in Recently deleted: one screen over the
 * whole app with Restore (an account you deleted yourself: everything comes
 * back as it was; one an admin deleted: Contact support) or Sign out.
 * Asked once per sign-in (account_deletion_status); never in View as client,
 * and it shows nothing until it knows.
 */
export function AccountDeletionGate() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, signOut } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const [restoring, setRestoring] = useState(false);
  const { data } = useQuery({
    queryKey: ["account-deletion-status", user?.id ?? ""],
    enabled: !!user?.id && !isImpersonating,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PendingDeletion | null> => {
      const { data, error } = await rpc("account_deletion_status");
      if (error) return null; // never lock anyone out on a failed read
      return (data ?? null) as PendingDeletion | null;
    },
  });
  if (!data || isImpersonating) return null;
  const copy = restoreGateCopy(data);

  const restore = async () => {
    setRestoring(true);
    try {
      const { data: ok, error } = await rpc("account_delete_restore");
      if (error) throw error;
      if (!ok)
        throw new Error("There's nothing to restore. Contact support if your account is missing.");
      toast.success("Welcome back. Your account is restored.");
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't restore it. Try again.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-deletion-title"
      data-account-deletion-gate
    >
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted">
          <RotateCcw className="h-6 w-6" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 id="account-deletion-title" className="text-xl font-semibold">
            {copy.title}
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{copy.body}</p>
        </div>
        <div className="space-y-2">
          {data.source === "self" ? (
            <Button
              className="h-12 w-full text-[16px]"
              onClick={() => void restore()}
              disabled={restoring}
            >
              {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Restore my account
            </Button>
          ) : (
            <Button asChild className="h-12 w-full text-[16px]">
              <a href="mailto:support@jfeffect.com?subject=My%20JF%20Effect%20account">
                Contact support
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-11 w-full"
            disabled={restoring}
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth", replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
