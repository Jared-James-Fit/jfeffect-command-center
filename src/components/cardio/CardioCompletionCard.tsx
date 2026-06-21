/**
 * CardioCompletionCard — shows a single cardio target with completion logging.
 *
 * Features:
 * - Shows cardio type, day type, duration target, intensity
 * - One-tap "Mark Complete" / "Mark Incomplete" toggle
 * - Expandable log form: actual duration, cardio type override, RPE, notes
 * - Saves to cardio_completions table
 * - Fast and simple — no bloated forms
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";
import { format } from "date-fns";

type CardioTarget = {
  id: string;
  cardio_type: string;
  custom_type: string | null;
  day_type: string;
  custom_day_type: string | null;
  duration_minutes: number | null;
  intensity: string | null;
  heart_rate_zone: string | null;
  machine_preference: string | null;
  goal: string | null;
  step_target: number | null;
  calorie_target_min: number | null;
  calorie_target_max: number | null;
  show_calories_to_client: boolean;
  client_notes: string | null;
};

type Props = {
  target: CardioTarget;
  clientId: string;
  date?: Date;
  readonly?: boolean;
};

const CARDIO_TYPES = [
  "Walking", "Running", "Cycling", "Rowing", "Elliptical",
  "Stairmaster", "Swimming", "LISS", "HIIT", "Incline Walk",
  "Bike", "Ski Erg", "Sled Push", "Custom",
];

export function CardioCompletionCard({ target, clientId, date, readonly = false }: Props) {
  const qc = useQueryClient();
  const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actualDuration, setActualDuration] = useState("");
  const [actualType, setActualType] = useState("");
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");

  const { data: completion, isLoading } = useQuery({
    queryKey: ["cardio-completion", clientId, target.id, dateStr],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("cardio_completions")
        .select("*")
        .eq("client_id", clientId)
        .eq("cardio_target_id", target.id)
        .eq("completed_date", dateStr)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 30_000,
  });

  const isCompleted = completion?.completed === true;

  const typeName = target.cardio_type === "Custom"
    ? target.custom_type || "Custom"
    : target.cardio_type;

  const metaParts: string[] = [];
  if (target.duration_minutes) metaParts.push(`${target.duration_minutes} min`);
  if (target.intensity) metaParts.push(target.intensity);
  if (target.heart_rate_zone) metaParts.push(target.heart_rate_zone);
  if (target.machine_preference) metaParts.push(target.machine_preference);
  if (target.step_target) metaParts.push(`${target.step_target.toLocaleString()} steps`);

  const cal = target.show_calories_to_client && (target.calorie_target_min || target.calorie_target_max)
    ? target.calorie_target_min && target.calorie_target_max
      ? `${target.calorie_target_min}–${target.calorie_target_max} cal`
      : `${target.calorie_target_min ?? target.calorie_target_max} cal`
    : null;

  async function toggleComplete() {
    if (readonly || saving) return;
    setSaving(true);
    try {
      if (isCompleted) {
        // Mark incomplete — delete the completion
        await (supabase as any)
          .from("cardio_completions")
          .delete()
          .eq("client_id", clientId)
          .eq("cardio_target_id", target.id)
          .eq("completed_date", dateStr);
        toast.success("Cardio marked incomplete");
      } else {
        // Mark complete with defaults
        await (supabase as any)
          .from("cardio_completions")
          .upsert({
            client_id: clientId,
            cardio_target_id: target.id,
            completed_date: dateStr,
            completed: true,
            duration_minutes: target.duration_minutes,
            cardio_type: typeName,
            day_type: target.day_type,
          }, { onConflict: "client_id,cardio_target_id,completed_date" });
        toast.success("Cardio logged!");
      }
      qc.invalidateQueries({ queryKey: ["cardio-completion", clientId, target.id, dateStr] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (readonly || saving) return;
    setSaving(true);
    try {
      await (supabase as any)
        .from("cardio_completions")
        .upsert({
          client_id: clientId,
          cardio_target_id: target.id,
          completed_date: dateStr,
          completed: true,
          duration_minutes: actualDuration ? parseInt(actualDuration, 10) : target.duration_minutes,
          cardio_type: actualType || typeName,
          rpe: rpe ? parseFloat(rpe) : null,
          notes: notes.trim() || null,
          day_type: target.day_type,
        }, { onConflict: "client_id,cardio_target_id,completed_date" });
      toast.success("Cardio logged!");
      setExpanded(false);
      qc.invalidateQueries({ queryKey: ["cardio-completion", clientId, target.id, dateStr] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={`overflow-hidden transition-colors ${isCompleted ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"}`}>
      <div className="p-3">
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Complete toggle */}
          {!readonly && (
            <button
              type="button"
              onClick={toggleComplete}
              disabled={saving || isLoading}
              aria-label={isCompleted ? "Mark cardio incomplete" : "Mark cardio complete"}
              className="mt-0.5 shrink-0 transition active:scale-95"
            >
              {isLoading || saving
                ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                : isCompleted
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />}
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <Badge variant="outline" className={dayTypeTone(target.day_type)}>
                {dayTypeLabel(target)}
              </Badge>
              <span className={`font-semibold text-sm ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                {typeName}
              </span>
              {cal && <Badge variant="outline" className="text-[10px]">{cal}</Badge>}
              {isCompleted && completion?.duration_minutes && (
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 text-[10px]">
                  {completion.duration_minutes} min done
                </Badge>
              )}
            </div>

            {metaParts.length > 0 && (
              <div className="text-xs text-muted-foreground">{metaParts.join(" · ")}</div>
            )}

            {target.goal && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Goal: <span className="text-foreground">{target.goal}</span>
              </div>
            )}

            {target.client_notes && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                {target.client_notes}
              </p>
            )}

            {isCompleted && completion?.notes && (
              <p className="mt-1 text-xs text-emerald-700 italic">"{completion.notes}"</p>
            )}
          </div>

          {/* Log details toggle */}
          {!readonly && !isCompleted && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide log form" : "Log details"}
              className="shrink-0 text-muted-foreground hover:text-foreground transition"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Expandable log form */}
        {expanded && !readonly && !isCompleted && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Actual Duration (min)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={target.duration_minutes ? String(target.duration_minutes) : "—"}
                  value={actualDuration}
                  onChange={(e) => setActualDuration(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">RPE (1-10)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.5"
                  placeholder="—"
                  value={rpe}
                  onChange={(e) => setRpe(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Cardio Type</Label>
              <select
                value={actualType}
                onChange={(e) => setActualType(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{typeName} (default)</option>
                {CARDIO_TYPES.filter((t) => t !== typeName).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How did it feel? Any notes…"
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={saveDetails} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                Log Cardio
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
