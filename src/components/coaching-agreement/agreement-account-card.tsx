import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronRight, FileSignature, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { usePovFn } from "@/lib/client-pov-args";
import { listMyAgreementSignatures } from "@/lib/coaching-agreement.functions";
import { AGREEMENT_QUERY_ROOT, useCoachingAgreement } from "./agreement-context";
import { AgreementRecordViewer } from "./agreement-record-viewer";
import { agreementPrompt, formatSignedDate } from "./agreement-copy";

/**
 * The client's home for their agreement: status, a button to sign if needed, and
 * their signed copy(ies) to open any time.
 */
export function AgreementAccountCard({ id }: { id?: string }) {
  const { user } = useAuth();
  const { client: povClient } = useClientImpersonation();
  const { state, needsSignature, canSign, openSignFlow } = useCoachingAgreement();
  const listSignatures = usePovFn(useServerFn(listMyAgreementSignatures));
  const [viewing, setViewing] = useState<string | null>(null);

  const { data: signatures = [] } = useQuery({
    queryKey: [AGREEMENT_QUERY_ROOT, "signatures", user?.id ?? "anon", povClient?.id ?? "self"],
    enabled: !!user?.id && !!state?.applicable,
    queryFn: () => listSignatures({ data: {} }),
    staleTime: 30_000,
  });

  if (!state?.applicable || !state.state) return null;
  const current = state.state;
  const prompt = agreementPrompt(state);
  const latest = signatures[0];

  return (
    <Card
      id={id}
      className="space-y-4 border-border bg-card p-5 sm:p-6"
      data-testid="agreement-account-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileSignature className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold">Coaching Agreement</h3>
        </div>
        {current.state === "signed" && (
          <Badge variant="outline" className="border-emerald-500/50 text-emerald-600">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Signed
          </Badge>
        )}
        {current.state === "needs_signature" && (
          <Badge
            variant="outline"
            className="border-amber-500/60 text-amber-700 dark:text-amber-400"
          >
            Action required
          </Badge>
        )}
        {current.state === "exempt" && <Badge variant="outline">On file</Badge>}
      </div>

      {current.state === "signed" && (
        <p className="text-sm text-muted-foreground">
          Version {current.signature.version} signed {formatSignedDate(current.signature.signedAt)}.
          It covers every service and purchase with your coach.
        </p>
      )}
      {current.state === "needs_signature" && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{prompt.title}</p>
          <p className="text-sm text-muted-foreground">{prompt.body}</p>
          {prompt.note && (
            <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
              {prompt.note}
            </p>
          )}
          {state.legacy.signed && (
            <p className="text-xs text-muted-foreground">
              Your earlier agreement
              {state.legacy.date
                ? ` (signed ${formatSignedDate(`${state.legacy.date}T12:00:00Z`)})`
                : ""}{" "}
              stays on file.
            </p>
          )}
        </div>
      )}
      {current.state === "exempt" && (
        <p className="text-sm text-muted-foreground">
          {current.kind === "offline_signed"
            ? "Your coach has your signed agreement on file."
            : "No signature is needed for your account."}
        </p>
      )}

      {needsSignature && canSign && (
        <Button
          type="button"
          className="h-12 w-full text-base font-semibold"
          onClick={openSignFlow}
        >
          Review &amp; sign
        </Button>
      )}

      {latest && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full justify-between text-base"
            onClick={() => setViewing(latest.id)}
          >
            <span>View my signed copy</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {signatures.length > 1 && (
            <details className="rounded-xl border border-border p-3">
              <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground">
                <History className="h-4 w-4" /> Earlier signed copies ({signatures.length - 1})
              </summary>
              <ul className="mt-2 space-y-1">
                {signatures.slice(1).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2 text-left text-sm active:bg-muted/50"
                      onClick={() => setViewing(s.id)}
                    >
                      <span>
                        Version {s.version} · {formatSignedDate(s.signedAt)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <AgreementRecordViewer
        signatureId={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </Card>
  );
}
