import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/lib/auth";
import { roleRequiresMfa } from "@/lib/mfa-rules";
import { listAuthenticators, mfaErrorMessage, removeAuthenticator, type TotpFactor } from "@/lib/mfa";
import { billingDay } from "@/lib/date-range";
import { TotpSetup } from "@/components/two-step/totp-setup";

const KEY = ["mfa-authenticators"] as const;

/**
 * The login's authenticators (two-step sign-in, mfa-rules.ts): add a backup
 * (a second phone, or a password manager) so a lost phone never locks them
 * out, or remove one. The last one stays while the login needs it.
 */
export function TwoStepCard() {
  const { accountRole } = useAuth();
  const qc = useQueryClient();
  const required = roleRequiresMfa(accountRole);
  const { data: factors, isLoading, error } = useQuery({ queryKey: KEY, queryFn: listAuthenticators, staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TotpFactor | null>(null);
  const [busy, setBusy] = useState(false);

  const list = factors ?? [];
  const canRemove = list.length > 1 || !required;

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await removeAuthenticator(removing.id);
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Authenticator removed");
      setRemoving(null);
    } catch (e) {
      toast.error(mfaErrorMessage(e, "Couldn't remove it. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 rounded-2xl p-6" data-two-step-card>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        <h3 className="text-base font-semibold">Two-step sign-in</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        {required
          ? "Your login needs a code from an authenticator app when you sign in on a new device. Add a backup so a lost phone never locks you out."
          : "A code from an authenticator app when you sign in on a new device, as well as your password."}
      </p>

      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-destructive">{mfaErrorMessage(error, "Couldn't load your authenticators.")}</p>}

      {list.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {list.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
              <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{f.name.replace(/ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "")}</div>
                {f.createdAt && <div className="text-xs text-muted-foreground">Added {billingDay(f.createdAt.slice(0, 10))}</div>}
              </div>
              {canRemove && (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(f)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!isLoading && list.length === 1 && required && (
        <p className="text-xs text-muted-foreground">Only one authenticator. If you lose that phone you'll need a reset to get back in.</p>
      )}

      {adding ? (
        <div className="space-y-3 rounded-lg border p-4">
          <TotpSetup
            label={list.length ? "Backup authenticator" : "Authenticator app"}
            submitLabel="Add it"
            onDone={async () => {
              await qc.invalidateQueries({ queryKey: KEY });
              setAdding(false);
              toast.success("Authenticator added");
            }}
          />
          <Button variant="ghost" className="w-full" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} disabled={isLoading}>
          {list.length ? "Add a backup authenticator" : "Set up an authenticator"}
        </Button>
      )}

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this authenticator?</AlertDialogTitle>
            <AlertDialogDescription>
              Its codes stop working for JF Effect. {list.length > 1 ? "Your other one still works." : "You won't be asked for a code any more."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmRemove(); }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
