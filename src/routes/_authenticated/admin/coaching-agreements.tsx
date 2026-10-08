import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Loader2, MoreHorizontal, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientNameLink } from "@/components/clients/client-name-link";
import {
  adminAgreementRoster,
  adminClearAgreementExemption,
  adminRemindAgreement,
} from "@/lib/coaching-agreement.functions";
import type { RosterRow } from "@/lib/coaching-agreement/roster";
import {
  ADMIN_AGREEMENT_QUERY_ROOT,
  AgreementStatusChip,
  ExemptDialog,
  SendAgreementDialog,
} from "@/components/coaching-agreement/admin-agreement-parts";
import { AgreementRecordViewer } from "@/components/coaching-agreement/agreement-record-viewer";
import { EXEMPT_LABEL, formatSignedDate } from "@/components/coaching-agreement/agreement-copy";

export const Route = createFileRoute("/_authenticated/admin/coaching-agreements")({
  head: () => ({ meta: [{ title: "Coaching Agreements — JF Effect" }] }),
  component: CoachingAgreementsPage,
});

type Filter = "outstanding" | "signed" | "exempt" | "all";

function detailLine(row: RosterRow, currentVersion: string): string {
  switch (row.status) {
    case "signed":
      return `Version ${row.latestSignature?.version} signed ${row.latestSignature ? formatSignedDate(row.latestSignature.signedAt) : ""}`;
    case "never_signed":
      return row.legacy.signed
        ? `Earlier agreement on file${row.legacy.date ? ` (${row.legacy.date})` : ""}. Hasn't signed the in-app one.`
        : "No agreement on file";
    case "admin_request":
      return `Re-sign requested${row.resignRequestedAt ? ` ${formatSignedDate(row.resignRequestedAt)}` : ""}${row.resignNote ? ` · "${row.resignNote}"` : ""}`;
    case "new_version":
      return `Signed version ${row.latestSignature?.version}; current is ${currentVersion}`;
    case "exempt":
      return row.state.state === "exempt"
        ? `${EXEMPT_LABEL[row.state.kind]}${row.state.note ? `: ${row.state.note}` : ""}`
        : "";
    case "no_account":
      return "Hasn't created their app account yet";
  }
}

function CoachingAgreementsPage() {
  const rosterFn = useServerFn(adminAgreementRoster);
  const remindFn = useServerFn(adminRemindAgreement);
  const clearExemptionFn = useServerFn(adminClearAgreementExemption);
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [sendFor, setSendFor] = useState<RosterRow | null>(null);
  const [exemptFor, setExemptFor] = useState<RosterRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [ADMIN_AGREEMENT_QUERY_ROOT, "roster"],
    queryFn: () => rosterFn(),
    staleTime: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [ADMIN_AGREEMENT_QUERY_ROOT] });

  const bulk = useMutation({
    mutationFn: (clientIds: string[]) => remindFn({ data: { clientIds } }),
    onSuccess: (r) => {
      toast.success(
        r.reminded > 0
          ? `Reminded ${r.reminded} client${r.reminded === 1 ? "" : "s"} (${r.emailed} emailed, ${r.pushed} pushed)${
              r.skippedRecent ? `. Skipped ${r.skippedRecent} reminded in the last 24 hours.` : ""
            }`
          : r.skippedRecent
            ? `Nobody to remind: ${r.skippedRecent} were already reminded in the last 24 hours.`
            : "Nobody needs a reminder.",
      );
      setConfirmBulk(false);
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't send reminders"),
  });

  const unexempt = useMutation({
    mutationFn: (clientId: string) => clearExemptionFn({ data: { clientId } }),
    onSuccess: () => {
      toast.success("Exemption removed");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't remove"),
  });

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const counts = data?.counts;
  const activeFilter: Filter = filter ?? ((counts?.outstanding ?? 0) > 0 ? "outstanding" : "all");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        activeFilter === "outstanding" &&
        !["never_signed", "admin_request", "new_version"].includes(row.status)
      )
        return false;
      if (activeFilter === "signed" && row.status !== "signed") return false;
      if (activeFilter === "exempt" && row.status !== "exempt") return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || (row.email ?? "").toLowerCase().includes(q);
    });
  }, [rows, activeFilter, search]);

  const remindable = rows.filter((r) => r.state.state === "needs_signature" && r.hasAccount);

  const chips: { id: Filter; label: string; n: number }[] = [
    { id: "outstanding", label: "Needs signature", n: counts?.outstanding ?? 0 },
    { id: "signed", label: "Signed", n: counts?.signed ?? 0 },
    { id: "exempt", label: "Paper / not required", n: counts?.exempt ?? 0 },
    { id: "all", label: "All", n: counts?.total ?? 0 },
  ];

  return (
    <>
      <PageHeader
        title="Coaching Agreements"
        subtitle="Who has signed, who hasn't, and a signed copy of every agreement."
        actions={
          <Button
            type="button"
            onClick={() => setConfirmBulk(true)}
            disabled={remindable.length === 0 || bulk.isPending}
            className="h-10"
          >
            {bulk.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="mr-2 h-4 w-4" />
            )}
            Remind {remindable.length > 0 ? `${remindable.length} unsigned` : "unsigned"}
          </Button>
        }
      />

      <div className="space-y-4 p-4 md:p-8">
        <Card className="border-border bg-card p-4 text-sm text-muted-foreground">
          Every client with an app account is asked to sign the current agreement (version{" "}
          {data?.currentVersion ?? "…"}). They see a popup each time they open the app and a card on
          their dashboard until they do. Signing also updates the agreement status shown on the sale
          dialog and purchase pages.
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={activeFilter === chip.id}
              className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold transition-colors ${
                activeFilter === chip.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card"
              }`}
            >
              {chip.label} <span className="opacity-70">{chip.n}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients"
            className="h-11 pl-9 text-base"
            aria-label="Search clients"
          />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <Card className="space-y-3 border-border bg-card p-6 text-sm">
            <p className="text-muted-foreground">
              {(error as Error)?.message?.includes("Forbidden")
                ? "Only admins can open this page."
                : `Couldn't load the roster: ${(error as Error)?.message ?? "unknown error"}`}
            </p>
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </Card>
        )}

        {!isLoading && !isError && visible.length === 0 && (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            {activeFilter === "outstanding"
              ? "Everyone has signed. Nothing to chase."
              : "No clients match."}
          </Card>
        )}

        <ul className="space-y-2">
          {visible.map((row) => (
            <li key={row.clientId} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <ClientNameLink
                    clientId={row.clientId}
                    tab="documents"
                    className="block truncate text-[15px] font-semibold hover:text-primary"
                  >
                    {row.name}
                  </ClientNameLink>
                  <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                </div>
                <AgreementStatusChip status={row.status} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {detailLine(row, data?.currentVersion ?? "")}
              </p>
              {row.lastRemindedAt && row.state.state === "needs_signature" && (
                <p className="text-xs text-muted-foreground">
                  Last reminded {formatSignedDate(row.lastRemindedAt)} ({row.reminderCount}×)
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {row.latestSignature && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => setViewing(row.latestSignature!.id)}
                  >
                    View signed copy
                  </Button>
                )}
                {row.hasAccount && row.state.state !== "exempt" && (
                  <Button type="button" size="sm" className="h-9" onClick={() => setSendFor(row)}>
                    {row.state.state === "signed" ? "Send another" : "Send / remind"}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`More actions for ${row.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.state.state !== "exempt" ? (
                      <DropdownMenuItem onSelect={() => setExemptFor(row)}>
                        Stop asking (signed on paper / not required)
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => unexempt.mutate(row.clientId)}>
                        Remove exemption
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {sendFor && (
        <SendAgreementDialog
          clientId={sendFor.clientId}
          clientName={sendFor.name}
          alreadySigned={sendFor.state.state === "signed"}
          open
          onOpenChange={(o) => !o && setSendFor(null)}
        />
      )}
      {exemptFor && (
        <ExemptDialog
          clientId={exemptFor.clientId}
          clientName={exemptFor.name}
          open
          onOpenChange={(o) => !o && setExemptFor(null)}
        />
      )}
      <AgreementRecordViewer
        signatureId={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />

      <AlertDialog open={confirmBulk} onOpenChange={(o) => !bulk.isPending && setConfirmBulk(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remind {remindable.length} client{remindable.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each gets an email and a push notification asking them to sign. Anyone reminded in the
              last 24 hours is skipped, so you can't accidentally spam them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulk.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulk.isPending}
              onClick={(e) => {
                e.preventDefault();
                bulk.mutate(remindable.map((r) => r.clientId));
              }}
            >
              {bulk.isPending ? "Sending…" : "Send reminders"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
