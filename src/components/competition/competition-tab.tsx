/**
 * The client's Competition tab (Nov 24 2026): every meet they're preparing
 * for, with the research, projections, field, attempts and game plan already
 * done on the preparation's own schedule (Cleo's assessments), and only the
 * decisions that need the coach asked of them. The overview answers the head
 * coach's questions at a glance (how far out, what phase, what total, what
 * place, who's the threat, how ready, where the game plan stands, what's
 * waiting); every detail is one tap deeper. A push opens the exact assessment
 * (`?assessment=`).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, ChevronRight, Pencil, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/loading";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import {
  addResourceFn,
  createCompetitionFn,
  getCompetitionWorkspaceFn,
  removeResourceFn,
  retryRewriteFn,
  runMilestoneNowFn,
  saveResultsFn,
  setCompetitionStatusFn,
  updateCompetitionFn,
} from "@/lib/competition/competition.functions";
import { countdownWords, MILESTONE_BY_KIND, PHASE_LABEL } from "@/lib/competition/milestones";
import {
  athleteState,
  ATHLETE_STATE_WORD,
  coachState,
  COACH_STATE_WORD,
  type AssessmentRow,
} from "@/lib/competition/lifecycle";
import { OBJECTIVE_LABEL } from "@/lib/competition/types";
import { ordinal } from "@/lib/competition/landscape";
import type { CompetitorRead } from "@/lib/competition/competitor";
import { AssessmentSheet } from "./assessment-sheet";
import {
  RewriteProgressCard,
  useRewriteProgress,
  type RewriteProgress,
} from "./rewrite-progress";
import { rewriteView } from "@/lib/competition/rewrite-progress";
import { CompetitionForm, emptyCompetition, type CompetitionFormValues } from "./competition-form";
import { CompetitionField } from "./competition-field";
import { AttemptsView, ForecastTable, GameDayView, Kg, WarmupsView } from "./plan-views";
import { cn } from "@/lib/utils";
import { PrepOverview } from "./prep/prep-overview";
import { GameplanSection } from "./prep/gameplan-section";
import { TimelineSection } from "./prep/timeline-section";
import { ChecklistSection } from "./prep/checklist-section";
import { HandlingOpportunities } from "./prep/handling-opportunities";
import { HandlingInviteSheet } from "./prep/handling-sheets";
import { RecapCard } from "./prep/recap-card";
import { reviewChangesFn, saveScheduleFn, tickChecklistFn } from "@/lib/competition/handling.functions";
import { GoalSummary } from "@/components/goals/goal-summary";
import { AthleteIntelCard } from "@/components/athlete-intel/athlete-intel-card";

export const competitionWorkspaceKey = (clientId: string, competitionId: string | null) =>
  ["competition-workspace", clientId, competitionId] as const;

/**
 * Four sections people use every day; everything else (the field, projections,
 * Cleo's preparation schedule, resources, history) is under More.
 */
const SECTIONS = [
  ["overview", "Overview"],
  ["gameplan", "Gameplan"],
  ["timeline", "Timeline"],
  ["checklist", "Checklist"],
  ["more", "More"],
] as const;
const MORE = [
  ["field", "Field"],
  ["projections", "Projections"],
  ["preparation", "Preparation"],
  ["attempts", "Cleo's attempts"],
  ["warmups", "Cleo's warm-ups"],
  ["gameday", "Meet day"],
  ["resources", "Resources"],
  ["history", "History"],
] as const;
type Section = (typeof SECTIONS)[number][0] | (typeof MORE)[number][0];
const SECTION_KEYS = new Set<string>([...SECTIONS.map((x) => x[0]), ...MORE.map((x) => x[0])]);
function sectionParam(): Section | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("section");
  return v && SECTION_KEYS.has(v) ? (v as Section) : null;
}

/** a date inside the coming months, short: "Feb 1" (the year only when it isn't this one) */
const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    ...(d.getUTCFullYear() !== new Date().getFullYear() &&
    Math.abs(d.getTime() - Date.now()) > 120 * 864e5
      ? { year: "numeric" as const }
      : {}),
    timeZone: "UTC",
  });
};

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
const fmtWhen = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

export function CompetitionWorkspace({ clientId }: { clientId: string }) {
  const read = useServerFn(getCompetitionWorkspaceFn);
  const qc = useQueryClient();
  const [competitionId, setCompetitionId] = useState<string | null>(() => urlParam("competition"));
  const [assessmentId, setAssessmentId] = useState<string | null>(() => urlParam("assessment"));
  const [section, setSection] = useState<Section>(() => sectionParam() ?? "overview");
  const [handlingNew, setHandlingNew] = useState(false);
  const [form, setForm] = useState<null | {
    mode: "create" | "edit";
    initial: CompetitionFormValues;
    prepId?: string | null;
    source?: "coach" | "prep" | "plan";
  }>(null);
  const q = useQuery({
    queryKey: competitionWorkspaceKey(clientId, competitionId),
    queryFn: () => read({ data: { clientId, competitionId } }),
    staleTime: 30_000,
  });
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
  const saveSchedule = useServerFn(saveScheduleFn);
  const tickChecklist = useServerFn(tickChecklistFn);
  const reviewChanges = useServerFn(reviewChangesFn);
  const prepRun = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });
  // what Cleo is writing right now, polled lightly while it's going (rewrite-progress.tsx)
  const rewrite = useRewriteProgress(q.data?.selected?.competition?.id, clientId, setAssessmentId);

  const create = useServerFn(createCompetitionFn);
  const update = useServerFn(updateCompetitionFn);
  const save = useMutation({
    mutationFn: async (v: CompetitionFormValues) => {
      const fields = { ...v, rules: v.rules as unknown as Record<string, unknown> };
      if (form?.mode === "edit" && q.data?.selected) {
        await update({ data: { competitionId: q.data.selected.competition.id, fields } });
        return { id: q.data.selected.competition.id as string };
      }
      return create({
        data: { clientId, prepId: form?.prepId ?? null, source: form?.source ?? "coach", fields },
      });
    },
    onSuccess: (r) => {
      setForm(null);
      setCompetitionId(r.id);
      invalidate();
      toast.success("Saved. The preparation milestones are scheduled from the meet date.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4" data-competition-loading>
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  if (q.error || !q.data)
    return (
      <ErrorState error={q.error} what="their competitions" onRetry={() => void q.refetch()} />
    );
  const data = q.data as any;

  const formSheet = form ? (
    <CompetitionForm
      open
      title={form.mode === "edit" ? "Edit competition" : "Add a competition"}
      initial={form.initial}
      saving={save.isPending}
      onSave={(v) => save.mutate(v)}
      onClose={() => setForm(null)}
    />
  ) : null;

  if (!data.selected) {
    return (
      <div className="space-y-4" data-competition-empty>
        <EmptyState
          icon={<Trophy className="h-5 w-5" />}
          title="No competition on file"
          detail="Add the meet and Cleo prepares the research, projections, competitors, attempts and game plan on its own schedule, and tells you when something needs you."
          action={
            <Button
              size="sm"
              onClick={() => setForm({ mode: "create", initial: emptyCompetition() })}
            >
              <Plus className="h-4 w-4" /> Add a competition
            </Button>
          }
        />
        <Suggestions
          suggestions={data.suggestions}
          onUse={(s) =>
            setForm({
              mode: "create",
              prepId: s.prepId,
              source: s.source,
              initial: emptyCompetition({
                name: s.name,
                meet_date: s.date,
                federation: s.federation,
                weight_class: s.weightClass,
                division: s.division,
                level: s.level,
                registration:
                  s.registered == null ? "unknown" : s.registered ? "registered" : "not_registered",
              }),
            })
          }
        />
        <HandlingOpportunities clientId={clientId} />
        {formSheet}
      </div>
    );
  }

  const sel = data.selected;
  const comp = sel.competition;
  const brief = sel.brief;
  const assessments = sel.assessments as Array<
    AssessmentRow & { headline: string; coach_message: string | null; changes_note: string | null }
  >;
  const reads = new Map<string, CompetitorRead>(
    (brief?.competitors ?? []).map((c: any) => [c.id, c.read]),
  );

  return (
    <div className="min-w-0 space-y-4" data-competition-workspace>
      <Header
        competitions={data.competitions}
        selected={comp}
        brief={brief}
        onPick={(id) => {
          setCompetitionId(id);
          setSection("overview");
        }}
        onAdd={() => setForm({ mode: "create", initial: emptyCompetition() })}
        onEdit={() =>
          setForm({
            mode: "edit",
            initial: emptyCompetition({
              ...comp,
              objective: comp.objective ?? null,
              rules: comp.rules,
            }),
          })
        }
      />
      {data.suggestions?.length ? (
        <Suggestions
          compact
          suggestions={data.suggestions}
          onUse={(s) =>
            setForm({
              mode: "create",
              prepId: s.prepId,
              source: s.source,
              initial: emptyCompetition({
                name: s.name,
                meet_date: s.date,
                federation: s.federation,
                weight_class: s.weightClass,
                division: s.division,
                level: s.level,
              }),
            })
          }
        />
      ) : null}

      <nav
        className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Competition sections"
      >
        {SECTIONS.map(([k, label]) => {
          const on = k === "more" ? MORE.some(([m]) => m === section) || section === "more" : section === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSection(k === "more" ? "field" : k)}
              className={cn(
                "h-9 shrink-0 rounded-full px-3 text-[13px]",
                on ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={on ? "page" : undefined}
              data-section-tab={k}
            >
              {label}
            </button>
          );
        })}
      </nav>
      {MORE.some(([m]) => m === section) ? (
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="More">
          {MORE.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSection(k)}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 text-[12.5px]",
                section === k ? "border-foreground/30 font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {sel.briefError ? (
        <p className="rounded-xl border border-border p-3 text-[13px] text-muted-foreground">
          The live read couldn't be worked out: {sel.briefError}
        </p>
      ) : null}
      {sel.prepError ? (
        <p className="rounded-xl border border-border p-3 text-[13px] text-muted-foreground">
          The preparation read couldn't be worked out: {sel.prepError}
        </p>
      ) : null}

      {section === "overview" ? (
        sel.prep ? (
          <div className="space-y-4">
            <PrepOverview
              prep={sel.prep}
              onSection={(s2) => setSection(s2)}
              onChanged={invalidate}
              onReviewChanges={() =>
                prepRun.mutate(() =>
                  reviewChanges({
                    data: {
                      competitionId: comp.id,
                      applyProposed: (sel.prep.changes as any[]).some((c) => String(c.key).startsWith("event_"))
                        ? window.confirm("Use the times they gave instead of the ones you confirmed?")
                        : false,
                    },
                  }),
                )
              }
              extra={<OverviewAssessments clientId={clientId} sel={sel} rewrite={rewrite} onOpen={setAssessmentId} />}
            />
            {/* uploaded athlete information (athlete-intel): logs, programs, their coach's notes */}
            <AthleteIntelCard
              clientId={clientId}
              competitionId={comp.id}
              athleteFirst={sel.prep.client?.first ?? "the athlete"}
              coachName={sel.prep.handling?.existingCoach?.name ?? null}
              coachContactOk={sel.prep.handling?.shareWithCoach === "yes"}
              onChanged={invalidate}
            />
            {/* the targets at this meet (the goal ledger): theirs, the projection, the approved one */}
            <GoalSummary clientId={clientId} competitionId={comp.id} compact hideWhenEmpty />
            <RecapCard prep={sel.prep} onChanged={invalidate} />
            <HandlingOpportunities clientId={clientId} />
            {!sel.prep.handling ? (
              <button
                type="button"
                className="text-[13px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setHandlingNew(true)}
                data-add-handling
              >
                Add competition handling for this meet
              </button>
            ) : null}
            <details className="rounded-2xl border border-border px-4 py-3" data-full-read>
              <summary className="cursor-pointer text-[14px] font-medium">Cleo's full read: projections, field, what's being watched</summary>
              <div className="mt-3">
                <Overview clientId={clientId} sel={sel} rewrite={rewrite} onOpen={setAssessmentId} onSection={setSection} part="rest" />
              </div>
            </details>
          </div>
        ) : (
          <>
            <Overview clientId={clientId} sel={sel} rewrite={rewrite} onOpen={setAssessmentId} onSection={setSection} />
            <AthleteIntelCard clientId={clientId} competitionId={comp.id} athleteFirst="the athlete" coachName={null} coachContactOk={false} onChanged={invalidate} />
            <GoalSummary clientId={clientId} competitionId={comp.id} compact hideWhenEmpty />
          </>
        )
      ) : null}
      {section === "gameplan" && sel.prep ? <GameplanSection prep={sel.prep} onChanged={invalidate} /> : null}
      {section === "timeline" && sel.prep ? (
        <TimelineSection
          timeline={sel.prep.timeline}
          tz={sel.prep.tz}
          today={sel.prep.today}
          saving={prepRun.isPending}
          facts={{
            lifting_start: sel.prep.competition.lifting_start ?? null,
            weigh_in_at: sel.prep.competition.weigh_in_at ?? null,
            flight: sel.prep.competition.flight ?? null,
            flights_in_session: sel.prep.competition.flights_in_session ?? null,
            lifters_per_flight: sel.prep.competition.lifters_per_flight ?? null,
            platforms: sel.prep.competition.platforms ?? null,
            timezone: sel.prep.competition.timezone ?? null,
            travelMinutes: sel.prep.competition.schedule?.travelMinutes ?? sel.prep.info?.travel?.minutesToVenue ?? null,
            verified: sel.prep.competition.schedule?.verified ?? {},
          }}
          onSaveFacts={(f) =>
            prepRun.mutate(() =>
              saveSchedule({
                data: {
                  competitionId: comp.id,
                  fields: {
                    lifting_start: f.lifting_start,
                    weigh_in_at: f.weigh_in_at,
                    flight: f.flight,
                    flights_in_session: f.flights_in_session,
                    lifters_per_flight: f.lifters_per_flight,
                    platforms: f.platforms,
                    timezone: f.timezone,
                  },
                  verified: f.verified as any,
                  travelMinutes: f.travelMinutes,
                },
              }),
            )
          }
          onConfirmEntry={(key, at) => prepRun.mutate(() => saveSchedule({ data: { competitionId: comp.id, confirmEntry: { key, at } } }))}
        />
      ) : null}
      {section === "checklist" && sel.prep ? (
        <ChecklistSection
          items={sel.prep.checklist}
          readiness={sel.prep.readiness}
          today={sel.prep.today}
          who="coach"
          onTick={(key, state) => prepRun.mutate(() => tickChecklist({ data: { competitionId: comp.id, key, state } }))}
        />
      ) : null}
      {section === "preparation" ? (
        <Timeline
          comp={comp}
          milestones={sel.milestones}
          assessments={assessments}
          rewrite={rewrite}
          onOpen={setAssessmentId}
          onRun={() => {
            invalidate();
            rewrite.refetch();
          }}
        />
      ) : null}
      {section === "field" ? (
        <CompetitionField
          clientId={clientId}
          competitionId={comp.id}
          competitors={sel.competitors}
          reads={reads}
          landscape={brief?.landscape ?? null}
          research={comp.research ?? null}
          weightClass={comp.weight_class ?? null}
          classOptions={brief?.classOptions ?? []}
        />
      ) : null}
      {section === "projections" ? (
        <Card
          title="Performance projections"
          sub={brief ? `${brief.forecast.confidence} confidence` : undefined}
        >
          <ForecastTable forecast={brief?.forecast} showBasis />
          {brief?.profile?.patterns?.length ? (
            <div className="mt-4">
              <h4 className="text-[14px] font-semibold">What we know about how they compete</h4>
              <ul className="mt-1 space-y-1 text-[13px]">
                {brief.profile.patterns.map((p: any) => (
                  <li key={p.key}>
                    {p.text}{" "}
                    <span className="text-muted-foreground">
                      · {p.evidence === "proven" ? "proven" : "preliminary"} ({p.basis})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
      {section === "attempts" ? (
        <Card
          title="Cleo's attempt strategy"
          sub="From the expected scenario and their own attempt history; the Gameplan is what the athlete gets"
        >
          <AttemptsView attempts={brief?.attempts?.lifts} />
        </Card>
      ) : null}
      {section === "warmups" ? (
        <Card
          title="Cleo's warm-ups"
          sub="Built from their own warm-up habits where there's enough of them; the Gameplan is what the athlete gets"
        >
          <WarmupsView warmups={brief?.warmups} />
        </Card>
      ) : null}
      {section === "gameday" ? (
        <div className="space-y-4">
          <Link
            to="/admin/competition/$competitionId"
            params={{ competitionId: comp.id }}
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-[15px] font-semibold hover:bg-muted/40"
            data-open-meet-day
          >
            Open Meet-Day Mode
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Card
            title="Meet day in order"
            sub={
              comp.lifting_start
                ? `Lifting from ${comp.lifting_start}`
                : "Add the schedule for clock times"
            }
          >
            <GameDayView steps={brief?.gameDay} />
          </Card>
        </div>
      ) : null}
      {section === "resources" ? (
        <Resources
          clientId={clientId}
          competitionId={comp.id}
          resources={sel.resources}
          missing={brief?.missing}
        />
      ) : null}
      {section === "history" ? (
        <History
          clientId={clientId}
          sel={sel}
          competitions={data.competitions}
          onOpen={setAssessmentId}
        />
      ) : null}

      <AssessmentSheet
        assessmentId={assessmentId}
        clientId={clientId}
        rewrite={rewrite}
        onOpen={setAssessmentId}
        onClose={() => setAssessmentId(null)}
        newerReleased={
          !!assessmentId && !!assessments.find((a) => a.id === assessmentId)?.superseded_at
        }
      />
      {handlingNew ? (
        <HandlingInviteSheet
          open
          defaults={{ clientId, competitionId: comp.id }}
          onClose={() => setHandlingNew(false)}
          onCreated={() => invalidate()}
        />
      ) : null}
      {formSheet}
    </div>
  );
}

function Card({
  title,
  sub,
  children,
  className,
  action,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold">{title}</h3>
          {sub ? <p className="text-[12px] text-muted-foreground">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function meetClock(value: string): string {
  const [h, m] = value.split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60
    ? `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
    : value;
}

function Header({
  competitions,
  selected,
  brief,
  onPick,
  onAdd,
  onEdit,
}: {
  competitions: any[];
  selected: any;
  brief: any;
  onPick: (id: string) => void;
  onAdd: () => void;
  onEdit: () => void;
}) {
  const days = brief?.daysOut;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[20px] font-semibold leading-tight">{selected.name}</h2>
          {selected.is_primary ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              Primary
            </span>
          ) : null}
          {selected.status !== "upcoming" ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
              {selected.status}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {[
            fmtDate(selected.meet_date),
            selected.federation,
            selected.weight_class ? `${String(selected.weight_class).replace(/\s*kg$/i, "")} kg` : null,
            selected.division,
            selected.equipment_event,
            selected.level ? `${selected.level[0].toUpperCase()}${selected.level.slice(1)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground" data-meet-logistics-summary>
          {[
            selected.session_label,
            selected.flight ? `Flight ${selected.flight}` : null,
            selected.weigh_in_at ? `Weigh-in ${meetClock(selected.weigh_in_at)}` : null,
            selected.lifting_start ? `Lifting ${meetClock(selected.lifting_start)}` : null,
            selected.location,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {competitions.length > 1 ? (
          <select
            className="h-9 max-w-[220px] rounded-lg border border-input bg-background px-2 text-[13px]"
            value={selected.id}
            onChange={(e) => onPick(e.target.value)}
            aria-label="Competition"
          >
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {String(c.meet_date).slice(0, 10)}
                {c.status !== "upcoming" ? ` (${c.status})` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" variant="outline" onClick={onEdit} aria-label="Edit competition">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      {typeof days === "number" ? <span className="sr-only">{countdownWords(days)}</span> : null}
    </div>
  );
}

function Suggestions({
  suggestions,
  onUse,
  compact = false,
}: {
  suggestions: any[];
  onUse: (s: any) => void;
  compact?: boolean;
}) {
  if (!suggestions?.length) return null;
  return (
    <div
      className={cn("rounded-2xl border border-border p-3", compact ? "bg-muted/30" : "bg-card")}
      data-competition-suggestions
    >
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <CleoAvatar size="sm" /> Cleo found{" "}
        {suggestions.length === 1 ? "a meet" : `${suggestions.length} meets`} on file
      </div>
      <ul className="mt-2 space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <span>
              {s.name}{" "}
              <span className="text-muted-foreground">
                · {fmtDate(s.date)} ·{" "}
                {s.source === "prep" ? "their meet prep" : "their competition plan"}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={() => onUse(s)}>
              Set it up
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "warn" | "bad" | "good";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <div
        className={cn(
          "mt-0.5 text-[17px] font-semibold leading-snug",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[12px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/**
 * Cleo's assessments that need the coach, for the top of the preparation
 * overview: what's being written and the latest version waiting on him.
 */
function OverviewAssessments({ clientId, sel, rewrite, onOpen }: { clientId: string; sel: any; rewrite: RewriteProgress; onOpen: (id: string) => void }) {
  return <Overview clientId={clientId} sel={sel} rewrite={rewrite} onOpen={onOpen} onSection={() => {}} part="lead" />;
}

function Overview({
  clientId,
  sel,
  rewrite,
  onOpen,
  onSection,
  part = "all",
}: {
  clientId: string;
  sel: any;
  rewrite: RewriteProgress;
  onOpen: (id: string) => void;
  onSection: (s: Section) => void;
  /** "lead": only what's being written and the version waiting on the coach; "rest": everything else */
  part?: "all" | "lead" | "rest";
}) {
  const brief = sel.brief;
  const comp = sel.competition;
  const assessments = sel.assessments as any[];
  const latest = assessments.find((a) => a.status !== "superseded") ?? null;
  const outstanding = assessments.filter((a) =>
    ["ready", "reviewed", "changes_requested", "approved"].includes(a.status),
  );
  // a version Cleo is rewriting waits on Cleo, not the coach (its card says where it is)
  const beingRewritten = new Set(
    (rewrite.data?.live ?? []).map((l) => l.request?.assessmentId).filter(Boolean) as string[],
  );
  const plan = assessments.find(
    (a) => (a.kind === "confirm" || a.kind === "game_plan") && a.status !== "superseded",
  );
  const serious = (brief?.watch ?? []).filter((w: any) => w.severity === "serious");
  const concerns = (brief?.watch ?? []).filter((w: any) => w.severity !== "watch");
  const nextMilestone = (sel.milestones as any[]).find(
    (m) => m.status === "scheduled" || m.status === "waiting_ai" || m.status === "generating",
  );
  const run = useServerFn(runMilestoneNowFn);
  const qc = useQueryClient();
  const runNow = useMutation({
    mutationFn: () => run({ data: { competitionId: comp.id } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
      rewrite.refetch();
      toast.success(r.already ? "It's already being written" : "Queued for Cleo");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't queue it"),
  });
  const planStatus = !plan
    ? brief && brief.daysOut > 14
      ? `Due ${fmtDate(sel.milestones.find((m: any) => m.kind === "game_plan")?.due_on) || "2 weeks out"}`
      : "Not written yet"
    : plan.released_at
      ? plan.athlete_acknowledged_at
        ? "Released · acknowledged"
        : "Released · not acknowledged yet"
      : plan.approved_at
        ? "Approved · not released"
        : "Waiting for your review";

  const needsCoach = !!latest && outstanding.some((a) => a.id === latest.id);
  const latestCard = latest ? (
    <button
      type="button"
      onClick={() => onOpen(latest.id)}
      className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted/30"
      data-latest-assessment
    >
      <CleoAvatar size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">
            {MILESTONE_BY_KIND[latest.kind as keyof typeof MILESTONE_BY_KIND].title} · v
            {latest.version}
          </span>
          {!latest.coach_opened_at ? (
            <span className="h-2 w-2 rounded-full bg-[#0095f6]" aria-label="Unread" />
          ) : null}
          <span className="text-[12px] text-muted-foreground">
            {COACH_STATE_WORD[coachState(latest)]} · {fmtWhen(latest.created_at)}
          </span>
        </div>
        <p className="mt-1 text-[15px] font-semibold">{latest.headline}</p>
        {latest.coach_message ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{latest.coach_message}</p>
        ) : null}
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  ) : null;

  // Cleo writing: the progress card takes the place of the version it replaces
  const writing = (rewrite.data?.live ?? []) as any[];
  const replacing = new Set(writing.map((l) => l.request?.assessmentId).filter(Boolean));
  const progressCards = writing.map((l) => (
    <RewriteProgressCard
      key={l.milestoneId}
      live={l}
      now={rewrite.now}
      typical={rewrite.data!.typical}
      competitionId={comp.id}
      onRetried={rewrite.refetch}
      onOpenCurrent={l.request ? () => onOpen(l.request.assessmentId) : undefined}
    />
  ));
  const showLatest = !!latest && !replacing.has(latest.id);

  if (part === "lead")
    return progressCards.length || (showLatest && needsCoach) ? (
      <div className="space-y-3" data-competition-lead>
        {progressCards}
        {showLatest && needsCoach ? latestCard : null}
      </div>
    ) : null;

  return (
    <div className="space-y-4" data-competition-overview>
      {part === "all" ? progressCards : null}
      {part === "all" && showLatest && needsCoach ? latestCard : null}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Tile
          label="Countdown"
          value={brief ? countdownWords(brief.daysOut) : fmtDate(comp.meet_date)}
          sub={
            nextMilestone
              ? nextMilestone.status === "waiting_ai" || nextMilestone.status === "generating"
                ? `${MILESTONE_BY_KIND[nextMilestone.kind as keyof typeof MILESTONE_BY_KIND].title}: being written now`
                : `Next: ${MILESTONE_BY_KIND[nextMilestone.kind as keyof typeof MILESTONE_BY_KIND].title}, ${shortDate(nextMilestone.due_on)}`
              : brief
                ? PHASE_LABEL[brief.phase as keyof typeof PHASE_LABEL]
                : undefined
          }
        />
        <Tile
          label="Projected total"
          value={
            brief?.forecast?.total ? (
              <span className="tabular-nums">{brief.forecast.total.expected} kg</span>
            ) : (
              "Not enough data"
            )
          }
          sub={
            brief?.forecast?.total
              ? `${brief.forecast.total.conservative} to ${brief.forecast.total.high} · ${brief.forecast.confidence} confidence${comp.target_total_kg ? ` · target ${comp.target_total_kg}` : ""}`
              : undefined
          }
        />
        <Tile
          label="Projected placing"
          value={brief?.landscape?.place ? ordinal(brief.landscape.place.expected) : "No field yet"}
          sub={
            brief?.landscape?.place && brief.landscape.place.best !== brief.landscape.place.worst
              ? `${ordinal(brief.landscape.place.best)} to ${ordinal(brief.landscape.place.worst)}`
              : comp.objective
                ? OBJECTIVE_LABEL[comp.objective as keyof typeof OBJECTIVE_LABEL]
                : undefined
          }
        />
        <Tile
          label="Biggest threat"
          value={brief?.landscape?.biggest ? brief.landscape.biggest.name : "None on file"}
          sub={
            brief?.landscape?.biggest ? (
              `expected ${brief.landscape.biggest.expected} kg`
            ) : (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => onSection("field")}
              >
                Add competitors
              </button>
            )
          }
        />
        <Tile
          label="Readiness"
          value={
            serious.length
              ? `${serious.length} serious`
              : concerns.length
                ? `${concerns.length} to watch`
                : "No concerns"
          }
          tone={serious.length ? "bad" : concerns.length ? "warn" : undefined}
          sub={concerns[0]?.text}
        />
        <Tile label="Game plan" value={planStatus} />
      </div>

      {latest ? (
        needsCoach || !showLatest ? null : (
          latestCard
        )
      ) : writing.length ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-border p-4 text-[14px]">
          <span className="text-muted-foreground">
            {nextMilestone
              ? `Cleo's first assessment is scheduled for ${fmtDate(nextMilestone.due_on)}.`
              : "No assessment yet."}
          </span>
          <Button
            size="sm"
            variant="outline"
            loading={runNow.isPending}
            onClick={() => runNow.mutate()}
          >
            Write it now
          </Button>
        </div>
      )}

      {outstanding.filter((a) => !beingRewritten.has(a.id)).length > 1 ? (
        <Card title="Waiting on you">
          <ul className="divide-y divide-border">
            {outstanding.filter((a) => !beingRewritten.has(a.id)).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left text-[14px]"
                >
                  <span className="min-w-0">
                    <span className="font-medium">
                      {MILESTONE_BY_KIND[a.kind as keyof typeof MILESTONE_BY_KIND].title}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {COACH_STATE_WORD[coachState(a)]}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {a.headline}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {brief?.watch?.length ? (
        <Card
          title="What Cleo's watching"
          sub="From their training, bodyweight, pain, check-ins and program, read daily"
        >
          <ul className="space-y-1.5 text-[14px]">
            {brief.watch.slice(0, 8).map((w: any) => (
              <li key={w.key} className="flex gap-2">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    w.severity === "serious"
                      ? "bg-destructive"
                      : w.severity === "concern"
                        ? "bg-warning"
                        : "bg-muted-foreground/50",
                  )}
                />
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {brief?.call?.recommend ? (
        <Card
          title={`A strategy call is worth it now · ${brief.call.minutes} min`}
          sub={brief.call.coverage.text}
        >
          <ul className="space-y-1 text-[14px]">
            {brief.call.reasons.map((r: string, i: number) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Nothing is booked or charged unless you book it from their chat or the calendar.
          </p>
        </Card>
      ) : null}

      {brief?.missing ? <MissingInfo missing={brief.missing} /> : null}
    </div>
  );
}

function MissingInfo({
  missing,
}: {
  missing: { essential: string[]; improves: string[]; optional: string[]; retrieved: string[] };
}) {
  const groups: Array<[string, string[], string]> = [
    ["Essential", missing.essential, "bg-destructive"],
    ["Would sharpen the strategy", missing.improves, "bg-warning"],
    ["Optional", missing.optional, "bg-muted-foreground/50"],
    ["Already retrieved", missing.retrieved, "bg-success"],
  ];
  if (!groups.some(([, xs]) => xs.length)) return null;
  return (
    <Card title="Information" sub="Only what can't be read from the app is asked of you">
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map(([title, items, dot]) =>
          items.length ? (
            <div key={title}>
              <p className="text-[12px] font-medium text-muted-foreground">{title}</p>
              <ul className="mt-1 space-y-1 text-[14px]">
                {items.map((x, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </Card>
  );
}

function Timeline({
  comp,
  milestones,
  assessments,
  rewrite,
  onOpen,
  onRun,
}: {
  comp: any;
  milestones: any[];
  assessments: any[];
  rewrite: RewriteProgress;
  onOpen: (id: string) => void;
  onRun: () => void;
}) {
  const run = useServerFn(runMilestoneNowFn);
  const retry = useServerFn(retryRewriteFn);
  const go = useMutation({
    // a stopped one starts again keeping what Cleo already finished; a scheduled one is written now
    mutationFn: async (m: { id: string; kind: any; status: string }) => {
      if (m.status === "failed") await retry({ data: { competitionId: comp.id, milestoneId: m.id } });
      else await run({ data: { competitionId: comp.id, kind: m.kind } });
    },
    onSuccess: () => {
      onRun();
      toast.success("Queued for Cleo");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't queue it"),
  });
  const liveById = new Map((rewrite.data?.live ?? []).map((l) => [l.milestoneId, l]));
  const rows = [...milestones].sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
  return (
    <Card
      title="Preparation timeline"
      sub="Each milestone is written on its day by itself; you're told when it's ready"
    >
      <ol className="space-y-3" data-competition-timeline>
        {rows.map((m) => {
          const def = MILESTONE_BY_KIND[m.kind as keyof typeof MILESTONE_BY_KIND];
          const versions = assessments
            .filter((a) => a.kind === m.kind)
            .sort((a, b) => b.version - a.version);
          const current = versions.find((a) => a.status !== "superseded") ?? versions[0];
          const newer = (a: any) => !!a.superseded_at;
          return (
            <li
              key={m.id}
              className={cn(
                "rounded-xl border border-border p-3",
                m.status === "skipped" && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-semibold">
                    {def.title}
                    {m.seq ? ` ${m.seq}` : ""}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                    {fmtDate(m.due_on)} ·{" "}
                    {m.status === "ready"
                      ? `Done ${fmtWhen(m.done_at)}`
                      : m.status === "skipped"
                        ? "Skipped"
                        : m.status === "generating" || m.status === "waiting_ai"
                          ? liveById.get(m.id) && rewrite.data
                            ? (() => {
                                const v = rewriteView(liveById.get(m.id)!, rewrite.now, rewrite.data.typical);
                                return v.time ? `Being written · ${v.time.toLowerCase()}` : "Being written";
                              })()
                            : "Being written"
                          : m.status === "failed"
                            ? `Couldn't be written: ${m.last_error ?? "error"}`
                            : "Scheduled"}
                    {m.why && m.status !== "ready" ? ` · ${m.why}` : ""}
                  </p>
                </div>
                {m.status === "failed" || (m.status === "scheduled" && m.kind !== "debrief") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={go.isPending && go.variables?.id === m.id}
                    onClick={() => go.mutate({ id: m.id, kind: m.kind, status: m.status })}
                  >
                    {m.status === "failed" ? "Try again" : "Write now"}
                  </Button>
                ) : null}
              </div>
              {current ? (
                <button
                  type="button"
                  onClick={() => onOpen(current.id)}
                  className="mt-2 w-full rounded-lg bg-muted/40 p-2 text-left text-[13px] hover:bg-muted/70"
                >
                  <span className="font-medium">v{current.version}</span> · {current.headline}
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    Coach: {COACH_STATE_WORD[coachState(current)]} · Athlete:{" "}
                    {ATHLETE_STATE_WORD[athleteState(current, newer(current))]}
                  </span>
                </button>
              ) : null}
              {versions.length > 1 ? (
                <details className="mt-1 text-[12px] text-muted-foreground">
                  <summary className="cursor-pointer">
                    {versions.length - 1} earlier version{versions.length === 2 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {versions
                      .filter((v) => v.id !== current?.id)
                      .map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline"
                            onClick={() => onOpen(v.id)}
                          >
                            v{v.version} · {fmtWhen(v.created_at)} ·{" "}
                            {COACH_STATE_WORD[coachState(v)]}
                          </button>
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Resources({
  clientId,
  competitionId,
  resources,
  missing,
}: {
  clientId: string;
  competitionId: string;
  resources: any[];
  missing: any;
}) {
  const qc = useQueryClient();
  const add = useServerFn(addResourceFn);
  const remove = useServerFn(removeResourceFn);
  const [draft, setDraft] = useState({
    kind: "link" as "link" | "note" | "rules" | "schedule" | "roster",
    title: "",
    url: "",
    body: "",
  });
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
  const save = useMutation({
    mutationFn: () =>
      add({
        data: {
          competitionId,
          kind: draft.kind,
          title: draft.title.trim() || (draft.url ? new URL(draft.url).hostname : "Note"),
          url: draft.url.trim() || null,
          body: draft.body.trim() || null,
        },
      }),
    onSuccess: () => {
      refresh();
      setDraft({ kind: "link", title: "", url: "", body: "" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add it"),
  });
  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { resourceId: id } }),
    onSuccess: refresh,
  });
  const urlOk = !draft.url || /^https?:\/\/\S+$/i.test(draft.url.trim());
  return (
    <div className="space-y-4">
      {missing ? <MissingInfo missing={missing} /> : null}
      <Card
        title="Add a resource"
        sub="Federation pages, the meet's schedule, rules, nominations, notes. Rosters go in through the Field."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(["link", "note", "rules", "schedule"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDraft({ ...draft, kind: k })}
                className={cn(
                  "h-8 rounded-full px-3 text-[13px] capitalize",
                  draft.kind === k ? "bg-secondary font-medium" : "text-muted-foreground",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
            placeholder="https://… (LiftingCast, OpenPowerlifting, the federation's page)"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <textarea
            className="w-full rounded-lg border border-input bg-background p-3 text-[14px]"
            rows={3}
            placeholder="Notes or pasted text"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <Button
            size="sm"
            disabled={!urlOk || (!draft.url.trim() && !draft.body.trim())}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Add
          </Button>
        </div>
      </Card>
      <Card title="Resources">
        {resources.length ? (
          <ul className="divide-y divide-border">
            {resources.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 py-2 text-[14px]">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline-offset-2 hover:underline"
                      >
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                    <span className="ml-2 text-[12px] font-normal capitalize text-muted-foreground">
                      {r.kind}
                    </span>
                  </p>
                  {r.body ? (
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[13px] text-muted-foreground">
                      {r.body}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="text-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => del.mutate(r.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted-foreground">Nothing added yet.</p>
        )}
      </Card>
    </div>
  );
}

function History({
  clientId,
  sel,
  competitions,
  onOpen,
}: {
  clientId: string;
  sel: any;
  competitions: any[];
  onOpen: (id: string) => void;
}) {
  const comp = sel.competition;
  const qc = useQueryClient();
  const saveFn = useServerFn(saveResultsFn);
  const statusFn = useServerFn(setCompetitionStatusFn);
  const [r, setR] = useState({ squat: "", bench: "", deadlift: "", place: "", bodyweight: "" });
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
  const save = useMutation({
    mutationFn: (fromLog: boolean) =>
      saveFn({
        data: {
          competitionId: comp.id,
          fromLog,
          results: fromLog
            ? null
            : {
                squat: Number(r.squat) || null,
                bench: Number(r.bench) || null,
                deadlift: Number(r.deadlift) || null,
                place: r.place.trim() || null,
                bodyweight: Number(r.bodyweight) || null,
              },
        },
      }),
    onSuccess: () => {
      refresh();
      toast.success("Results saved: the debrief is written next");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save the results"),
  });
  const status = useMutation({
    mutationFn: (x: { status?: "cancelled" | "upcoming"; primary?: boolean }) =>
      statusFn({ data: { competitionId: comp.id, ...x } }),
    onSuccess: refresh,
  });
  const past = competitions.filter((c) => c.status === "completed" && c.id !== comp.id);
  const debrief = sel.debrief;
  return (
    <div className="space-y-4">
      <Card
        title="Results"
        sub={
          comp.results
            ? `From ${comp.results.source === "opl" ? "OpenPowerlifting" : comp.results.source === "meet_log" ? "the meet-day log" : "you"}`
            : "Entered by you, from the meet-day log, or picked up from OpenPowerlifting after the meet"
        }
      >
        {comp.results ? (
          <p className="text-[15px]">
            <Kg kg={comp.results.squat} lb={false} /> / <Kg kg={comp.results.bench} lb={false} /> /{" "}
            <Kg kg={comp.results.deadlift} lb={false} /> · total{" "}
            <Kg kg={comp.results.total} className="font-semibold" />
            {comp.results.place ? ` · ${comp.results.place}` : ""}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2">
              {(["squat", "bench", "deadlift", "place", "bodyweight"] as const).map((k) => (
                <input
                  key={k}
                  className="h-10 rounded-lg border border-input bg-background px-2 text-[14px]"
                  inputMode="decimal"
                  placeholder={k === "bodyweight" ? "BW kg" : k[0].toUpperCase() + k.slice(1)}
                  value={r[k]}
                  onChange={(e) => setR({ ...r, [k]: e.target.value })}
                  aria-label={k}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!r.squat || !r.bench || !r.deadlift}
                loading={save.isPending && !save.variables}
                onClick={() => save.mutate(false)}
              >
                Save results
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={save.isPending && !!save.variables}
                onClick={() => save.mutate(true)}
              >
                Use the meet-day log
              </Button>
            </div>
          </div>
        )}
      </Card>
      {debrief ? (
        <Card title="Projected against actual">
          <ul className="space-y-1 text-[14px]">
            {debrief.findings.map((f: string, i: number) => (
              <li key={i}>· {f}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Record" sub="Every change, who made it and when">
        <ul className="space-y-1 text-[13px]" data-competition-record>
          {(sel.events as any[]).map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-muted-foreground">{fmtWhen(e.at)}</span>
              <span className="capitalize">{e.actor}</span>
              <span>{String(e.action).replace(/_/g, " ")}</span>
              {e.assessment_id ? (
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => onOpen(e.assessment_id)}
                >
                  open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {past.length ? (
        <Card title="Earlier competitions">
          <ul className="space-y-1 text-[14px]">
            {past.map((c) => (
              <li key={c.id}>
                {c.name} · {fmtDate(c.meet_date)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!comp.is_primary && comp.status === "upcoming" ? (
          <Button size="sm" variant="outline" onClick={() => status.mutate({ primary: true })}>
            Make primary
          </Button>
        ) : null}
        {comp.status === "upcoming" ? (
          <Button size="sm" variant="ghost" onClick={() => status.mutate({ status: "cancelled" })}>
            Not competing anymore
          </Button>
        ) : null}
        {comp.status === "cancelled" ? (
          <Button size="sm" variant="outline" onClick={() => status.mutate({ status: "upcoming" })}>
            Back on
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default CompetitionWorkspace;
