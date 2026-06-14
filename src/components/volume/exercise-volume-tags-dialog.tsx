import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
  LIFT_FAMILIES,
  VARIATION_TYPES,
  VARIATION_LABELS,
  DEFAULT_VOLUME_MULTIPLIERS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
} from "@/lib/volume";

interface Props {
  exercise: any;
  onClose: () => void;
  onSaved: () => void;
}

export function ExerciseVolumeTagsDialog({ exercise, onClose, onSaved }: Props) {
  const [pattern, setPattern] = useState<string>(exercise.primary_movement_pattern ?? "");
  const [family, setFamily] = useState<string>(exercise.lift_family ?? "");
  const [variation, setVariation] = useState<string>(exercise.variation_type ?? "");
  const [muscles, setMuscles] = useState<string[]>(exercise.muscle_groups ?? []);
  const [countsTowardVolume, setCountsTowardVolume] = useState<boolean>(
    exercise.counts_toward_volume ?? true,
  );
  const [multiplier, setMultiplier] = useState<string>(
    exercise.volume_multiplier != null ? String(exercise.volume_multiplier) : "",
  );
  const [busy, setBusy] = useState(false);

  // Auto-fill multiplier when variation is picked and field is empty.
  useEffect(() => {
    if (!variation) return;
    if (multiplier !== "") return;
    const def = DEFAULT_VOLUME_MULTIPLIERS[variation as keyof typeof DEFAULT_VOLUME_MULTIPLIERS];
    if (def != null) setMultiplier(String(def));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variation]);

  const toggleMuscle = (m: string) =>
    setMuscles((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const useDefaultForVariation = () => {
    if (!variation) return;
    const def = DEFAULT_VOLUME_MULTIPLIERS[variation as keyof typeof DEFAULT_VOLUME_MULTIPLIERS];
    if (def != null) setMultiplier(String(def));
  };

  const save = async () => {
    setBusy(true);
    const patch: Record<string, unknown> = {
      primary_movement_pattern: pattern || null,
      lift_family: family || null,
      variation_type: variation || null,
      muscle_groups: muscles,
      counts_toward_volume: countsTowardVolume,
      volume_multiplier:
        multiplier === "" || Number.isNaN(parseFloat(multiplier))
          ? null
          : parseFloat(multiplier),
    };
    const { error } = await supabase
      .from("exercises")
      .update(patch as any)
      .eq("id", exercise.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Volume tags saved");
    onSaved();
    onClose();
  };

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{exercise.name} — volume tags</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Movement pattern</Label>
            <Select value={pattern || "__none"} onValueChange={(v) => setPattern(v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None</SelectItem>
                {MOVEMENT_PATTERNS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {MOVEMENT_PATTERN_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Lift family</Label>
            <Select value={family || "__none"} onValueChange={(v) => setFamily(v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None</SelectItem>
                {LIFT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f[0]!.toUpperCase() + f.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Variation type</Label>
          <Select value={variation || "__none"} onValueChange={(v) => setVariation(v === "__none" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— None</SelectItem>
              {VARIATION_TYPES.map((v) => (
                <SelectItem key={v} value={v}>
                  {VARIATION_LABELS[v]} (default ×{DEFAULT_VOLUME_MULTIPLIERS[v]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Volume multiplier</Label>
            {variation && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={useDefaultForVariation}
              >
                Use default ({DEFAULT_VOLUME_MULTIPLIERS[variation as keyof typeof DEFAULT_VOLUME_MULTIPLIERS]})
              </Button>
            )}
          </div>
          <Input
            type="number"
            min="0"
            max="2"
            step="0.05"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            placeholder="0.0 – 2.0"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Effective sets = working sets × multiplier. Leave blank to use the variation default.
          </p>
        </div>

        <div>
          <Label>Muscle groups</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MUSCLE_GROUPS.map((m) => {
              const on = muscles.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMuscle(m)}
                  className="focus:outline-none"
                >
                  <Badge
                    variant={on ? "default" : "outline"}
                    className={on ? "cursor-pointer" : "cursor-pointer hover:bg-accent"}
                  >
                    {MUSCLE_GROUP_LABELS[m]}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <span>
            Counts toward volume
            <span className="ml-2 text-[11px] text-muted-foreground">
              Off = warm-ups, mobility, etc.
            </span>
          </span>
          <Switch checked={countsTowardVolume} onCheckedChange={setCountsTowardVolume} />
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={busy}
          className="bg-gradient-primary font-bold uppercase"
        >
          {busy ? "Saving…" : "Save tags"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}