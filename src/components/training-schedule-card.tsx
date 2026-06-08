import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Pencil, Save, X, AlertCircle } from "lucide-react";
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
    const { data: auth } = await supabase.auth.getUser();
    const patch: any = {
      committed_training_frequency: Number(committedFreq),
      committed_training_days: committedDays,
      training_schedule_completed: true,
      training_schedule_last_updated: new Date().toISOString(),
      training_schedule_updated_by: auth.user?.id ?? null,
    };
    const { error } = await supabase.from("clients").update(patch).eq("id", client.id);
    if (!error) {
      // Log activity for admin notification surface
      await (supabase as any).from("client_activity_log").insert({
        client_id: client.id,
        actor_user_id: auth.user?.id ?? null,
        actor_role: "client",
        action: "training_schedule_updated",
        details: {
          committed_training_frequency: Number(committedFreq),
          committed_training_days: committedDays,
        },
      });
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Schedule saved");
    qc.invalidateQueries({ queryKey: ["client", client.id] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    qc.invalidateQueries({ queryKey: ["my-client-schedule-gate"] });
    setEditing(false);
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