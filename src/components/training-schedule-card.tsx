import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Pencil, Save, X } from "lucide-react";
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
};

type Props = {
  client: Client;
  editable?: boolean;
  compact?: boolean;
};

export function TrainingScheduleCard({ client, editable = true, compact = false }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState<string[]>(client.preferred_training_days ?? []);
  const [rest, setRest] = useState<string[]>(client.preferred_rest_days ?? []);
  const [high, setHigh] = useState<string[]>(client.preferred_high_days ?? []);
  const [notes, setNotes] = useState<string>(client.schedule_notes ?? "");

  const reset = () => {
    setTraining(client.preferred_training_days ?? []);
    setRest(client.preferred_rest_days ?? []);
    setHigh(client.preferred_high_days ?? []);
    setNotes(client.schedule_notes ?? "");
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("clients")
      .update({
        preferred_training_days: training,
        preferred_rest_days: rest,
        preferred_high_days: high,
        schedule_notes: notes || null,
        schedule_updated_at: new Date().toISOString(),
      })
      .eq("id", client.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Schedule saved");
    qc.invalidateQueries({ queryKey: ["client", client.id] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    setEditing(false);
  };

  const toggle = (list: string[], set: (v: string[]) => void, day: WeekDay) => {
    set(list.includes(day) ? list.filter((d) => d !== day) : [...list, day]);
  };

  return (
    <Card className={`border-border bg-card ${compact ? "p-4" : "p-6"} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Calendar className="h-4 w-4" /> Training Schedule
        </h3>
        {editable && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-2 text-sm">
          <Row label="Training days" value={formatDays(client.preferred_training_days)} />
          <Row label="Rest days" value={formatDays(client.preferred_rest_days)} />
          <Row label="High days" value={formatDays(client.preferred_high_days)} />
          {client.schedule_notes && (
            <div className="rounded-md border border-border bg-secondary/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {client.schedule_notes}
            </div>
          )}
          {client.schedule_updated_at && (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Updated {format(parseISO(client.schedule_updated_at), "MMM d, yyyy")}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <DayPicker label="Training days" selected={training} onToggle={(d) => toggle(training, setTraining, d)} />
          <DayPicker label="Rest days" selected={rest} onToggle={(d) => toggle(rest, setRest, d)} />
          <DayPicker label="High days" selected={high} onToggle={(d) => toggle(high, setHigh, d)} />
          <div>
            <Label className="text-xs">Schedule notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. trains best in the evening" />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { reset(); setEditing(false); }}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">
              <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
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