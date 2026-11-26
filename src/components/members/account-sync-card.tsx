import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ISSUE_WORDS, syncSummary, type SyncIssueRow } from "@/lib/accounts/account-directory";
import { lastAccountSyncFn, reconcileAccountsFn } from "@/lib/accounts/account-directory.functions";

const SYNC_KEY = ["admin-account-sync"];

/**
 * Admin only: whether every account's login, athlete record and membership agree, from the last
 * check (account_sync_runs). Check again reads every account; Reconcile makes only the safe fixes
 * (a missing membership row, a missing athlete record) and lists the rest for a decision. Nothing
 * is deleted or merged.
 */
export function AccountSyncCard() {
  const qc = useQueryClient();
  const lastFn = useServerFn(lastAccountSyncFn);
  const runFn = useServerFn(reconcileAccountsFn);
  const [open, setOpen] = useState(false);
  const last = useQuery({ queryKey: SYNC_KEY, queryFn: () => lastFn(), staleTime: 60_000 });
  const run = useMutation({
    mutationFn: (apply: boolean) => runFn({ data: { apply } }),
    onSuccess: (out, apply) => {
      qc.setQueryData(SYNC_KEY, { ran_at: out.checked_at, applied: apply, accounts: out.accounts, issues: out.issues, fixed: out.fixed });
      void qc.invalidateQueries({ queryKey: ["admin-account-directory"] });
      toast.success(apply ? (out.fixed.length ? `Fixed ${out.fixed.length}` : "Nothing needed fixing") : "Checked every account");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't check the accounts"),
  });

  const issues: SyncIssueRow[] = (last.data?.issues ?? []) as SyncIssueRow[];
  const summary = syncSummary(issues);
  const real = issues.filter((i) => i.account_class === "real" && i.issues.some((x) => x !== "unconfirmed"));
  const ranAt = last.data?.ran_at ? new Date(last.data.ran_at) : null;

  return (
    <Card className="p-3.5" data-account-sync={last.data ? summary.state : "never"}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            !last.data ? "bg-muted text-muted-foreground" : summary.state === "ok" ? "bg-success/10 text-success" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {summary.state === "ok" && last.data ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {!last.data ? "Accounts not checked yet" : summary.state === "ok" ? "Every account is in sync" : `${real.length} account${real.length === 1 ? "" : "s"} need a look`}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {ranAt ? `Checked ${ranAt.toLocaleString()} · ${last.data?.accounts ?? 0} accounts` : "Logins, athlete records and memberships, checked against each other"}
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-9 shrink-0" disabled={run.isPending} onClick={() => run.mutate(false)}>
          {run.isPending && run.variables === false ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">Check</span>
        </Button>
        {real.length > 0 && (
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-muted"
            aria-expanded={open}
            aria-label="Show the accounts that need a look"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && real.length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {real.map((i) => (
            <div key={`${i.user_id}-${i.client_id}-${i.member_id}`} className="rounded-lg bg-muted/50 p-2.5 text-sm">
              <div className="font-medium">{i.name}</div>
              {i.issues
                .filter((x) => x !== "unconfirmed")
                .map((x) => (
                  <p key={x} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{ISSUE_WORDS[x]?.title ?? x}.</span> {ISSUE_WORDS[x]?.body}
                  </p>
                ))}
            </div>
          ))}
          {summary.fixable > 0 && (
            <Button className="h-10 w-full" disabled={run.isPending} onClick={() => run.mutate(true)}>
              {run.isPending && run.variables === true ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Reconcile {summary.fixable} that can be fixed safely
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Nothing is deleted or merged. Open an account from the list to decide the rest; test and demo logins can be marked from its ⋯.
          </p>
        </div>
      )}
    </Card>
  );
}
