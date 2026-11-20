import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { COMPETITION_FORM_TYPE, planGoal, planSummaryLines, type CompetitionPlan } from "@/lib/competition-plan";
import { ensureCompetitionPlanFn } from "@/lib/competition-plan.functions";

type Row = {
  id: string;
  client_id: string;
  plan: CompetitionPlan;
  changes: string[];
  status: "submitted" | "approved" | "dismissed";
  reviewed_at: string | null;
  goal_set: boolean;
};

/**
 * A Competition Calendar + Strategy submission as the coach reads it: the
 * plan in a few lines (from their answers, no AI), what changed since their
 * last plan, and Approve. Only an approved plan reaches the program AI, and
 * approving can also set the primary meet as the program's dated goal
 * (Generate Next Program's timeline). Nothing here changes a program.
 */
export function CompetitionPlanSummary({ submissionId, formId, compact = false }: { submissionId: string; formId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ensure = useServerFn(ensureCompetitionPlanFn);
  const db = supabase as any;
  const { data: isCompetition } = useQuery({
    queryKey: ["nf-form-type", formId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await db.from("nf_forms").select("form_type").eq("id", formId).maybeSingle();
      return data?.form_type === COMPETITION_FORM_TYPE;
    },
  });
  const key = ["competition-plan", submissionId];
  const { data: row, isFetched } = useQuery({
    queryKey: key,
    enabled: !!isCompetition,
    queryFn: async () => {
      const { data, error } = await db.from("athlete_competition_plans").select("*").eq("submission_id", submissionId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Row | null;
    },
  });
  // Submitted, but no plan recorded (the phone never said it was in): record it now, once.
  const kicked = useRef(false);
  useEffect(() => {
    if (!isCompetition || !isFetched || row || kicked.current) return;
    kicked.current = true;
    void ensure({ data: { submissionId } })
      .catch(() => {})
      .finally(() => qc.invalidateQueries({ queryKey: key }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompetition, isFetched, row]);

  const goal = row ? planGoal(row.plan) : null;
  const [useGoal, setUseGoal] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!isCompetition || !row) return null;
  // In a chat card: the two lines that matter (the meet they peak for and its goal), the rest in the full response.
  const lines = compact ? planSummaryLines(row.plan).slice(0, 2) : planSummaryLines(row.plan);

  const review = async (status: Row["status"]) => {
    setBusy(true);
    try {
      const setGoal = status === "approved" && useGoal && !!goal;
      const { error } = await db
        .from("athlete_competition_plans")
        .update({ status, reviewed_at: status === "submitted" ? null : new Date().toISOString(), reviewed_by: status === "submitted" ? null : user?.id ?? null, goal_set: setGoal })
        .eq("id", row.id);
      if (error) throw error;
      if (setGoal) {
        const { error: ge } = await db
          .from("program_intel_profiles")
          .upsert({ client_id: row.client_id, long_term_goal: { text: goal!.text.slice(0, 120), date: goal!.date, savedAt: new Date().toISOString() } }, { onConflict: "client_id" });
        if (ge) toast.error(`Approved, but the program goal didn't save: ${ge.message}`);
      }
      toast.success(status === "approved" ? (setGoal ? "Approved, and the primary meet is the program goal" : "Approved") : status === "dismissed" ? "Dismissed" : "Back to waiting on you");
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["program-intel-records", row.client_id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(compact ? "border-t border-blue-200/70 pt-2 dark:border-blue-400/15" : "rounded-xl border border-border p-3")} data-competition-plan>
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">Competition plan</p>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.status === "approved" ? "bg-success/15 text-success" : row.status === "dismissed" ? "bg-muted text-muted-foreground" : "bg-warning/15 text-warning",
          )}
        >
          {row.status === "approved" ? "Approved" : row.status === "dismissed" ? "Dismissed" : "Needs your OK"}
        </span>
      </div>
      {!compact && <p className="mt-0.5 text-[11px] text-muted-foreground">From their answers</p>}
      <dl className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.label}>
            <dt className="text-[11px] text-muted-foreground">{l.label}</dt>
            <dd className="whitespace-pre-wrap text-[13px] font-medium leading-snug">{l.value}</dd>
          </div>
        ))}
      </dl>
      {compact && row.changes.length > 0 && (
        <p className="mt-1.5 text-[12px] text-muted-foreground" data-competition-changes>
          {row.changes.length} change{row.changes.length === 1 ? "" : "s"} since their last plan
        </p>
      )}
      {!compact && row.changes.length > 0 && (
        <div className="mt-2.5 border-t border-border pt-2" data-competition-changes>
          <p className="text-[11px] text-muted-foreground">Changed since their last plan</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
            {row.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={cn("mt-3", !compact && "border-t border-border pt-2.5")}>
        {row.status === "submitted" ? (
          <>
            {goal && (
              <label className="mb-2 flex items-center justify-between gap-3 text-[13px]">
                <span>Make {goal.text.replace(/^Peak for /, "")} on {goal.date} the program goal</span>
                <Switch checked={useGoal} onCheckedChange={setUseGoal} />
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant={compact ? "outline" : "default"} className="h-10 flex-1" disabled={busy} onClick={() => review("approved")}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" className="h-10" disabled={busy} onClick={() => review("dismissed")}>
                Dismiss
              </Button>
            </div>
            {!compact && <p className="mt-1.5 text-[11px] text-muted-foreground">Approving lets the program AI plan around it. It never changes a program by itself.</p>}
          </>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1">
              {row.status === "approved"
                ? `Approved${row.reviewed_at ? ` ${new Date(row.reviewed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}. The program AI reads it${row.goal_set ? ", and the primary meet is the program goal" : ""}.`
                : "Dismissed. The program AI doesn't read it."}
            </span>
            <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => review("submitted")}>
              Undo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
