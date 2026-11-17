/**
 * A meet prep's coach review on the client's Training tab, under the program's
 * alerts: the lifting day still to confirm (Confirm lifting day: the lift-by-lift
 * taper or the even shift, previewed before anything moves), and each lift's
 * Training Max only when there's something to say (prep-review.server.ts): a
 * trend past its RPE caps with a slightly lower one to set, one session being
 * watched, a calibration read with a conservative one to set, or the
 * calibration still to come. The coach taps to set or move anything.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, Eye, Gauge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/block-schedule-model";
import { billingDay } from "@/lib/date-range";
import { applyMeetDayFn, getPrepReviewFn, previewMeetDayFn, setPrepTrainingMaxFn } from "@/lib/prep-review.functions";
import type { MeetDayPreview, PrepLift, PrepReview } from "@/lib/prep-review.server";
import { addDays, daysBetween } from "@/lib/workouts/meet-taper";
import { clientTrainingScheduleKey } from "@/lib/use-client-training-schedule";

const LIFT: Record<string, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const day = (iso: string) => billingDay(iso) ?? iso;
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

export const prepReviewKey = (clientId: string) => ["prep-review", clientId] as const;

type Line = { tone: "amber" | "quiet"; icon: "tm" | "watch" | "meet"; text: string; detail?: string | null; action?: { label: string; run: () => void } };

export function PrepReviewList({ clientId, clientName }: { clientId: string; clientName: string | null }) {
  const today = todayISO();
  const getReview = useServerFn(getPrepReviewFn);
  const { data } = useQuery({
    queryKey: [...prepReviewKey(clientId), today],
    queryFn: () => getReview({ data: { clientId, today } }) as Promise<PrepReview>,
    staleTime: 60_000,
  });
  const [meetOpen, setMeetOpen] = useState(false);
  const [tmFor, setTmFor] = useState<{ lift: PrepLift; kg: number; why: string } | null>(null);
  const first = clientName?.split(" ")[0] ?? "their";
  if (!data?.prep) return null;
  const prep = data.prep;

  const lines: Line[] = [];
  if (prep.dayTbd && prep.end) {
    lines.push({
      tone: "amber",
      icon: "meet",
      text: `${prep.eventName ?? "Meet"}: lifting day not confirmed (${day(prep.start)} – ${day(prep.end)})`,
      detail: "Week 11–12 are counted from the first day until you confirm it.",
      action: { label: "Confirm day", run: () => setMeetOpen(true) },
    });
  }
  for (const l of data.lifts) {
    const name = LIFT[l.lift];
    if (l.review?.status === "review" && l.review.suggestedKg != null) {
      const kg = l.review.suggestedKg;
      lines.push({
        tone: "amber",
        icon: "tm",
        text: `${name} Training Max ${l.tmKg} kg: ${l.review.hardSessions} of the last ${l.review.sessions.length} sessions ran past their RPE caps`,
        detail: l.review.reason,
        action: { label: `Review · ${kg} kg`, run: () => setTmFor({ lift: l, kg, why: `Lowered from ${l.tmKg} kg on ${day(today)}: ${l.review!.reason}` }) },
      });
    } else if (l.review?.status === "watch") {
      lines.push({ tone: "quiet", icon: "watch", text: `${name} Training Max ${l.tmKg} kg: one session ran past its cap, watching`, detail: l.review.reason });
    } else if (l.calibration?.status === "ready" && l.calibration.suggestedKg != null) {
      const kg = l.calibration.suggestedKg;
      lines.push({
        tone: "amber",
        icon: "tm",
        text: `${name} Training Max not set: the ${l.calibration.date ? day(l.calibration.date) : ""} calibration suggests ${kg} kg`,
        detail: l.calibration.basis,
        action: { label: `Review · ${kg} kg`, run: () => setTmFor({ lift: l, kg, why: `Set on ${day(today)} from the calibration: ${l.calibration!.basis}` }) },
      });
    } else if (l.calibration?.status === "need_more") {
      lines.push({ tone: "amber", icon: "tm", text: `${name} Training Max not set: ${l.calibration.missing}`, detail: "Nothing is suggested until the calibration can be read." });
    } else if (l.calibration?.status === "waiting") {
      lines.push({
        tone: "quiet",
        icon: "watch",
        text: `${name} Training Max not set yet${l.calibration.date ? `: calibration ${weekday(l.calibration.date)} ${day(l.calibration.date)}` : ""}`,
        detail: "% work on it goes by RPE until then.",
      });
    }
  }
  if (!lines.length) return null;

  return (
    <>
      <ul className="mt-2 space-y-2" data-prep-review>
        {lines.map((line, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
              line.tone === "amber"
                ? "border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                : "border border-border bg-muted/40 text-muted-foreground",
            )}
          >
            {line.icon === "meet" ? <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" /> : line.icon === "watch" ? <Eye className="mt-0.5 h-4 w-4 shrink-0" /> : line.tone === "amber" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Gauge className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block">{line.text}</span>
              {line.detail && <span className="mt-0.5 block text-xs opacity-80">{line.detail}</span>}
            </span>
            {line.action && (
              <Button size="sm" variant="outline" className="h-9 shrink-0 border-amber-500/50 bg-background/60 px-3 text-xs" onClick={line.action.run}>
                {line.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {meetOpen && <MeetDaySheet clientId={clientId} prep={prep} first={first} onClose={() => setMeetOpen(false)} />}
      {tmFor && <TrainingMaxDialog clientId={clientId} prepId={prep.id} value={tmFor} onClose={() => setTmFor(null)} />}
    </>
  );
}

function TrainingMaxDialog({ clientId, prepId, value, onClose }: { clientId: string; prepId: string; value: { lift: PrepLift; kg: number; why: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const setTm = useServerFn(setPrepTrainingMaxFn);
  const [busy, setBusy] = useState(false);
  const name = LIFT[value.lift.lift];
  const save = async () => {
    if (!value.lift.blockId) return;
    setBusy(true);
    try {
      const r = await setTm({ data: { clientId, prepId, fromBlockId: value.lift.blockId, lift: value.lift.lift, kg: value.kg, note: value.why } });
      toast.success(`${name} Training Max ${r.kg} kg`, { description: `Set on ${r.blocks} block${r.blocks === 1 ? "" : "s"}, from this one on. Logged sets don't change.` });
      qc.invalidateQueries({ queryKey: prepReviewKey(clientId) });
      qc.invalidateQueries({ queryKey: ["pl-maxes"] });
      qc.invalidateQueries({ queryKey: ["client-maxes", clientId] });
      qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't set it");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-prep-tm-dialog>
        <DialogHeader>
          <DialogTitle>
            {name} Training Max {value.lift.tmKg != null ? `${value.lift.tmKg} → ${value.kg} kg` : `${value.kg} kg`}
          </DialogTitle>
          <DialogDescription>{value.why}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          It applies to {value.lift.blockName ?? "this block"} and every later block of the prep: upcoming % work loads from it, the RPE stays the cap, and nothing already logged changes. It's a suggestion: you can also set any number in Athlete setup.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button onClick={save} disabled={busy || !value.lift.blockId}>{busy ? "Setting…" : `Set ${value.kg} kg`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetDaySheet({ clientId, prep, first, onClose }: { clientId: string; prep: NonNullable<PrepReview["prep"]>; first: string; onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useServerFn(previewMeetDayFn);
  const apply = useServerFn(applyMeetDayFn);
  const today = todayISO();
  const days: string[] = [];
  for (let d = prep.start; prep.end && d <= prep.end; d = addDays(d, 1)) days.push(d);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<"lift" | "even" | null>(null);
  const q = useQuery({
    queryKey: ["meet-day-preview", prep.id, pick, today],
    queryFn: () => preview({ data: { clientId, prepId: prep.id, day: pick!, today } }) as Promise<MeetDayPreview>,
    enabled: !!pick,
    staleTime: 30_000,
  });
  const p = q.data;
  const run = async (plan: "lift" | "even") => {
    if (!pick) return;
    setBusy(plan);
    try {
      const r = await apply({ data: { clientId, prepId: prep.id, day: pick, today, plan } });
      toast.success(`Lifting day ${weekday(pick)} ${day(pick)}`, { description: `${r.moved} session${r.moved === 1 ? "" : "s"} moved${plan === "lift" ? ", lift by lift" : ", each keeping its distance from the meet"}.` });
      qc.invalidateQueries({ queryKey: prepReviewKey(clientId) });
      qc.invalidateQueries({ queryKey: clientTrainingScheduleKey(clientId) });
      qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
      qc.invalidateQueries({ queryKey: ["my-workouts"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't move the taper");
    } finally {
      setBusy(null);
    }
  };
  const liftMoves = p?.plan.moves ?? [];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-meet-day-sheet>
        <SheetHeader>
          <SheetTitle>Confirm lifting day</SheetTitle>
          <SheetDescription>
            Weeks 11–12 move with it. Each lift's final heavy day is planned on its own from {first === "their" ? "their" : `${first}'s`} past meets and this prep, or keep the even shift. Weeks 1–10 don't move.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Lifting day">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={pick === d}
              onClick={() => setPick(d)}
              className={cn("h-11 min-w-[4.5rem] rounded-lg border px-3 text-sm", pick === d ? "border-foreground bg-foreground text-background" : "border-border bg-background")}
            >
              <span className="block text-xs opacity-70">{weekday(d)}</span>
              {day(d)}
            </button>
          ))}
        </div>
        {pick && q.isLoading && <p className="mt-4 text-sm text-muted-foreground">Planning the taper…</p>}
        {q.error && <p className="mt-4 text-sm text-destructive">{(q.error as Error).message}</p>}
        {p && (
          <div className="mt-5 space-y-5" data-meet-day-plan>
            <section>
              <h3 className="text-sm font-semibold">Final heavy day, lift by lift</h3>
              <ul className="mt-2 space-y-3">
                {p.plan.targets.map((t) => {
                  const f = p.plan.finalHeavy.find((x) => x.lift === t.lift);
                  return (
                    <li key={t.lift} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{LIFT[t.lift]}</span>
                        <span className="text-muted-foreground">
                          {f ? `${weekday(f.date)} ${day(f.date)} · ${f.daysOut} days out` : "not in the taper"}
                          {t.writtenDaysOut != null && f && f.daysOut !== t.writtenDaysOut ? ` (was ${t.writtenDaysOut})` : ""}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Window {t.window.min}–{t.window.max} days ·{" "}
                        {t.source === "history" ? `from ${t.confidence === "moderate" ? "his" : "a little of his"} meet history` : "as written (no past meets to read)"}
                      </div>
                      {t.evidence.length > 0 && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                          {t.evidence.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Sessions</h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
                {p.plan.sessions.map((s) => {
                  const moved = s.planned !== s.date;
                  return (
                    <li key={s.dayId} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate">{s.title.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) — /, "")}</span>
                      <span className={cn("shrink-0 text-xs", moved ? "font-medium text-foreground" : "text-muted-foreground")}>
                        {weekday(s.planned)} {day(s.planned)} · {daysBetween(s.planned, p.day)}d out{moved ? ` (even: ${day(s.date)})` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {p.touched > 0 && <p className="mt-2 text-xs text-muted-foreground">{p.touched} taper session{p.touched === 1 ? " is" : "s are"} already started or past and stay{p.touched === 1 ? "s" : ""} where {p.touched === 1 ? "it is" : "they are"}.</p>}
              {p.plan.warnings.map((w, i) => <p key={i} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
            </section>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 flex-1" onClick={() => run("lift")} disabled={!!busy} data-meet-apply-lift>
                {busy === "lift" ? "Moving…" : liftMoves.length ? "Use the lift-by-lift plan" : "Confirm (same as the even shift)"}
              </Button>
              {liftMoves.length > 0 && (
                <Button variant="outline" className="h-11 flex-1" onClick={() => run("even")} disabled={!!busy} data-meet-apply-even>
                  {busy === "even" ? "Moving…" : "Keep the even shift"}
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
