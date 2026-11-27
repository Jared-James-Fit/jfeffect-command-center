/**
 * The athlete's side of meet preparation (Nov 26 2026), under their meet on
 * the Competition page: onboarding until it's done (then "Update my meet
 * details" any time), and four compact sections, Overview · Gameplan ·
 * Timeline · Checklist. The gameplan is only ever the version their handler or
 * coach approved: they confirm it, or suggest a change to their warm-ups,
 * racks and gear, which waits for approval and never changes the approved
 * plan. On the meet's day Meet-Day Mode leads. The read stays on the phone
 * (the app's saved queries), so it opens at a venue without signal, and the
 * PDF is made on the phone from it. A coach previewing them sees the page and
 * changes nothing.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, FileDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  confirmMyGameplanFn,
  getMyMeetFn,
  suggestMyGameplanFn,
  tickMyChecklistFn,
} from "@/lib/competition/handling.functions";
import { readGameplan } from "@/lib/competition/gameplan";
import { readRules } from "@/lib/competition/rules";
import { zoneLabel } from "@/lib/competition/event-timeline";
import { cn } from "@/lib/utils";
import { MeetOnboarding } from "./meet-onboarding";
import { MeetDayNow, myMeetKey } from "./meet-day-now";
import { GameplanView } from "./gameplan-view";
import { GameplanEditor } from "./gameplan-editor";
import { TimelineSection } from "./timeline-section";
import { ChecklistSection, applyChecklistChanges } from "./checklist-section";
import { readinessOf } from "@/lib/competition/prep-checklist";
import { ReadinessWord, countdown, dayWords } from "./prep-ui";

type Tab = "overview" | "gameplan" | "timeline" | "checklist";
const TABS: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["gameplan", "Gameplan"],
  ["timeline", "Timeline"],
  ["checklist", "Checklist"],
];

export function AthleteMeet({
  competitionId,
  clientId,
  previewing,
  startOnboarding,
}: {
  competitionId: string;
  clientId: string | null;
  previewing: boolean;
  startOnboarding?: boolean;
}) {
  const read = useServerFn(getMyMeetFn);
  const confirm = useServerFn(confirmMyGameplanFn);
  const suggest = useServerFn(suggestMyGameplanFn);
  const tickFn = useServerFn(tickMyChecklistFn);
  const qc = useQueryClient();
  const key = myMeetKey(competitionId, clientId);
  const q = useQuery({ queryKey: key, queryFn: () => read({ data: { competitionId, clientId } }), staleTime: 60_000 });
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [onboarding, setOnboarding] = useState<boolean>(!!startOnboarding);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["my-meet", competitionId] }); void qc.invalidateQueries({ queryKey: ["goals-service-scope"] }); };

  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });

  if (q.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const m = q.data as any;
  if (!m) return null;
  const c = m.competition;
  const today: string = m.today;
  const meetDay = c.status === "upcoming" && today >= String(c.meet_date) && today <= String(c.meet_end_date ?? c.meet_date);
  const needsOnboarding = !!m.handling && m.handling.status !== "cancelled" && (!m.infoComplete || !m.handling.termsAcceptedAt);
  const showWizard = (onboarding || (!previewing && needsOnboarding)) && c.status === "upcoming";
  const plan = m.plan ? readGameplan(m.plan.doc) : null;
  const rules = readRules(c.rules, c.federation);

  const pdf = async () => {
    if (!plan) return;
    const { makeAndDeliverPdf } = await import("@/lib/pdf/deliver");
    const { buildGameplanPdf } = await import("@/lib/competition/gameplan-pdf");
    await makeAndDeliverPdf("Gameplan", () =>
      buildGameplanPdf({
        athlete: m.client.name,
        meet: c.name,
        date: String(c.meet_date),
        location: c.location ?? null,
        zone: zoneLabel(m.tz, new Date(`${c.meet_date}T12:00:00Z`)),
        version: m.plan.version,
        status: "approved",
        approvedAt: m.plan.approvedAt,
        updatedAt: m.plan.approvedAt,
        plan,
        timeline: m.timeline,
        checklist: m.checklist,
      }),
    );
  };

  if (showWizard)
    return (
      <MeetOnboarding
        meet={m}
        previewing={previewing}
        onDone={() => {
          setOnboarding(false);
          if (!previewing) refresh();
        }}
        onClose={needsOnboarding && !previewing ? undefined : () => setOnboarding(false)}
      />
    );

  return (
    <div className="space-y-3" data-athlete-meet>
      {meetDay ? <MeetDayNow competitionId={competitionId} clientId={clientId} who="athlete" /> : null}

      <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Meet preparation">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              setEditing(false);
            }}
            className={cn("h-9 shrink-0 rounded-full px-3 text-[13px]", tab === k ? "bg-secondary font-medium" : "text-muted-foreground")}
            aria-current={tab === k ? "page" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[12px] text-muted-foreground">Countdown</p>
              <p className="text-[20px] font-semibold leading-tight">{countdown(today, String(c.meet_date))}</p>
              <p className="text-[12px] text-muted-foreground">{dayWords(String(c.meet_date))}</p>
            </div>
            <button type="button" onClick={() => setTab("checklist")} className="rounded-2xl border border-border bg-card p-4 text-left">
              <p className="text-[12px] text-muted-foreground">Readiness</p>
              <ReadinessWord verdict={m.readiness.verdict} className="text-[20px] leading-tight" />
              <p className="text-[12px] text-muted-foreground">{m.readiness.line}</p>
            </button>
          </div>
          {m.next ? (
            <p className="rounded-2xl border border-border bg-card p-4 text-[14.5px]" data-athlete-next>
              <span className="text-muted-foreground">Next: </span>
              {m.next.label} · {m.next.when}
            </p>
          ) : null}
          {plan && !m.plan.confirmedAt ? (
            <button
              type="button"
              onClick={() => setTab("gameplan")}
              className="w-full rounded-2xl border border-border bg-card p-4 text-left text-[14.5px]"
            >
              Your gameplan is ready. Have a look and confirm it.
            </button>
          ) : null}
          {c.status === "upcoming" && (!m.infoComplete || needsOnboarding) ? (
            <button
              type="button"
              onClick={() => setOnboarding(true)}
              className="w-full rounded-2xl border border-border bg-card p-4 text-left"
              data-start-meet-info
            >
              <p className="text-[14.5px] font-medium">Add your meet details</p>
              <p className="text-[12.5px] text-muted-foreground">A few minutes: your lifts, warm-ups, racks and travel. Your plan is built from them.</p>
            </button>
          ) : c.status === "upcoming" ? (
            <Button variant="outline" className="w-full" onClick={() => setOnboarding(true)} data-update-meet-info>
              <Pencil className="h-4 w-4" /> Update my meet details
            </Button>
          ) : null}
          {m.handling?.handler ? (
            <p className="text-center text-[12.5px] text-muted-foreground">
              {m.handling.handler} is handling you at this meet
              {m.handling.existingCoachName ? ` · ${m.handling.existingCoachName} still writes your training` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "gameplan" ? (
        editing && plan && m.plan ? (
          <GameplanEditor
            initial={plan}
            rules={rules}
            who="athlete"
            saving={act.isPending}
            onCancel={() => setEditing(false)}
            onSave={(p, _mode, note) =>
              act.mutate(async () => {
                await suggest({ data: { competitionId, basedOn: m.plan.id, plan: p as any, note: note ?? null } });
                setEditing(false);
                toast.success("Sent. Your plan stays as it is until it's approved.");
              })
            }
          />
        ) : plan ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                Version {m.plan.version} · approved {dayWords(String(m.plan.approvedAt).slice(0, 10))}
              </p>
              <Button size="sm" variant="ghost" onClick={() => void pdf()} aria-label="Download PDF" data-athlete-pdf>
                <FileDown className="h-4 w-4" />
              </Button>
              {!previewing && c.status === "upcoming" ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-suggest-change>
                  Suggest a change
                </Button>
              ) : null}
            </div>
            {m.mySuggestion ? (
              <p className="rounded-2xl border border-border p-3 text-[13px] text-muted-foreground" data-my-suggestion>
                Your suggested change is waiting for approval: {(m.mySuggestion.changes ?? []).map((x: any) => x.text).slice(0, 2).join("; ")}
              </p>
            ) : null}
            <GameplanView plan={plan} compact />
            {m.plan.confirmedAt ? (
              <p className="flex items-center justify-center gap-1 text-[13px] text-success">
                <Check className="h-4 w-4" /> You confirmed this version
              </p>
            ) : (
              <Button
                className="w-full"
                loading={act.isPending}
                disabled={previewing}
                onClick={() =>
                  act.mutate(async () => {
                    await confirm({ data: { competitionId, versionId: m.plan.id } });
                    toast.success("Confirmed");
                  })
                }
                data-confirm-gameplan
              >
                {previewing ? "They confirm it here" : "Looks good, confirm"}
              </Button>
            )}
            <p className="text-center text-[12px] text-muted-foreground">Saved on this phone, so it opens at the venue without signal.</p>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-4 text-[14px] text-muted-foreground">
            Your gameplan shows up here once it's approved.
          </p>
        )
      ) : null}

      {tab === "timeline" ? <TimelineSection timeline={m.timeline} tz={m.tz} today={today} /> : null}

      {tab === "checklist" ? (
        <ChecklistSection
          key={competitionId}
          competitionId={competitionId}
          items={m.checklist}
          readiness={m.readiness}
          today={today}
          who="athlete"
          onTick={previewing ? undefined : async (k, state) => {
            await tickFn({ data: { competitionId, key: k, state } });
            const prefix = ["my-meet", competitionId];
            await qc.cancelQueries({ queryKey: prefix });
            qc.setQueriesData<any>({ queryKey: prefix }, (old) => {
              if (!old?.checklist) return old;
              const checklist = applyChecklistChanges(old.checklist, [{ key: k, state }]);
              return { ...old, checklist, readiness: readinessOf(checklist, old.today) };
            });
            // The confirmed cache is already updated; don't block the next tap on a full reload.
            void qc.invalidateQueries({ queryKey: prefix });
            void qc.invalidateQueries({ queryKey: ["goals-service-scope"] });
          }}
        />
      ) : null}
    </div>
  );
}
