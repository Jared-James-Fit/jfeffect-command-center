/**
 * The coach's footage view for one client (filming-reminder.ts): their status
 * (Consistent / Occasional / Limited recent footage / No footage logged) from
 * the last 30 days of workouts, a quiet flag when they've dismissed the
 * reminder twice or gone long without footage, and the per-client controls:
 * reminders on or off, how soon they come (sensitivity), what's expected,
 * Request footage, Pause a week, Resume.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Flag, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STATE,
  STATUS_LABEL,
  checkinFootageLine,
  coachFlag,
  footageStatus,
  type Expectation,
  type FilmingStatus,
  type Sensitivity,
} from "@/lib/set-videos/filming-reminder";
import { useFilmingCoachControls, useFilmingStatus, type CoachPatch } from "@/lib/set-videos/filming-status";

const TONE: Record<ReturnType<typeof footageStatus>, string> = {
  consistent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  occasional: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  limited: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  none: "bg-muted text-muted-foreground",
};

export function FootageStatusChip({ status, className }: { status: FilmingStatus; className?: string }) {
  const kind = footageStatus(status);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[kind], className)} data-footage-status={kind}>
      {STATUS_LABEL[kind]}
    </span>
  );
}

export function FilmingAccountabilityCard({ clientId }: { clientId: string }) {
  const { data: status, isPending } = useFilmingStatus(clientId);
  const save = useFilmingCoachControls(clientId);
  const [busy, setBusy] = useState(false);
  if (isPending || !status || !status.coaching) return null;
  const st = { ...DEFAULT_STATE, ...(status.state ?? {}) };
  const flag = coachFlag(status);
  const paused = !!st.auto_paused_at || (!!st.paused_until && Date.parse(st.paused_until) > Date.now());
  const run = async (patch: CoachPatch, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await save(patch);
      if (done) toast.success(done);
    } catch {
      toast.error("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="min-w-0 border-border bg-card p-4" aria-label="Footage" data-filming-card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Video className="h-3.5 w-3.5" aria-hidden /> Footage
        </div>
        <FootageStatusChip status={status} />
      </div>
      <p className="mt-2 text-sm tabular-nums">{checkinFootageLine(status).replace(/^Footage: /, "")}</p>
      {flag && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200" data-filming-flag>
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {flag}
        </p>
      )}
      <div className="mt-3 space-y-2.5 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>Filming reminders</span>
          <Switch checked={st.enabled} disabled={busy} onCheckedChange={(v) => void run({ enabled: v })} aria-label="Filming reminders" />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span>How soon</span>
          <Select value={st.sensitivity} disabled={busy || !st.enabled} onValueChange={(v) => void run({ sensitivity: v as Sensitivity })}>
            <SelectTrigger className="h-9 w-[11rem]" aria-label="How soon reminders come"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="gentle">Gentle · 10 days, 4 workouts</SelectItem>
              <SelectItem value="standard">Standard · 7 days, 3 workouts</SelectItem>
              <SelectItem value="firm">Firm · 5 days, 2 workouts</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Expect</span>
          <Select value={st.expectation} disabled={busy} onValueChange={(v) => void run({ expectation: v as Expectation })}>
            <SelectTrigger className="h-9 w-[11rem]" aria-label="What footage you expect"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="main_lifts">Each main lift</SelectItem>
              <SelectItem value="one_per_workout">One set a workout</SelectItem>
              <SelectItem value="top_sets">Every top set</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ request: true }, "They'll be asked at their next workout.")} data-filming-request>
          Request footage
        </Button>
        {paused ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ resume: true, paused_until: null }, "Reminders resumed.")}>
            Resume reminders
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy || !st.enabled} onClick={() => void run({ paused_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }, "Paused for a week.")}>
            Pause a week
          </Button>
        )}
      </div>
    </Card>
  );
}

/** The check-in review's one line for the coach (deterministic, from the same numbers). */
export function CheckinFootageLine({ clientId }: { clientId: string }) {
  const { data: status } = useFilmingStatus(clientId);
  if (!status?.coaching) return null;
  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] leading-snug" data-checkin-footage>
      <Video className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 tabular-nums">{checkinFootageLine(status)}</span>
    </div>
  );
}
