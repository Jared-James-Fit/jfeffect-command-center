import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelAccountDeletion, exportMyData, getMyDeletionRequest, requestAccountDeletion } from "@/lib/my-data.functions";

const KEY = ["my-deletion-request"];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** "Your data": download everything, or ask for the account to be deleted (30-day hold). */
export function MyDataCard() {
  const qc = useQueryClient();
  const exportFn = useServerFn(exportMyData);
  const getReq = useServerFn(getMyDeletionRequest);
  const requestFn = useServerFn(requestAccountDeletion);
  const cancelFn = useServerFn(cancelAccountDeletion);
  const { data: pending, isLoading } = useQuery({ queryKey: KEY, queryFn: () => getReq() });
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function download() {
    setExporting(true);
    try {
      const data = await exportFn();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jf-effect-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't build your export");
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await requestFn({ data: {} });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Deletion requested. You can cancel any time in the next 30 days.");
      setConfirming(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't request deletion");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelFn();
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Deletion cancelled. Your account stays.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Your data</h3>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Download your training logs, PRs, bodyweight and check-ins as a file.
        </p>
        <Button variant="outline" size="sm" onClick={download} disabled={exporting}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {exporting ? "Preparing…" : "Download my data"}
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">Delete account</span>
        </div>
        {isLoading ? null : pending ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your account is set to be deleted after <span className="font-medium text-foreground">{fmtDate(pending.delete_after)}</span>.
              Until then everything still works, and you can change your mind.
            </p>
            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>Cancel deletion</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              We hold deletion requests for 30 days so you can change your mind, then remove your account and personal data.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>Delete my account</Button>
          </>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account will be deleted in 30 days. You can cancel any time before then from this page.
              Download your data first if you want to keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDelete(); }} disabled={busy}>
              Request deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
