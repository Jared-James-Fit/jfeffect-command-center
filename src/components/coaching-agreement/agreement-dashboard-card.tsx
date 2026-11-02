import { FileSignature } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCoachingAgreement } from "./agreement-context";
import { agreementPrompt } from "./agreement-copy";

/**
 * Top-of-dashboard "action required" card. Shown on every visit to Home until the
 * client signs; not dismissible, because the agreement is mandatory.
 */
export function AgreementDashboardCard() {
  const { state, needsSignature, canSign, openSignFlow } = useCoachingAgreement();
  if (!needsSignature || !canSign) return null;
  const prompt = agreementPrompt(state);

  return (
    <Card
      className="relative overflow-hidden border-2 border-warning/60 bg-warning/10 p-4 sm:p-5"
      data-testid="agreement-dashboard-card"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warning/20 text-warning">
          <FileSignature className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-warning">
            Action required
          </p>
          <h2 className="text-base font-bold leading-tight tracking-tight sm:text-lg">
            {prompt.title}
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{prompt.body}</p>
          {prompt.note && (
            <p className="mt-2 rounded-lg bg-background/60 p-2.5 text-xs text-muted-foreground">
              {prompt.note}
            </p>
          )}
        </div>
      </div>
      <Button
        type="button"
        className="mt-4 h-12 w-full text-base font-semibold"
        onClick={openSignFlow}
      >
        Review &amp; sign · 2 min
      </Button>
    </Card>
  );
}
