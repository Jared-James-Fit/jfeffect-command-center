import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Scale, TrendingDown, TrendingUp, Minus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import { toast } from "sonner";
import { convertWeight, type WeightUnit } from "@/lib/progress-metrics";
import {
  listBodyweight,
  logBodyweight,
  deleteBodyweight,
  updateBodyweight,
  type ProgressBodyweight,
} from "@/lib/progress";

/**
 * Reads & writes the SAME `progress_bodyweight` source as the Progress
 * page weight graph and the Home "Bodyweight" card, so a weight logged
 * here shows up on the graph and the dashboard immediately.
 */
export function MemberBodyweightCard() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("lb");
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editUnit, setEditUnit] = useState<WeightUnit>("lb");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id ?? null);
    });
    return () => { mounted = false; };
  }, []);

  const { data: rows = [] } = useQuery({
    queryKey: ["progress-bw", userId],
    enabled: !!userId,
    queryFn: () => listBodyweight(userId!),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: async () => {
      const w = parseFloat(weight);
      if (!Number.isFinite(w) || w <= 0) throw new Error("Enter a valid weight");
      if (!userId) throw new Error("Not signed in");
      await logBodyweight({
        user_id: userId,
        weight_value: w,
        weight_unit: unit,
        logged_date: date,
        note: null,
      });
    },
    onSuccess: () => {
      toast.success("Weight logged");
      setWeight("");
      qc.invalidateQueries({ queryKey: ["progress-bw", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBodyweight(id),
    onSuccess: () => {
      toast.success("Entry removed");
      qc.invalidateQueries({ queryKey: ["progress-bw", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error("No entry selected");
      const w = parseFloat(editWeight);
      if (!Number.isFinite(w) || w <= 0) throw new Error("Enter a valid weight");
      await updateBodyweight(editingId, {
        weight_value: w,
        weight_unit: editUnit,
        logged_date: editDate,
      } as Partial<ProgressBodyweight>);
    },
    onSuccess: () => {
      toast.success("Entry updated");
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["progress-bw", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (r: ProgressBodyweight) => {
    setEditingId(r.id);
    setEditWeight(String(r.weight_value));
    setEditDate(r.logged_date);
    setEditUnit((r.weight_unit as WeightUnit) ?? "lb");
  };

  // normalize series to display unit
  const series = (rows as ProgressBodyweight[])
    .map((r) => ({
      id: r.id,
      entry_date: r.logged_date,
      normalized: convertWeight(Number(r.weight_value), r.weight_unit as WeightUnit, unit),
    }))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  const latest = series[series.length - 1];
  const prior = series.length >= 2 ? series[series.length - 2] : null;
  const delta = latest && prior ? latest.normalized - prior.normalized : null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <div className="text-sm font-semibold">Bodyweight</div>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={unit}
          onValueChange={(v) => v && setUnit(v as WeightUnit)}
        >
          <ToggleGroupItem value="lb" className="h-8 px-3 text-xs">lb</ToggleGroupItem>
          <ToggleGroupItem value="kg" className="h-8 px-3 text-xs">kg</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {latest ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-black tabular-nums">
              {latest.normalized.toFixed(1)} <span className="text-base font-medium text-muted-foreground">{unit}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {format(parseLocalDate(latest.entry_date)!, "EEE, MMM d")}
            </div>
          </div>
          {delta != null && (
            <Badge variant="outline" className="gap-1">
              {delta > 0.05 ? <TrendingUp className="h-3 w-3 text-orange-500" /> :
               delta < -0.05 ? <TrendingDown className="h-3 w-3 text-green-500" /> :
               <Minus className="h-3 w-3" />}
              {delta > 0 ? "+" : ""}{delta.toFixed(1)} {unit}
            </Badge>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No entries yet. Log your first weight below.</div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_140px_auto]">
        <div className="space-y-1 sm:col-start-1">
          <Label className="text-xs">Weight ({unit})</Label>
          <Input
            inputMode="decimal"
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="0.0"
            className="h-11"
          />
        </div>
        <div className="space-y-1 col-span-2 sm:col-span-1 sm:col-start-2">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} max={todayLocalISO()} onChange={(e) => setDate(e.target.value)} className="h-11" />
        </div>
        <Button
          className="h-11 col-span-2 sm:col-span-1 sm:col-start-3 sm:self-end"
          onClick={() => save.mutate()}
          disabled={save.isPending || !weight}
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log"}
        </Button>
      </div>

      {series.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">Recent</div>
          <ul className="divide-y rounded-md border">
            {[...series].reverse().slice(0, 6).map((r) => {
              const isEditing = editingId === r.id;
              const raw = (rows as ProgressBodyweight[]).find((x) => x.id === r.id);
              if (isEditing) {
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <Input
                      type="date"
                      value={editDate}
                      max={todayLocalISO()}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="h-9 w-[140px]"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                      className="h-9 w-20"
                    />
                    <ToggleGroup
                      type="single"
                      size="sm"
                      value={editUnit}
                      onValueChange={(v) => v && setEditUnit(v as WeightUnit)}
                    >
                      <ToggleGroupItem value="lb" className="h-9 px-2 text-xs">lb</ToggleGroupItem>
                      <ToggleGroupItem value="kg" className="h-9 px-2 text-xs">kg</ToggleGroupItem>
                    </ToggleGroup>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => update.mutate()}
                        disabled={update.isPending}
                        aria-label="Save"
                      >
                        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{format(parseLocalDate(r.entry_date)!, "MMM d")}</span>
                  <span className="font-semibold tabular-nums">{r.normalized.toFixed(1)} {unit}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => raw && startEdit(raw)}
                      aria-label="Edit entry"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        if (confirm("Remove this bodyweight entry?")) remove.mutate(r.id);
                      }}
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}