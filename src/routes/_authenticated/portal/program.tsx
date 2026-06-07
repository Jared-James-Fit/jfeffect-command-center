import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, FileText, Heart, Dumbbell, Target, Video, Calendar, Apple, Activity } from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import { deriveImportantDate, dateTypeLabel, importantToneClasses, type ImportantDate } from "@/lib/important-dates";
import { dayTypeLabel, dayTypeTone, formatDays } from "@/lib/training-schedule";
import { formatCalorieTarget } from "@/lib/nutrition-cardio";
import { format, parseISO } from "date-fns";
import { getActivePrep, countdownLabel } from "@/lib/pl-programs";

export const Route = createFileRoute("/_authenticated/portal/program")({ component: MyProgram });

function MyProgram() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["my-phases", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_phases").select("*").eq("client_id", client!.id)
        .order("start_date", { ascending: false });
      return (data ?? []) as TrainingPhase[];
    },
  });

  const activePhase = phases.find((p) => {
    const s = derivePhase(p).state;
    return s === "active" || s === "ending-soon" || s === "due-today";
  }) ?? phases.find((p) => derivePhase(p).state === "upcoming") ?? null;
  const phaseLink = activePhase?.program_link ?? client?.program_sheet_link ?? null;

  const { data: cardio = [] } = useQuery({
    queryKey: ["my-cardio", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cardio_targets").select("*").eq("client_id", client!.id)
        .neq("status", "Archived").order("start_date", { ascending: false });
      return data ?? [];
    },
  });
  const visibleCardio = (cardio as any[]).filter((c) => c.enabled !== false && c.visible_to_client !== false);

  const { data: nutritionTargets = [] } = useQuery({
    queryKey: ["my-nutrition-targets", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("nutrition_targets")
        .select("*, nutrition_target_days(*)")
        .eq("client_id", client!.id)
        .neq("status", "Archived")
        .order("start_date", { ascending: false });
      return data ?? [];
    },
  });
  const currentNutrition = (nutritionTargets as any[])[0];

  const { data: nutritionPdfUrl } = useQuery({
    queryKey: ["my-nutrition-pdf-url", currentNutrition?.pdf_url],
    enabled: !!currentNutrition?.pdf_url,
    queryFn: async () => {
      const { data } = await supabase.storage
        .from("nutrition-plans")
        .createSignedUrl(currentNutrition!.pdf_url, 60 * 60);
      return data?.signedUrl ?? null;
    },
  });

  const hasSchedule =
    (client?.preferred_training_days?.length ?? 0) +
      (client?.preferred_rest_days?.length ?? 0) +
      (client?.preferred_high_days?.length ?? 0) >
    0;

  const { data: importantDates = [] } = useQuery({
    queryKey: ["my-important-dates", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase.from("important_dates") as any)
        .select("*").eq("client_id", client!.id)
        .neq("status", "Archived").order("target_date", { ascending: true });
      return (data ?? []) as ImportantDate[];
    },
  });
  const upcomingDates = importantDates.filter((d) => !["completed", "archived"].includes(deriveImportantDate(d).state));

  const { data: activePrep } = useQuery({
    queryKey: ["my-active-prep", client?.id],
    enabled: !!client?.id,
    queryFn: () => getActivePrep(client!.id),
  });

  return (
    <>
      <PageHeader title="My Program" subtitle={activePhase ? displayTitle(activePhase) : (client?.program_phase ?? "Current training phase")} />
      <div className="p-6 md:p-8 space-y-6">
        {activePrep && (activePrep as any).client_visible !== false && (
          <Card className="border-primary/30 bg-primary/5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Target className="h-8 w-8 text-primary" />
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current Prep</div>
                  <h2 className="text-xl font-black">{(activePrep as any).title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(activePrep as any).goal_type}
                    {(activePrep as any).event_name && ` · ${(activePrep as any).event_name}`}
                    {(activePrep as any).event_date && ` · ${(activePrep as any).event_date}`}
                  </p>
                </div>
              </div>
              {countdownLabel((activePrep as any).event_date) && (
                <Badge variant="outline" className="text-base font-bold">{countdownLabel((activePrep as any).event_date)}</Badge>
              )}
            </div>
            <div className="mt-4">
              <Link to="/portal/workouts">
                <Button variant="outline" size="sm"><Activity className="mr-1 h-4 w-4" /> Open Workouts</Button>
              </Link>
            </div>
          </Card>
        )}

        {hasSchedule && (
          <Card className="border-border bg-card p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Calendar className="h-4 w-4" /> Training Schedule
            </h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Item label="Training days" value={formatDays(client?.preferred_training_days)} />
              <Item label="Rest days" value={formatDays(client?.preferred_rest_days)} />
              <Item label="High days" value={formatDays(client?.preferred_high_days)} />
            </div>
            {client?.schedule_notes && (
              <p className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap">{client.schedule_notes}</p>
            )}
          </Card>
        )}

        <Card className="border-border bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-xl font-black">Your Training Program</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {phaseLink ? "Opens your program sheet or file — bookmark it on your phone." : "Your coach hasn't linked your program yet. Check back soon."}
                </p>
              </div>
            </div>
            {phaseLink && (
              <a href={phaseLink} target="_blank" rel="noreferrer">
                <Button size="lg" className="bg-gradient-primary font-bold uppercase">
                  Open My Program <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </a>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/portal/lift-videos">
              <Button variant="outline" size="sm"><Video className="mr-1 h-4 w-4" /> Upload Lift Video</Button>
            </Link>
            <Link to="/portal/exercises">
              <Button variant="outline" size="sm"><Dumbbell className="mr-1 h-4 w-4" /> Exercise Library</Button>
            </Link>
          </div>
        </Card>

        {visibleCardio.length > 0 && (
          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Heart className="h-4 w-4" /> Cardio Targets
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {visibleCardio.map((c: any) => (
                <div key={c.id} className="rounded-md border border-border bg-secondary/30 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={dayTypeTone(c.day_type)}>{dayTypeLabel(c)}</Badge>
                      <span className="text-sm font-bold">{c.cardio_type === "Custom" ? c.custom_type : c.cardio_type}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{c.start_date} → {c.end_date ?? "ongoing"}</Badge>
                  </div>
                  {c.program_name && <div className="mt-1 text-[10px] uppercase tracking-widest text-primary">{c.program_name}</div>}
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {c.frequency_per_week && <Item label="Frequency" value={`${c.frequency_per_week}x / week`} />}
                    {c.duration_minutes && <Item label="Duration" value={`${c.duration_minutes} min`} />}
                    {c.intensity && <Item label="Intensity" value={c.intensity} />}
                    {c.heart_rate_zone && <Item label="HR Zone" value={c.heart_rate_zone} />}
                    {c.step_target && <Item label="Steps" value={c.step_target.toLocaleString()} />}
                    {c.machine_preference && <Item label="Machine" value={c.machine_preference} />}
                  </div>
                  {c.show_calories_to_client !== false && (c.calorie_target_min || c.calorie_target_max) && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Estimated target: <span className="font-semibold text-foreground">{formatCalorieTarget(c.calorie_target_min, c.calorie_target_max)}</span>
                    </div>
                  )}
                  {c.client_notes && <p className="mt-3 text-xs text-muted-foreground">{c.client_notes}</p>}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="border-border bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Apple className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-xl font-black">Nutrition Targets</h2>
                {currentNutrition ? (
                  (() => {
                    const day = (currentNutrition.nutrition_target_days ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)[0];
                    const phase = currentNutrition.phase === "Custom" ? currentNutrition.custom_phase : currentNutrition.phase;
                    const goal = currentNutrition.goal === "Custom" ? currentNutrition.custom_goal : currentNutrition.goal;
                    return (
                      <div className="mt-1 space-y-1 text-sm">
                        <p className="text-muted-foreground">{phase} · {goal}</p>
                        {day && (
                          <p className="font-semibold">
                            {day.calories ?? "—"} kcal · P {day.protein ?? "—"} / C {day.carbs ?? "—"} / F {day.fats ?? "—"}
                          </p>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Your coach hasn't assigned nutrition targets yet.</p>
                )}
              </div>
            </div>
            {currentNutrition?.pdf_url && nutritionPdfUrl ? (
              <a href={nutritionPdfUrl} target="_blank" rel="noreferrer">
                <Button size="lg" className="bg-gradient-primary font-bold uppercase">
                  View Full Plan <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </a>
            ) : (
              <Link to="/portal/nutrition-targets">
                <Button size="lg" className="bg-gradient-primary font-bold uppercase">
                  View Full Plan <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>

          {currentNutrition?.pdf_url && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-primary" />
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Nutrition Plan</div>
                  <div className="font-bold">{currentNutrition.pdf_name || "Nutrition Plan.pdf"}</div>
                </div>
              </div>
              {nutritionPdfUrl && (
                <a href={nutritionPdfUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">Open PDF</Button>
                </a>
              )}
            </div>
          )}
        </Card>

        {upcomingDates.length > 0 && (
          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Target className="h-4 w-4" /> Long-Term Goals
            </h2>
            <div className="space-y-3">
              {upcomingDates.map((d) => {
                const der = deriveImportantDate(d);
                return (
                  <div key={d.id} className="rounded-md border border-border bg-secondary/30 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{d.title}</span>
                      <Badge variant="outline" className={importantToneClasses(der.tone)}>{der.label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{dateTypeLabel(d)}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Target: {format(parseISO(d.target_date), "MMM d, yyyy")}
                      {d.start_date && ` · Prep started ${format(parseISO(d.start_date), "MMM d")}`}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <Item label="Days until" value={der.daysRemaining < 0 ? `${Math.abs(der.daysRemaining)}d past` : `${der.daysRemaining}d`} />
                      <Item label="Weeks left" value={String(der.weeksRemaining)} />
                      {der.currentWeek != null && der.totalWeeks != null && <Item label="Week" value={`${der.currentWeek} / ${der.totalWeeks}`} />}
                      {der.percentComplete != null && <Item label="Progress" value={`${der.percentComplete}%`} />}
                    </div>
                    {der.percentComplete != null && <Progress value={der.percentComplete} className="mt-3 h-2" />}
                    {d.notes && <p className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap">{d.notes}</p>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

      </div>
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, unit }: { label: string; value: any; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-black">{value ?? "—"}<span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span></div>
    </div>
  );
}