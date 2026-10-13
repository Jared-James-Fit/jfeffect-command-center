import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, PlayCircle, Calendar, Clock, Bookmark, BookmarkCheck, Download, ArrowLeft } from "lucide-react";
import {
  recordPreviewEvent, savePlanForLater, unsavePlan, listSavedPlans, downloadLibraryPdf,
} from "@/lib/membership-library.functions";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { flatBlocks } from "@/components/programs/program-finder";
import { StartPlanDialog } from "@/components/programs/start-plan-dialog";
import { isMemberAccessActive } from "@/lib/memberAccess";
import { displayExerciseName } from "@/lib/exercise-display-name";

export const Route = createFileRoute("/_authenticated/portal/plans/$planId")({ component: PlanDetail });

const PROGRAM_LIBRARY_KEYS = new Set(["app_membership", "program_library", "jf_membership"]);

function PlanDetail() {
  const { planId } = Route.useParams();
  const qc = useQueryClient();
  const fetchMe = useServerFn(getCurrentMember);
  const recordView = useServerFn(recordPreviewEvent);
  const saveFn = useServerFn(savePlanForLater);
  const unsaveFn = useServerFn(unsavePlan);
  const fetchSaved = useServerFn(listSavedPlans);
  const downloadFn = useServerFn(downloadLibraryPdf);
  const [startOpen, setStartOpen] = useState(false);

  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const { data: plan, isLoading } = useQuery({
    queryKey: ["portal-plan", planId],
    queryFn: async () => (await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle()).data as any,
  });
  const { data: saved } = useQuery({ queryKey: ["m-saved-plans"], queryFn: () => fetchSaved() });
  const isSaved = (saved?.ids ?? []).includes(planId);

  useEffect(() => {
    if (plan?.status === "Published") recordView({ data: { planId } }).catch(() => {});
  }, [plan?.id, plan?.status]);

  const blocks = useMemo(() => flatBlocks(plan?.published_payload), [plan?.published_payload]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!plan) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <p>This plan isn't available.</p>
        <Link to="/portal/plans" className="text-primary hover:underline">Back to the Plan Library</Link>
      </div>
    );
  }

  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const memberActive = isMemberAccessActive(me?.member);
  const unlocked = plan.audience_mode === "all_active"
    ? memberActive
    : accessKeys.has(plan.required_access_level) || (PROGRAM_LIBRARY_KEYS.has(plan.required_access_level) && memberActive);
  const canStart = unlocked && plan.allow_full_program !== false && plan.status === "Published" && plan.membership_status === "live";

  const toggleSave = async () => {
    try {
      if (isSaved) { await unsaveFn({ data: { planId } }); toast.success("Removed from saved"); }
      else { await saveFn({ data: { planId } }); toast.success("Saved for later"); }
      qc.invalidateQueries({ queryKey: ["m-saved-plans"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const handleDownload = async () => {
    try {
      const { filename, base64 } = await downloadFn({ data: { planId } });
      const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error(e?.message ?? "Download unavailable"); }
  };

  return (
    <div className="mx-auto w-full max-w-3xl pb-24">
      <PageHeader
        title={plan.public_title || plan.name}
        subtitle={plan.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={toggleSave}>
              {isSaved ? <><BookmarkCheck className="mr-1 h-4 w-4" /> Saved</> : <><Bookmark className="mr-1 h-4 w-4" /> Save</>}
            </Button>
            {plan.allow_pdf_download && (
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="mr-1 h-4 w-4" /> PDF
              </Button>
            )}
            {canStart && (
              <Button size="sm" onClick={() => setStartOpen(true)}>
                <PlayCircle className="mr-1 h-4 w-4" /> Start plan
              </Button>
            )}
            {!unlocked && <Badge variant="secondary"><Lock className="mr-1 h-3.5 w-3.5" />Locked</Badge>}
          </div>
        }
      />
      <div className="space-y-4 px-4 py-4 md:px-8">
        <Link to="/portal/plans" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Plan Library
        </Link>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" />{plan.weeks} weeks · {plan.days_per_week}/wk</span>
          {plan.est_minutes_per_workout && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />{plan.est_minutes_per_workout} min/workout</span>}
          {plan.training_style && <Badge variant="outline">{plan.training_style}</Badge>}
          {plan.difficulty && <Badge variant="outline">{plan.difficulty}</Badge>}
          {plan.goal && <Badge variant="outline">{plan.goal}</Badge>}
        </div>
        {Array.isArray(plan.equipment_needed) && plan.equipment_needed.length > 0 && (
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Equipment</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.equipment_needed.map((eq: string) => <Badge key={eq} variant="secondary">{eq}</Badge>)}
            </div>
          </Card>
        )}
        {blocks.length > 0 && <PlanPreview blocks={blocks} />}
        {canStart && (
          <Button className="w-full" onClick={() => setStartOpen(true)}>
            <PlayCircle className="mr-1 h-4 w-4" /> Start this plan
          </Button>
        )}
      </div>

      <StartPlanDialog plan={plan} open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}

/** What the plan looks like: each block's length, and its first week day by day. */
function PlanPreview({ blocks }: { blocks: Array<{ name: string; weeks: any[] }> }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, bi) => {
        const firstWeek = b.weeks[0];
        const days: any[] = firstWeek?.days ?? [];
        return (
          <Card key={bi} className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 truncate font-semibold">{b.name}</div>
              <div className="shrink-0 text-xs text-muted-foreground">{b.weeks.length} week{b.weeks.length === 1 ? "" : "s"}</div>
            </div>
            {days.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {days.map((d: any, di: number) => {
                  const rows: any[] = d?.rows ?? [];
                  return (
                    <div key={di} className="rounded-md border bg-muted/30 p-2.5 text-sm">
                      <div className="font-medium">{d?.title || d?.name || `Day ${di + 1}`}</div>
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {rows.slice(0, 6).map((r: any, ri: number) => (
                          <li key={ri} className="truncate">
                            {displayExerciseName({ exercise_name_override: r?.exercise_name_override || r?.exercise_name || r?.name })}
                            {r?.sets ? ` · ${r.sets}×${r?.reps_text ?? r?.reps ?? ""}` : ""}
                          </li>
                        ))}
                        {rows.length > 6 && <li>+{rows.length - 6} more</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
