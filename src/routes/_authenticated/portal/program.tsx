import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, FileText, Heart, Dumbbell, Target, Video, Calendar } from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import { deriveImportantDate, dateTypeLabel, importantToneClasses, type ImportantDate } from "@/lib/important-dates";
import { dayTypeLabel, dayTypeTone, formatDays } from "@/lib/training-schedule";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/portal/program")({ component: MyProgram });

function MyProgram() {
  const { user } = useAuth();
  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle();
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

  return (
    <>
      <PageHeader title="My Program" subtitle={activePhase ? displayTitle(activePhase) : (client?.program_phase ?? "Current training phase")} />
      <div className="p-6 md:p-8 space-y-6">
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
          </div>
        </Card>

        <Card className="border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Dumbbell className="h-4 w-4" /> Current Training Phase
          </h2>
          {activePhase ? (() => {
            const d = derivePhase(activePhase);
            return (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold">{displayTitle(activePhase)}</span>
                  <Badge variant="outline" className={toneClasses(d.tone)}>{d.label}</Badge>
                  <Badge variant="outline" className="text-[10px]">{activePhase.phase_type}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {format(parseISO(activePhase.start_date), "MMM d, yyyy")} → {format(parseISO(activePhase.end_date), "MMM d, yyyy")}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Item label="Week" value={`${d.currentWeek} / ${d.totalWeeks}`} />
                  <Item label="Days remaining" value={d.daysRemaining < 0 ? `${Math.abs(d.daysRemaining)}d over` : `${d.daysRemaining}d`} />
                  <Item label="Weeks left" value={String(d.weeksRemaining)} />
                  <Item label="Progress" value={`${d.percentComplete}%`} />
                </div>
                <Progress value={d.percentComplete} className="mt-3 h-2" />
                {activePhase.training_goal && (
                  <p className="mt-4 text-sm"><span className="text-muted-foreground">Goal: </span>{activePhase.training_goal}</p>
                )}
                {activePhase.notes && (
                  <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{activePhase.notes}</div>
                )}
              </div>
            );
          })() : (
            <p className="text-sm text-muted-foreground">No active training phase yet. Your coach will assign one soon.</p>
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
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {c.frequency_per_week && <Item label="Frequency" value={`${c.frequency_per_week}x / week`} />}
                    {c.duration_minutes && <Item label="Duration" value={`${c.duration_minutes} min`} />}
                    {c.intensity && <Item label="Intensity" value={c.intensity} />}
                    {c.heart_rate_zone && <Item label="HR Zone" value={c.heart_rate_zone} />}
                    {c.step_target && <Item label="Steps" value={c.step_target.toLocaleString()} />}
                    {c.machine_preference && <Item label="Machine" value={c.machine_preference} />}
                  </div>
                  {c.client_notes && <p className="mt-3 text-xs text-muted-foreground">{c.client_notes}</p>}
                </div>
              ))}
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