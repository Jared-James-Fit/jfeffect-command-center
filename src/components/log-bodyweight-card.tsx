import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  averageOfLast, formatWeight, normalizedBodyweightSeries, weeklyChange,
  type ProgressMetric, type WeightUnit,
} from "@/lib/progress-metrics";

interface Props {
  clientId: string;
  defaultUnit?: WeightUnit;
}

export function LogBodyweightCard({ clientId, defaultUnit = "lb" }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["progress-metrics", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_metrics").select("*")
        .eq("client_id", clientId).order("entry_date", { ascending: false }).limit(60);
      return (data ?? []) as ProgressMetric[];
    },
  });

  const series = normalizedBodyweightSeries(rows, unit);
  const latest = series[series.length - 1] ?? null;
  const avg7 = averageOfLast(series, 7);
  const change = weeklyChange(series);

  const save = async () => {
    const v = Number(weight);
    if (!weight || Number.isNaN(v) || v <= 0) {
      toast.error("Enter a valid bodyweight.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("progress_metrics").insert({
      client_id: clientId,
      entry_date: date,
      bodyweight: v,
      bodyweight_unit: unit,
      source: "manual",
      created_by: user?.id ?? null,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Bodyweight logged.");
    setWeight("");
    qc.invalidateQueries({ queryKey: ["progress-metrics", clientId] });
  };

  return (
    <Card className="border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Log Bodyweight</h3>
        </div>
        <Link to="/portal/progress-metrics" className="text-xs text-primary hover:underline">View history</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_80px_auto]">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Weight</Label>
          <Input type="number" step="0.1" inputMode="decimal" placeholder="e.g. 182.4" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Unit</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lb">lb</SelectItem>
              <SelectItem value="kg">kg</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="w-full bg-gradient-primary font-bold uppercase">
        {saving ? "Saving…" : "Save Bodyweight"}
      </Button>
      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <Mini label="Latest" value={latest ? formatWeight(latest.value, unit) : "—"} />
        <Mini label="7-day avg" value={avg7 != null ? formatWeight(avg7, unit) : "—"} />
        <Mini label="Weekly change" value={change != null ? `${change > 0 ? "+" : ""}${change.toFixed(1)} ${unit}` : "—"} />
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}