/**
 * Missing program data (/admin/program-gaps): every coaching client whose
 * upcoming workouts are missing something they need to follow them, the
 * soonest first, each gap with its fix: Open (the block editor on that week),
 * Fill in with AI (Edit with AI with the list, reviewed before it applies),
 * Add maxes / Set days (Athlete setup) and Place them (the Training tab).
 * `?client=` scrolls to one client (the Brief, the Training tab).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CalendarX2, Check, ChevronRight, Dumbbell, Gauge, Layers, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { EditWithAiSheet } from "@/components/program-ai/edit-with-ai";
import { cn } from "@/lib/utils";
import { focusBlockEditorWeek } from "@/lib/block-editor-focus";
import {
  estimatedMaxPlan, fillInstruction, gapDateLabel, MAX_BASIS_LABEL, problemsLabel, whenLabel,
  type ClientProgramGaps,
} from "@/lib/program-gaps";
import { invalidateScheduleQueries } from "@/lib/schedule-invalidate";
import { PROGRAM_GAPS_KEY, useProgramGaps } from "@/components/program-gaps/use-program-gaps";

/** Athlete setup on the client's Training tab (client-training-tab.tsx): training days and maxes. */
const ATHLETE_SETUP = "athlete-setup";
/** Workouts a client card shows before "Show all". */
const FIRST_WORKOUTS = 4;

export function ProgramGapsPage({ focusClient }: { focusClient?: string }) {
  const qc = useQueryClient();
  const { gaps, isLoading, isError, refetch, allowed } = useProgramGaps({ fresh: true });
  const [aiFor, setAiFor] = useState<ClientProgramGaps | null>(null);

  // Open on the client a link points at.
  useEffect(() => {
    if (!focusClient || !gaps.length) return;
    const t = window.setTimeout(() => document.getElementById(`gaps-${focusClient}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    return () => window.clearTimeout(t);
  }, [focusClient, gaps.length]);

  return (
    <>
      <PageHeader title="Missing program data" backTo="/admin/communication" backLabel="Messages" />
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:p-6" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }} data-program-gaps>
        <p className="text-[14px] text-muted-foreground">
          What your clients' upcoming workouts are missing before they can follow them. Workouts that are done, started or past aren't checked.
        </p>
        {!allowed ? (
          <p className="text-sm text-muted-foreground">This is for coaches.</p>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        ) : isError ? (
          <Card className="flex items-center justify-between gap-3 p-4 text-sm">
            <span className="text-muted-foreground">Couldn't check the programs just now.</span>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
          </Card>
        ) : gaps.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-3 text-sm font-medium text-success" data-program-gaps-clear>
            <Check className="h-4 w-4" /> All caught up. Every upcoming workout has what it needs.
          </p>
        ) : (
          gaps.map((g) => <ClientGapsCard key={g.clientId} g={g} focused={g.clientId === focusClient} onAi={() => setAiFor(g)} />)
        )}
      </div>
      {aiFor && (
        <EditWithAiSheet
          open
          onOpenChange={(v) => { if (!v) setAiFor(null); }}
          target={{ kind: "client", clientId: aiFor.clientId, focusBlockId: aiFor.workouts[0]?.blockId ?? null }}
          title={`${aiFor.name} · missing program data`}
          initialText={fillInstruction(aiFor)}
          onApplied={() => qc.invalidateQueries({ queryKey: PROGRAM_GAPS_KEY })}
        />
      )}
    </>
  );
}

function ClientGapsCard({ g, focused, onAi }: { g: ClientProgramGaps; focused: boolean; onAi: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [usingEstimate, setUsingEstimate] = useState(false);
  // Every set that reads a max nobody entered reads their estimated max (from
  // their logged sets) instead, with an RPE cap: program_gaps_use_estimated_max.
  const applyEstimatedMax = async () => {
    setUsingEstimate(true);
    try {
      const { data, error } = await (supabase as any).rpc("program_gaps_use_estimated_max", { _client: g.clientId, _rows: estimatedMaxPlan(g.maxes) });
      if (error) throw error;
      toast.success(`${Number(data ?? 0)} set${Number(data) === 1 ? "" : "s"} now read ${g.firstName}'s estimated max`, {
        description: "Worked out from their logged sets, with an RPE cap. Add a tested max any time and switch back in the editor.",
      });
      invalidateScheduleQueries(qc, { clientId: g.clientId });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change those sets");
    } finally {
      setUsingEstimate(false);
    }
  };
  const [allWorkouts, setAllWorkouts] = useState(focused);
  const when = whenLabel(g.today, g.firstDate);
  const shown = allWorkouts ? g.workouts : g.workouts.slice(0, FIRST_WORKOUTS);
  const training = { to: "/admin/clients/$id" as const, params: { id: g.clientId }, search: { tab: "training" } as any };
  const open = (blockId: string, weekIndex: number | null) => {
    focusBlockEditorWeek(weekIndex);
    void navigate({ to: "/admin/blocks/$blockId", params: { blockId } });
  };

  return (
    <Card id={`gaps-${g.clientId}`} className={cn("scroll-mt-24 p-4", focused && "ring-2 ring-foreground/20")} data-program-gaps-client={g.clientId}>
      <div className="flex items-center gap-3">
        <UserAvatar src={g.photo} name={g.name} size={44} expandable={false} />
        <div className="min-w-0 flex-1">
          <Link {...training} className="block truncate text-[16px] font-semibold hover:underline">{g.name}</Link>
          <p className="truncate text-[13px] text-muted-foreground">
            {g.count} to fix{g.firstDate ? ` · first ${gapDateLabel(g.firstDate)}` : ""}
          </p>
        </div>
        {when && (
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium", g.dueSoon ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
            {when}
          </span>
        )}
      </div>

      {g.noTrainingDays && (
        <GapSection icon={<CalendarX2 className="h-4 w-4" />} title="No training days set">
          <FixRow
            text={`${g.firstName}'s workouts go on the days you pick.`}
            action={<Button asChild size="sm" variant="outline" className="h-9"><Link {...training} hash={ATHLETE_SETUP}>Set days</Link></Button>}
          />
        </GapSection>
      )}

      {g.workouts.length > 0 && (
        <GapSection
          icon={<Dumbbell className="h-4 w-4" />}
          title="Missing a prescription"
          count={g.workouts.length}
          action={
            <Button size="sm" variant="outline" className="h-9" onClick={onAi} data-program-gaps-ai>
              <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Fill in
            </Button>
          }
        >
          <ul className="divide-y divide-border">
            {shown.map((w) => (
              <li key={w.dayId} className="flex items-start gap-3 py-2.5" data-program-gaps-workout>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">
                    {gapDateLabel(w.date)}
                    {w.title ? <span className="font-normal text-muted-foreground"> · {w.title}</span> : null}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {w.blockName}{w.weekIndex ? ` · Week ${w.weekIndex}` : ""}{w.optional ? " · Optional" : ""}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {w.items.map((i) => (
                      <li key={i.rowId} className="text-[13px]">
                        {i.exercise} <span className="text-muted-foreground">· needs {problemsLabel(i.problems)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button size="sm" variant="ghost" className="h-9 shrink-0 px-2" onClick={() => open(w.blockId, w.weekIndex)} aria-label={`Open ${gapDateLabel(w.date)} in the editor`}>
                  Open <ChevronRight className="ml-0.5 h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          {!allWorkouts && g.workouts.length > FIRST_WORKOUTS && (
            <button type="button" onClick={() => setAllWorkouts(true)} className="mt-1 min-h-10 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              Show all {g.workouts.length}
            </button>
          )}
        </GapSection>
      )}

      {g.maxes.length > 0 && (
        <GapSection
          icon={<Gauge className="h-4 w-4" />}
          title="Maxes not on file"
          action={<Button asChild size="sm" variant="outline" className="h-9"><Link {...training} hash={ATHLETE_SETUP}>Add maxes</Link></Button>}
        >
          <p className="mb-2 text-[13px] text-muted-foreground">
            Add a tested max, or have these sets read {g.firstName}'s estimated max from their logged sets.
          </p>
          <ul className="space-y-2">
            {g.maxes.map((m) => (
              <li key={`${m.basis}:${m.lift}`} className="text-[13px]" data-program-gaps-max>
                <p className="text-[14px] font-medium">{MAX_BASIS_LABEL[m.basis] ?? "Max"} · {m.lift}</p>
                <p className="text-muted-foreground">
                  {m.rows} set{m.rows === 1 ? "" : "s"} from {gapDateLabel(m.firstDate)} {m.rows === 1 ? "is" : "are"} a % of it
                  {m.nothingElse ? `, ${m.nothingElse} with no RPE either, so ${g.firstName} sees no weight` : ""}
                </p>
                {m.exercises.length > 1 && <p className="truncate text-[12px] text-muted-foreground">{m.exercises.join(", ")}</p>}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-2 h-9" disabled={usingEstimate} onClick={() => void applyEstimatedMax()} data-program-gaps-estimate>
            {usingEstimate ? "Changing…" : "Use estimated max"}
          </Button>
        </GapSection>
      )}

      {g.doubled && (
        <GapSection
          icon={<Layers className="h-4 w-4" />}
          title="Two programs on the same days"
          action={<Button asChild size="sm" variant="outline" className="h-9"><Link {...training}>Review</Link></Button>}
        >
          <p className="text-[13px] text-muted-foreground" data-program-gaps-doubled>
            {g.doubled.blockNames.join(" and ")} both have a workout on {g.doubled.days} day{g.doubled.days === 1 ? "" : "s"} from {gapDateLabel(g.doubled.firstDate)}.
            End the one {g.firstName} isn't training (its ⋯ → Delete program; one with logged workouts is archived, never lost).
          </p>
        </GapSection>
      )}

      {g.undated.length > 0 && (
        <GapSection
          icon={<CalendarX2 className="h-4 w-4" />}
          title="No date"
          action={<Button asChild size="sm" variant="outline" className="h-9"><Link {...training}>Place them</Link></Button>}
        >
          <ul className="space-y-1 text-[13px]">
            {g.undated.map((u) => (
              <li key={u.blockId}>{u.count} workout{u.count === 1 ? "" : "s"} in {u.blockName}</li>
            ))}
          </ul>
        </GapSection>
      )}
    </Card>
  );
}

function GapSection({ icon, title, count, action, children }: { icon: ReactNode; title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {title}{count ? <span className="font-normal text-muted-foreground"> · {count}</span> : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function FixRow({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="min-w-0 flex-1 text-muted-foreground">{text}</span>
      {action}
    </div>
  );
}
