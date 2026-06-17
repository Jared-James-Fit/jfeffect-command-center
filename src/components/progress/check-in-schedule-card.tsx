import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";

type Kind = "photos" | "videos" | "bodyweight" | "measurements";
type Frequency = "weekly" | "biweekly" | "monthly" | "per_block" | "custom" | "none";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "photos", label: "Photos" },
  { kind: "videos", label: "Videos" },
  { kind: "bodyweight", label: "Bodyweight" },
  { kind: "measurements", label: "Measurements" },
];

const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "per_block", label: "Each training block" },
  { value: "custom", label: "Custom (days)" },
  { value: "none", label: "No reminder" },
];

type Row = {
  id: string;
  user_id: string;
  kind: Kind;
  frequency: Frequency;
  custom_days: number | null;
  enabled: boolean;
  next_due: string | null;
  last_completed_at: string | null;
};

export function CheckInScheduleCard({
  userId,
  readOnly = false,
  title = "Check-in cadence",
  subtitle = "How often each progress check-in is expected.",
}: {
  userId: string;
  readOnly?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["progress-schedules", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_check_in_schedules")
        .select("*")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const byKind = useMemo(() => {
    const m = new Map<Kind, Row>();
    (data ?? []).forEach((r) => m.set(r.kind, r));
    return m;
  }, [data]);

  return (
    <Card className="p-4 md:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      <div className="grid gap-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          KINDS.map(({ kind, label }) => (
            <ScheduleRow
              key={kind}
              kind={kind}
              label={label}
              userId={userId}
              row={byKind.get(kind) ?? null}
              readOnly={readOnly}
              onSaved={() => qc.invalidateQueries({ queryKey: ["progress-schedules", userId] })}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function ScheduleRow({
  kind, label, userId, row, readOnly, onSaved,
}: {
  kind: Kind;
  label: string;
  userId: string;
  row: Row | null;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>(row?.frequency ?? "none");
  const [customDays, setCustomDays] = useState<number>(row?.custom_days ?? 14);
  const [enabled, setEnabled] = useState<boolean>(row?.enabled ?? false);
  const [saving, setSaving] = useState(false);

  const dirty =
    frequency !== (row?.frequency ?? "none") ||
    (frequency === "custom" && customDays !== (row?.custom_days ?? 14)) ||
    enabled !== (row?.enabled ?? false);

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const payload = {
        user_id: userId,
        kind,
        frequency,
        custom_days: frequency === "custom" ? Math.max(1, Math.min(365, customDays)) : null,
        enabled: frequency === "none" ? false : enabled,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("progress_check_in_schedules")
        .upsert(payload, { onConflict: "user_id,kind" });
      if (error) throw error;
      toast.success(`${label} cadence saved`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save cadence");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">{label}</div>
        <div className="flex items-center gap-2">
          {row?.next_due && enabled && frequency !== "none" ? (
            <Badge variant="outline" className="text-[10px]">
              Next: {format(parseISO(row.next_due), "MMM d")}
            </Badge>
          ) : null}
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={readOnly || frequency === "none"}
            aria-label={`Enable ${label} reminders`}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Frequency</Label>
          <Select
            value={frequency}
            onValueChange={(v) => setFrequency(v as Frequency)}
            disabled={readOnly}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQ_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {frequency === "custom" ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Every N days</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value) || 1)}
              disabled={readOnly}
              className="w-28"
            />
          </div>
        ) : null}
      </div>
      {row?.last_completed_at ? (
        <div className="text-[11px] text-muted-foreground">
          Last completed {format(parseISO(row.last_completed_at), "MMM d, yyyy")}
        </div>
      ) : null}
      {!readOnly ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}