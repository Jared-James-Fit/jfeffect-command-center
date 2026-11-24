/**
 * Client profile → Nutrition → Nutrition roadmap (#roadmap): the coach's view
 * of the athlete's roadmap. The draft or change waiting on them comes first
 * (what changed, the targets it would set, Approve / Decline), then where
 * they stand, the journey, whether the goal is realistic, the next review and
 * the history; the coach's settings (review cadence, locked competition
 * phases) are one section. Approving a change to the targets hands it to
 * Change it with AI, the plan's own reviewed path: nothing here writes the
 * nutrition plan. The goal itself is the Weight management card's.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Route, Settings2 } from "lucide-react";
import { makeAndDeliverPdf } from "@/lib/pdf/deliver";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { CardHeader, Section } from "@/components/nutrition/nutrition-ui";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/today";
import { fmtDay } from "@/lib/weight-management/units";
import { prefillPlanAiChange } from "@/lib/weight-management/handoff";
import { decideRoadmapRevisionFn, refreshClientRoadmapFn, saveRoadmapPrefsFn } from "@/lib/nutrition-roadmap/roadmap.functions";
import { kcalWords, type CoachRoadmapView } from "@/lib/nutrition-roadmap/view";
import { RoadmapChart } from "@/components/nutrition-roadmap/roadmap-chart";
import { BlockTimeline, FeasibilityDetail, HistoryList, StatusBadge, StatusLine, VerdictChip } from "@/components/nutrition-roadmap/roadmap-parts";
import { ROADMAP_ROOT, useClientRoadmap } from "@/components/nutrition-roadmap/roadmap-queries";

const day = (iso: string) => fmtDay(iso, todayLocalISO());
const TRIGGER: Record<string, string> = {
  initial: "First draft",
  goal_change: "The goal changed",
  reforecast: "Reforecast",
  checkin: "After a check-in",
  coach: "Your refresh",
  adjustment: "A change to the targets",
};
const CADENCES: Array<[number | null, string]> = [
  [null, "Automatic"],
  [7, "Every 7 days"],
  [10, "Every 10 days"],
  [14, "Every 14 days"],
  [21, "Every 21 days"],
];

export function RoadmapCoachCard({ clientId, className }: { clientId: string; className?: string }) {
  const q = useClientRoadmap(clientId);
  const qc = useQueryClient();
  const decide = useServerFn(decideRoadmapRevisionFn);
  const refresh = useServerFn(refreshClientRoadmapFn);
  const savePrefs = useServerFn(saveRoadmapPrefsFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const v = q.data;

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#roadmap" && v) document.getElementById("roadmap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [v]);

  const header = (chip?: ReactNode, actions?: ReactNode) => <CardHeader icon={Route} title="Nutrition roadmap" chip={chip} actions={actions} />;
  if (q.isLoading) return <Card id="roadmap" className={cn("p-4 md:p-5", className)}>{header()}<div className="mt-3 h-16 jf-skeleton rounded-lg bg-muted" /></Card>;
  if (q.isError || !v) return <Card id="roadmap" className={cn("p-4 md:p-5", className)}>{header()}<p className="mt-2 text-[14px] text-muted-foreground">Couldn't load the roadmap.</p></Card>;

  const done = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ROADMAP_ROOT });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  const approve = (decision: "approve" | "reject") =>
    done(async () => {
      const r = await decide({ data: { revisionId: v.pending!.id, decision, note: note.trim() || null } });
      setNote("");
      if (decision === "approve" && r.instruction) {
        prefillPlanAiChange(clientId, r.instruction);
        toast.success("Roadmap approved", { description: "The change to the targets is in Adjust plan for you to send and review.", duration: 8000 });
      } else toast.success(decision === "approve" ? "Roadmap approved: the athlete sees it now" : "Declined: the roadmap stays as it was");
    }, decision);

  const refreshNow = () =>
    done(async () => {
      const r = await refresh({ data: { clientId } });
      toast.success(r.created ? "A new version is waiting for your OK" : "Nothing meaningful changed");
    }, "refresh");

  const actions = (
    <div className="flex items-center">
      {v?.read && (
        <Button
          variant="ghost"
          size="sm"
          className="h-10"
          aria-label="Download the roadmap as a PDF"
          data-roadmap-pdf
          onClick={() => void makeAndDeliverPdf("Nutrition roadmap", async () => (await import("@/lib/nutrition-roadmap/roadmap-pdf")).roadmapPdfFile(v, "coach"))}
        >
          <Download className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-10" onClick={() => void refreshNow()} disabled={!!busy} aria-label="Read the roadmap again now">
        {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      </Button>
    </div>
  );

  if (v.state === "no_goal" || !v.read) {
    return (
      <Card id="roadmap" className={cn("p-4 md:p-5", className)} data-roadmap-coach="no-goal">
        {header(undefined, actions)}
        <p className="mt-2 text-[14px] text-muted-foreground">Nothing to plan yet. Set a bodyweight goal (Weight management, below), a meet prep, or a nutrition plan with a phase, and the roadmap drafts itself for your OK.</p>
        {v.missing.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
            {v.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const read = v.read;
  const p = v.pending;
  const prefs = v.prefs;
  const setPrefs = (next: Partial<typeof prefs>) => done(() => savePrefs({ data: { clientId, ...prefs, ...next } }), "prefs");

  return (
    <Card id="roadmap" className={cn("space-y-4 p-4 md:p-5", className)} data-roadmap-coach="ready">
      {header(<StatusBadge status={read.progress.status} />, actions)}

      {p && (
        <div className="space-y-2 rounded-lg border border-warning/40 p-3" data-roadmap-proposal={p.trigger}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[15px] font-semibold">{TRIGGER[p.trigger] ?? "Waiting on you"}</div>
            <span className="text-[12px] text-muted-foreground">{day(p.createdAt.slice(0, 10))}</span>
          </div>
          <ul className="space-y-0.5 text-[14px] text-muted-foreground">
            {(p.trigger === "initial" ? [p.plan.feasibility.headline, `${p.plan.blocks.length} blocks to ${p.plan.blocks[p.plan.blocks.length - 1] ? day(p.plan.blocks[p.plan.blocks.length - 1].end) : ""}`] : p.changes.filter((c) => c !== p.proposal?.headline)).slice(0, 6).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {p.proposal?.next && p.proposal.kcalChange != null && (
            <div className="rounded-md bg-muted/50 p-2.5 text-[14px] tabular-nums">
              Targets: {p.proposal.next.kcal} kcal · P {p.proposal.next.proteinG} · C {p.proposal.next.carbsG} · F {p.proposal.next.fatG}
              {p.proposal.kcalChange !== 0 && <span className="text-muted-foreground"> ({kcalWords(p.proposal.kcalChange)})</span>}
              <div className="mt-0.5 text-[12px] text-muted-foreground">Approving puts this in Adjust plan; the plan only changes once you send and review it there.</div>
            </div>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="Note (optional, only you see it)" className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base" />
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void approve("approve")} disabled={!!busy} data-roadmap-approve>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
            </Button>
            <Button className="h-11 flex-1" variant="outline" onClick={() => void approve("reject")} disabled={!!busy}>
              Decline
            </Button>
          </div>
          {!v.activeRevisionId && <p className="text-[12px] text-muted-foreground">{v.firstName} sees nothing until you approve.</p>}
        </div>
      )}

      <StatusLine read={read} explanation={v.explanation} />
      {read.decision.action !== "hold" && (
        <div className="rounded-lg bg-muted/50 p-3 text-[14px]" data-roadmap-decision={read.decision.action}>
          <div className="font-medium">{read.decision.headline}</div>
          {[...new Set([...read.decision.reasons.slice(0, 2), ...read.decision.other.slice(0, 2)])].map((r) => (
            <p key={r} className="text-muted-foreground">{r}</p>
          ))}
        </div>
      )}
      {read.plan.safety.flags.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/40 p-3 text-[14px]" data-roadmap-safety>
          {read.plan.safety.flags.map((f) => (
            <li key={f.key}>{f.text}</li>
          ))}
        </ul>
      )}

      <RoadmapChart read={read} series={v.series} unit={v.unit} />

      <div className="text-[14px]">
        <span className="font-medium">Next review {day(read.checkin.on)}</span> <span className="text-muted-foreground">· {read.checkin.reason}</span>
        {read.checkin.asks.length > 0 && <div className="text-[13px] text-muted-foreground">Asked in their weekly check-in: {read.checkin.asks.join(", ")}</div>}
      </div>

      <Accordion type="multiple" defaultValue={["journey"]} className="rounded-xl border border-border">
        <Section value="journey" title="The journey" sub={`${read.plan.blocks.length} blocks`}>
          <BlockTimeline plan={read.plan} unit={v.unit} />
        </Section>
        <Section value="feasibility" title="Is the goal realistic?" sub={<VerdictChip verdict={read.plan.feasibility.verdict} />}>
          <FeasibilityDetail f={read.plan.feasibility} unit={v.unit} />
          <p className="mt-2 text-[13px] text-muted-foreground">
            Maintenance estimate {read.plan.energy.kcal} kcal ({read.plan.energy.lowKcal}–{read.plan.energy.highKcal}, {read.plan.energy.confidence} confidence). {read.plan.energy.why} Lowest planned intake {read.plan.energy.floorKcal} kcal.
          </p>
        </Section>
        {v.draft && !p && (
          <Section value="draft" title="A fresh read from today" sub={`${v.draft.changes.length} change${v.draft.changes.length === 1 ? "" : "s"}`}>
            <ul className="space-y-0.5 text-[14px] text-muted-foreground">
              {v.draft.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button variant="outline" className="mt-2 h-10" onClick={() => void refreshNow()} disabled={!!busy}>
              Propose it
            </Button>
          </Section>
        )}
        <Section value="settings" title="Settings" sub={prefs.everyDays ? `Reviews every ${prefs.everyDays} days` : "Automatic reviews"}>
          <div className="space-y-3 text-[14px]">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 font-medium">
                <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                Review cadence
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CADENCES.map(([d, label]) => (
                  <button key={label} type="button" onClick={() => void setPrefs({ everyDays: d })} aria-pressed={prefs.everyDays === d} disabled={!!busy} className={cn("min-h-10 rounded-full border px-3 text-[13px]", prefs.everyDays === d ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">Automatic: about a week while there's little data, 3–7 days near a milestone or when off plan, 10–14 days when stable. A health flag always comes sooner.</p>
            </div>
            <label className="flex items-start justify-between gap-3">
              <span>
                Lock the competition phases
                <span className="block text-[12px] text-muted-foreground">The peak, meet week and recovery stay exactly as approved while the date holds.</span>
              </span>
              <Switch checked={prefs.lockCompetition} onCheckedChange={(on) => void setPrefs({ lockCompetition: on })} disabled={!!busy} aria-label="Lock the competition phases" />
            </label>
          </div>
        </Section>
        <Section value="history" title="History" sub={`${v.history.length}`}>
          <HistoryList history={v.history} />
        </Section>
      </Accordion>
    </Card>
  );
}
