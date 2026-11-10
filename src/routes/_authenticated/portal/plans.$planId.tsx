import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, CalendarCheck, Download, Lock, Play } from "lucide-react";
import { recordPreviewEvent, downloadLibraryPdf } from "@/lib/membership-library.functions";
import { getMyStartedPlan } from "@/lib/member-plan-start.functions";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { flatBlocks } from "@/components/programs/program-finder";
import { StartPlanDialog } from "@/components/programs/start-plan-dialog";
import { useSavedPlans } from "@/components/athlete-programs/use-saved-plans";
import { isMemberAccessActive } from "@/lib/memberAccess";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { displayExerciseName } from "@/lib/exercise-display-name";

export const Route = createFileRoute("/_authenticated/portal/plans/$planId")({ component: PlanDetail });

const PROGRAM_LIBRARY_KEYS = new Set(["app_membership", "program_library", "jf_membership"]);
const PREVIEW = "Preview only: this is how it looks to them.";

/**
 * One JF Effect plan: where it comes from, what's in it, and one main action
 * (Start, or Open workouts when it's already on their calendar). Save puts it
 * in Programs → My programs. Back lands on the JF Effect tab.
 */
function PlanDetail() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const fetchMe = useServerFn(getCurrentMember);
  const recordView = useServerFn(recordPreviewEvent);
  const downloadFn = useServerFn(downloadLibraryPdf);
  const fetchStarted = useServerFn(getMyStartedPlan);
  const { isImpersonating } = useClientImpersonation();
  const saved = useSavedPlans(!isImpersonating);
  const [startOpen, setStartOpen] = useState(false);

  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const { data: plan, isLoading } = useQuery({
    queryKey: ["portal-plan", planId],
    queryFn: async () => (await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle()).data as any,
  });
  const { data: started } = useQuery({ queryKey: ["my-started-plan"], queryFn: () => fetchStarted() });

  useEffect(() => {
    if (plan?.status === "Published") recordView({ data: { planId } }).catch(() => {});
    // once per plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, plan?.status]);

  const blocks = useMemo(() => flatBlocks(plan?.published_payload), [plan?.published_payload]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Plan" backTo="/portal/plans" />
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Plan" backTo="/portal/plans" />
        <div className="px-4 py-6 md:px-8">
          <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
            <div className="text-[16px] font-semibold">This plan isn't available</div>
            <p className="mx-auto mt-1 max-w-[300px] text-sm text-muted-foreground">It may have been taken out of the library.</p>
            <Button asChild className="mt-5">
              <Link to="/portal/programs" search={{ tab: "jf" }}>See JF Effect plans</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const title = plan.public_title || plan.name;
  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const memberActive = isMemberAccessActive(me?.member);
  const unlocked = plan.audience_mode === "all_active"
    ? memberActive
    : accessKeys.has(plan.required_access_level) || (PROGRAM_LIBRARY_KEYS.has(plan.required_access_level) && memberActive);
  const canStart = unlocked && plan.allow_full_program !== false && plan.status === "Published" && plan.membership_status === "live";
  const running = !!plan.source_template_id && (started?.templateIds ?? []).includes(plan.source_template_id);
  const isSaved = saved.isSaved(planId);

  const toggleSave = () => {
    if (isImpersonating) return toast.message(PREVIEW);
    saved.toggle.mutate(
      { planId, save: !isSaved },
      {
        onSuccess: (didSave) =>
          didSave
            ? toast.success("Saved to My programs", {
                action: { label: "View", onClick: () => navigate({ to: "/portal/programs", search: { tab: "mine" } }) },
              })
            : toast.success("Removed from My programs"),
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save it. Try again."),
      },
    );
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

  const meta = [
    plan.weeks ? `${plan.weeks} weeks` : null,
    plan.days_per_week ? `${plan.days_per_week} days a week` : null,
    plan.est_minutes_per_workout ? `~${plan.est_minutes_per_workout} min a workout` : null,
  ].filter(Boolean).join(" · ");
  const tags = [plan.training_style, plan.difficulty, plan.goal].filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader
        title={title}
        backTo="/portal/plans"
        actionsInline
        actions={
          plan.allow_pdf_download ? (
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Download PDF" onClick={handleDownload}>
              <Download className="h-5 w-5" />
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-5 px-4 py-2 md:px-8">
        <div>
          <div className="text-[13px] font-medium text-muted-foreground">JF Effect plan · written by our coaches</div>
          {meta && <div className="mt-0.5 text-[14px] tabular-nums">{meta}</div>}
        </div>

        {plan.description && <p className="whitespace-pre-line text-[15px] leading-relaxed">{plan.description}</p>}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[12px]">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2.5 py-1 capitalize text-muted-foreground">{t.replace(/_/g, " ")}</span>
            ))}
          </div>
        )}

        {/* the one main action */}
        <div className="space-y-2">
          {running ? (
            <>
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-[14px]">
                <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden />
                It's on your calendar.
              </div>
              <Button asChild className="h-12 w-full text-[16px]">
                <Link to="/portal/workouts">Open workouts</Link>
              </Button>
              {canStart && (
                <Button variant="ghost" className="h-11 w-full" onClick={() => (isImpersonating ? toast.message(PREVIEW) : setStartOpen(true))}>
                  Start over from week 1
                </Button>
              )}
            </>
          ) : canStart ? (
            <Button className="h-12 w-full text-[16px]" onClick={() => setStartOpen(true)}>
              <Play className="mr-2 h-4 w-4" aria-hidden /> Start this plan
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-[14px] text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" aria-hidden />
              {unlocked ? "This plan can't be started right now." : "This plan isn't part of your access."}
            </div>
          )}
          <Button variant="secondary" className="h-11 w-full" onClick={toggleSave} disabled={saved.toggle.isPending}>
            {isSaved ? (
              <><BookmarkCheck className="mr-2 h-4 w-4" aria-hidden /> Saved to My programs</>
            ) : (
              <><Bookmark className="mr-2 h-4 w-4" aria-hidden /> Save to My programs</>
            )}
          </Button>
        </div>

        {Array.isArray(plan.equipment_needed) && plan.equipment_needed.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">Equipment</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">{plan.equipment_needed.join(" · ")}</p>
          </section>
        )}
        {blocks.length > 0 && <PlanPreview blocks={blocks} />}
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
          <section key={bi} className="rounded-2xl border border-border bg-card">
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="min-w-0 truncate text-[16px] font-semibold">{b.name}</h2>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {b.weeks.length} week{b.weeks.length === 1 ? "" : "s"}
              </span>
            </div>
            {days.length > 0 && (
              <div className="grid gap-px bg-border sm:grid-cols-2">
                {days.map((d: any, di: number) => {
                  const rows: any[] = d?.rows ?? [];
                  return (
                    <div key={di} className="bg-card px-4 py-3 text-sm">
                      <div className="font-medium">{d?.title || d?.name || `Day ${di + 1}`}</div>
                      <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
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
            {b.weeks.length > 1 && days.length > 0 && (
              <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">Week 1 shown. Later weeks build on it.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
