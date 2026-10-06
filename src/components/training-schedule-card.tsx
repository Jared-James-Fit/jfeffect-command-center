import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rescheduleFromCommittedDays, saveCommittedSchedule } from "@/lib/schedule-bulk.functions";
import { invalidateScheduleQueries } from "@/lib/schedule-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Pencil, Save, X, AlertCircle } from "lucide-react";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { toast } from "sonner";
import { WEEK_DAYS, SHORT_DAY, formatDays, type WeekDay } from "@/lib/training-schedule";
import { format, parseISO } from "date-fns";

type Client = {
  id: string;
  preferred_training_days?: string[] | null;
  preferred_rest_days?: string[] | null;
  preferred_high_days?: string[] | null;
  schedule_notes?: string | null;
  schedule_updated_at?: string | null;
  committed_training_frequency?: number | null;
  committed_training_days?: string[] | null;
  available_training_days?: string[] | null;
  unavailable_training_days?: string[] | null;
  preferred_training_time?: string | null;
  schedule_changes_weekly?: boolean | null;
  training_schedule_completed?: boolean | null;
  training_schedule_last_updated?: string | null;
};

type Props = {
  client: Client;
  editable?: boolean;
  compact?: boolean;
  defaultEditing?: boolean;
};

export function TrainingScheduleCard({ client, editable = true, compact = false, defaultEditing = false }: Props) {
  const qc = useQueryClient();
  const reschedule = useServerFn(rescheduleFromCommittedDays);
  const saveSchedule = useServerFn(saveCommittedSchedule);
  const [editing, setEditing] = useState(defaultEditing);
  const [saving, setSaving] = useState(false);
  // Committed (mandatory) fields — only fields the client fills out
  const [committedFreq, setCommittedFreq] = useState<number | "">(client.committed_training_frequency ?? "");
  const [committedDays, setCommittedDays] = useState<string[]>(client.committed_training_days ?? []);

  const incomplete = !client.training_schedule_completed;

  const reset = () => {
    setCommittedFreq(client.committed_training_frequency ?? "");
    setCommittedDays(client.committed_training_days ?? []);
  };

  const save = async () => {
    if (!committedFreq) {
      toast.error("Select how many days per week you're committed to training");
      return;
    }
    if (committedDays.length !== Number(committedFreq)) {
      toast.error(`Select exactly ${committedFreq} training day${Number(committedFreq) === 1 ? "" : "s"}`);
      return;
    }
    setSaving(true);
    const sortedDays = [...committedDays].sort(
      (a, b) => WEEK_DAYS.indexOf(a as WeekDay) - WEEK_DAYS.indexOf(b as WeekDay),
    );

    // Everything the schedule change touches (the saved days, every future
    // workout date, the calendar and the Workouts tab) is refreshed together.
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["client", client.id] });
      qc.invalidateQueries({ queryKey: ["my-client"] });
      qc.invalidateQueries({ queryKey: ["my-client-schedule"] });
      qc.invalidateQueries({ queryKey: ["my-client-schedule-gate"] });
      qc.invalidateQueries({ queryKey: ["client-training-schedule"] });
      qc.invalidateQueries({ queryKey: ["cal-client-data"] });
      // Goals & Setup carries a copy of these days.
      qc.invalidateQueries({ queryKey: ["client-goals-setup", client.id] });
      invalidateScheduleQueries(qc, { clientId: client.id });
      void invalidateGroceryList(qc, client.id);
    };

    // One server call saves the days AND re-dates every future, unstarted
    // workout (all blocks, including upcoming Draft blocks) onto them. Started,
    // completed and past workouts are always preserved; coach-locked workouts
    // stay protected for clients.
    let res: any;
    try {
      res = await saveSchedule({
        data: { clientId: client.id, frequency: Number(committedFreq), days: sortedDays },
      });
    } catch (e: any) {
      setSaving(false);
      toast.error(e?.message ?? "We couldn't save your schedule. Please try again.");
      return;
    }
    setSaving(false);
    refresh();
    setEditing(false);

    if (res?.realignError) {
      // The days are saved; only the calendar update failed. Offer a retry —
      // the realign is idempotent so running it again is always safe.
      toast.error("Schedule saved, but your workout calendar didn't update.", {
        action: {
          label: "Retry",
          onClick: async () => {
            try {
              await reschedule({ data: { clientId: client.id, includePinned: true } });
              refresh();
              toast.success("Workout calendar updated");
            } catch (err: any) {
              toast.error(err?.message ?? "Still couldn't update the calendar");
            }
          },
        },
      });
      return;
    }

    const movedCount: number = res?.applied ?? 0;
    const pinned: number = res?.pendingPinned ?? 0;
    const unplaced: number = res?.unplaced ?? 0;
    toast.success(
      movedCount > 0
        ? `Schedule saved · ${movedCount} upcoming workout${movedCount === 1 ? "" : "s"} moved to your new days${pinned > 0 ? ` · ${pinned} locked kept` : ""}`
        : pinned > 0
          ? `Schedule saved · ${pinned} locked workout${pinned === 1 ? "" : "s"} kept`
          : "Schedule saved",
    );
    if (unplaced > 0) {
      toast.warning(
        `${unplaced} workout${unplaced === 1 ? "" : "s"} couldn't fit on your ${sortedDays.length} training day${sortedDays.length === 1 ? "" : "s"} and kept their old date. Your coach can adjust the program.`,
      );
    }
  };

  const toggle = (list: string[], set: (v: string[]) => void, day: WeekDay) => {
    set(list.includes(day) ? list.filter((d) => d !== day) : [...list, day]);
  };

  const targetCount = committedFreq ? Number(committedFreq) : 0;
  const dayCountValid = targetCount > 0 && committedDays.length === targetCount;

  return (
    <Card className={`border-border bg-card ${compact ? "p-4" : "p-6"} space-y-3 ${incomplete && editable ? "border-amber-500/50" : ""}`}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Calendar className="h-4 w-4" /> Committed Training Schedule
          {incomplete && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500">
              <AlertCircle className="mr-1 h-3 w-3" /> Required
            </Badge>
          )}
        </h3>
        {editable && !editing && (
          <Button size="sm" variant={incomplete ? "default" : "ghost"} onClick={() => setEditing(true)}>
            {incomplete ? "Set Schedule" : <Pencil className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-1.5 text-sm">
          {client.committed_training_frequency && (client.committed_training_days?.length ?? 0) > 0 ? (
            <div className="text-base font-semibold">
              {client.committed_training_frequency} day{client.committed_training_frequency === 1 ? "" : "s"}/week
              <span className="text-muted-foreground"> · </span>
              {(client.committed_training_days ?? [])
                .filter((d): d is WeekDay => (WEEK_DAYS as readonly string[]).includes(d))
                .slice()
                .sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b))
                .map((d) => SHORT_DAY[d as WeekDay])
                .join(" / ")}
            </div>
          ) : (
            <div className="text-muted-foreground">Not set yet.</div>
          )}
          {(client.training_schedule_last_updated || client.schedule_updated_at) && (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Updated {format(parseISO(client.training_schedule_last_updated || client.schedule_updated_at!), "MMM d, yyyy")}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">How many days per week are you committed to training? *</Label>
            <Select value={committedFreq ? String(committedFreq) : ""} onValueChange={(v) => setCommittedFreq(Number(v))}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select frequency" /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7].map((n) => <SelectItem key={n} value={String(n)}>{n} day{n === 1 ? "" : "s"}/week</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <DayPicker
              label={`What days are you committing to train? *${targetCount ? ` (pick ${targetCount})` : ""}`}
              selected={committedDays}
              onToggle={(d) => toggle(committedDays, setCommittedDays, d)}
            />
            {targetCount > 0 && (
              <div className={`mt-1 text-[11px] ${dayCountValid ? "text-muted-foreground" : "text-amber-500"}`}>
                {committedDays.length} of {targetCount} selected
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { reset(); setEditing(false); }}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !dayCountValid} className="bg-gradient-primary font-bold uppercase">
              <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DayPicker({ label, selected, onToggle }: { label: string; selected: string[]; onToggle: (d: WeekDay) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {WEEK_DAYS.map((d) => {
          const active = selected.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onToggle(d)}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {SHORT_DAY[d]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TrainingScheduleBadges({ client }: { client: Client }) {
  const hasAny =
    (client.preferred_training_days?.length ?? 0) > 0 ||
    (client.preferred_rest_days?.length ?? 0) > 0 ||
    (client.preferred_high_days?.length ?? 0) > 0;
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {(client.preferred_training_days?.length ?? 0) > 0 && (
        <Badge variant="outline" className="border-primary/40 text-primary">
          Train: {formatDays(client.preferred_training_days)}
        </Badge>
      )}
      {(client.preferred_rest_days?.length ?? 0) > 0 && (
        <Badge variant="outline">Rest: {formatDays(client.preferred_rest_days)}</Badge>
      )}
      {(client.preferred_high_days?.length ?? 0) > 0 && (
        <Badge variant="outline" className="border-amber-500/40 text-amber-500">
          High: {formatDays(client.preferred_high_days)}
        </Badge>
      )}
    </div>
  );
}