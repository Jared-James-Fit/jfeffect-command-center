import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSignature, History, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  adminCancelAgreementRequest,
  adminClearAgreementExemption,
  adminClientAgreementDetail,
} from "@/lib/coaching-agreement.functions";
import { rosterStatusOf } from "@/lib/coaching-agreement/rules";
import {
  ADMIN_AGREEMENT_QUERY_ROOT,
  AgreementStatusChip,
  ExemptDialog,
  Section,
  SendAgreementDialog,
} from "./admin-agreement-parts";
import { AgreementRecordViewer } from "./agreement-record-viewer";
import { EXEMPT_LABEL, formatSignedDate, formatSignedDateTime } from "./agreement-copy";

const EVENT_LABEL: Record<string, string> = {
  signed: "Client signed",
  requested: "Agreement sent to client",
  request_cancelled: "Request cancelled",
  exempted: "Marked not required",
  exemption_removed: "Exemption removed",
  reminded: "Reminder sent",
  receipt_emailed: "Receipt emailed to client",
};

/**
 * Per-client Coaching Agreement panel for the admin client workspace: status, the
 * signed copy, "send another one", and the paper / not-required exemption.
 */
export function ClientAgreementPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string | null;
}) {
  const name = clientName?.trim() || "this client";
  const queryClient = useQueryClient();
  const detailFn = useServerFn(adminClientAgreementDetail);
  const cancelRequest = useServerFn(adminCancelAgreementRequest);
  const clearExemption = useServerFn(adminClearAgreementExemption);
  const [viewing, setViewing] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [exemptOpen, setExemptOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [ADMIN_AGREEMENT_QUERY_ROOT, "detail", clientId],
    queryFn: () => detailFn({ data: { clientId } }),
    staleTime: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [ADMIN_AGREEMENT_QUERY_ROOT] });
  const cancel = useMutation({
    mutationFn: () => cancelRequest({ data: { clientId } }),
    onSuccess: () => {
      toast.success("Request cancelled");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't cancel"),
  });
  const unexempt = useMutation({
    mutationFn: () => clearExemption({ data: { clientId } }),
    onSuccess: () => {
      toast.success("Exemption removed");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't remove"),
  });

  if (isLoading) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        Loading agreement…
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        Couldn't load the Coaching Agreement: {(error as Error | null)?.message ?? "unknown error"}
      </Card>
    );
  }

  const status = rosterStatusOf(data.state, data.hasAccount);
  const latest = data.signatures[0];
  const outstanding = data.state.state === "needs_signature";

  return (
    <Card className="space-y-5 border-border bg-card p-6" data-testid="client-agreement-panel">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <FileSignature className="h-4 w-4" /> Coaching Agreement (in-app)
        </h3>
        <AgreementStatusChip status={status} />
      </div>

      <div className="space-y-1 text-sm">
        {data.state.state === "signed" && latest && (
          <p>
            Version {latest.version} signed {formatSignedDateTime(latest.signedAt)} by{" "}
            <span className="font-semibold">{latest.typedName}</span>
            {latest.hasGuardian ? " with a parent or guardian" : ""}.
          </p>
        )}
        {data.state.state === "needs_signature" && (
          <p>
            {data.state.reason === "admin_request" &&
              "You asked for a new signature; they haven't signed it yet."}
            {data.state.reason === "new_version" &&
              `They signed an earlier version (${data.state.previous?.version}); the current version is ${data.currentVersion}.`}
            {data.state.reason === "never_signed" &&
              (data.hasAccount
                ? "Hasn't signed yet. They're reminded by a popup each time they open the app."
                : "Hasn't created their app account yet, so they can't sign.")}
          </p>
        )}
        {data.state.state === "exempt" && (
          <p>
            {EXEMPT_LABEL[data.state.kind]}
            {data.state.note ? `: ${data.state.note}` : "."}
          </p>
        )}
        {data.resignRequestedAt && outstanding && (
          <p className="text-xs text-muted-foreground">
            Sent {formatSignedDate(data.resignRequestedAt)}
            {data.resignNote ? ` · "${data.resignNote}"` : ""}
          </p>
        )}
        {data.lastRemindedAt && (
          <p className="text-xs text-muted-foreground">
            Last reminded {formatSignedDate(data.lastRemindedAt)} ({data.reminderCount}×)
          </p>
        )}
        {data.legacy.signed && (
          <p className="text-xs text-muted-foreground">
            Earlier agreement on file ({data.legacy.status ?? "Signed"}
            {data.legacy.version ? `, ${data.legacy.version}` : ""}
            {data.legacy.date ? `, ${data.legacy.date}` : ""}).
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {latest && (
          <Button type="button" variant="outline" onClick={() => setViewing(latest.id)}>
            View signed copy
          </Button>
        )}
        {data.canManage && data.hasAccount && data.state.state !== "exempt" && (
          <Button type="button" onClick={() => setSendOpen(true)}>
            {data.state.state === "signed"
              ? "Send another to sign"
              : outstanding
                ? "Send / remind"
                : "Send"}
          </Button>
        )}
        {data.canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="More agreement actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {data.state.state !== "exempt" && (
                <DropdownMenuItem onSelect={() => setExemptOpen(true)}>
                  Stop asking (signed on paper / not required)
                </DropdownMenuItem>
              )}
              {data.state.state === "exempt" && (
                <DropdownMenuItem onSelect={() => unexempt.mutate()}>
                  Remove exemption
                </DropdownMenuItem>
              )}
              {data.resignRequestedAt && outstanding && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => cancel.mutate()}>
                    Cancel the request
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {(data.signatures.length > 1 || data.events.length > 0) && (
        <details className="rounded-xl border border-border p-3">
          <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground">
            <History className="h-4 w-4" /> History
          </summary>
          <div className="mt-3 space-y-4">
            {data.signatures.length > 0 && (
              <Section title="Signed copies">
                <ul className="space-y-1">
                  {data.signatures.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="flex min-h-[40px] w-full items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-muted/50"
                        onClick={() => setViewing(s.id)}
                      >
                        <span>
                          Version {s.version} · {formatSignedDateTime(s.signedAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">{s.typedName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {data.events.length > 0 && (
              <Section title="Activity">
                <ul className="space-y-1 text-sm">
                  {data.events.map((e: any) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatSignedDateTime(e.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </details>
      )}

      <SendAgreementDialog
        clientId={clientId}
        clientName={name}
        alreadySigned={data.state.state === "signed"}
        open={sendOpen}
        onOpenChange={setSendOpen}
      />
      <ExemptDialog
        clientId={clientId}
        clientName={name}
        open={exemptOpen}
        onOpenChange={setExemptOpen}
      />
      <AgreementRecordViewer
        signatureId={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </Card>
  );
}

export default ClientAgreementPanel;
