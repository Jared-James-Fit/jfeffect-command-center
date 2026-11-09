/**
 * On Program Intelligence: where the latest Generate Next Program run stands,
 * one tap from the workstation that holds it.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { IntelJob } from "./use-program-intel";

const OVERALL: Record<string, string> = { passed: "passed its audit", partly: "partly checked", review: "needs review", failed: "failed validation" };

export function NextProgramLink({ job, clientId }: { job: IntelJob; clientId: string }) {
  const working = job.status === "pending" || job.status === "running";
  const rows = (job.result?.audit?.scorecard ?? []) as Array<{ status: string }>;
  const partly = job.result?.audit?.overall === "review" && !rows.some((r) => r.status === "review" || r.status === "failed");
  const audit = partly ? "partly" : (job.result?.audit?.overall as string | undefined);
  const text = working
    ? job.kind === "strategy" ? "Writing the strategy…" : "Building the next program…"
    : job.status === "error"
      ? `Stopped: ${job.error ?? "error"}`
      : job.kind === "strategy"
        ? "Strategy ready to review"
        : job.status === "assigned"
          ? "Next program assigned"
          : `Draft ready (hidden from the client)${audit ? `, ${OVERALL[audit] ?? audit}` : ""}`;
  return (
    <Card className="p-0" data-testid="intel-next-program-link">
      <Link to="/admin/client-programs/$clientId/next-program" params={{ clientId }} className="flex items-center gap-3 p-3.5">
        {working ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Next program</div>
          <div className="truncate text-[13px] font-bold">{text}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </Card>
  );
}
