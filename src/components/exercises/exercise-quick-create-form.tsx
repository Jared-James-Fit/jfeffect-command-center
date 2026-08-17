import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsCoarsePointer } from "@/hooks/use-touch-viewport";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  invalidateExerciseLibrary,
  upsertExerciseInLibraryCaches,
} from "@/lib/exercise-library-cache";
import {
  EXERCISE_CATEGORIES,
  PRIMARY_MUSCLE_GROUPS,
  EQUIPMENT_OPTIONS,
  DEFAULT_EXERCISE_DIFFICULTY,
} from "@/lib/exercise-taxonomy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

const AUTO = "__auto__";
const NONE = "__none__";

/**
 * Fast exercise creation.
 *
 * Only `name` is a hard requirement. Everything else is either optional,
 * defaulted, or derived server-side:
 *  - `primary_muscle_group` is auto-classified by the existing
 *    `exercises_autoclassify` trigger (falls back to "Other" +
 *    needs_muscle_review) so muscle analytics never sees a null.
 *  - `exercise_category`, `muscle_groups`, `counts_toward_volume`,
 *    `default_measurement_type`, `archived` all use their canonical
 *    column defaults — no parallel data model.
 */
export function ExerciseQuickCreateForm({
  defaultName,
  onCancel,
  onCreated,
  submitLabel = "Add",
}: {
  defaultName?: string;
  onCancel: () => void;
  onCreated?: (id: string, name: string) => void;
  submitLabel?: string;
}) {
  const qc = useQueryClient();
  // Touch devices never auto-focus: Android Chrome pops the soft keyboard +
  // autofill strip while Radix is still moving focus, which leaves the field
  // unable to receive keystrokes. Desktop keeps the convenience.
  const coarsePointer = useIsCoarsePointer();
  const submittingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [category, setCategory] = useState<string>(AUTO);
  const [primaryMuscle, setPrimaryMuscle] = useState<string>(AUTO);
  const [equipment, setEquipment] = useState<string>(NONE);
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cues, setCues] = useState("");
  const [commonMistakes, setCommonMistakes] = useState("");

  useEffect(() => { setName(defaultName ?? ""); }, [defaultName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    const payload: Record<string, unknown> = {
      name: trimmed,
      archived: false,
      difficulty: DEFAULT_EXERCISE_DIFFICULTY,
      default_load_unit: unit,
    };
    if (category !== AUTO) payload.category = category;
    // Left blank → the DB trigger classifies from the name.
    if (primaryMuscle !== AUTO) payload.primary_muscle_group = primaryMuscle;
    if (equipment !== NONE) payload.equipment = equipment;
    if (muscleGroup.trim()) payload.muscle_group = muscleGroup.trim();
    if (youtubeUrl.trim()) payload.youtube_url = youtubeUrl.trim();
    if (cues.trim()) payload.cues = cues.trim();
    if (commonMistakes.trim()) payload.common_mistakes = commonMistakes.trim();

    const { data, error } = await supabase
      .from("exercises")
      .insert(payload as never)
      .select("*")
      .single();
    setBusy(false);
    submittingRef.current = false;
    if (error || !data) {
      toast.error(error?.message ?? "Could not save exercise");
      return;
    }
    upsertExerciseInLibraryCaches(qc, data as never);
    toast.success(`Added "${(data as any).name}" to library`);
    void invalidateExerciseLibrary(qc);
    onCreated?.((data as any).id, (data as any).name);
  };

  return (
    <form onSubmit={submit} className="space-y-3" autoComplete="off">
      <div>
        <Label>Name *</Label>
        <Input
          autoFocus={!coarsePointer}
          required
          // Explicit non-contact identity keeps Android's "Autofill · Contact"
          // strip from covering the form; nothing else about the browser's
          // autofill behaviour is disabled.
          name="exercise_name"
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chest Supported Dumbbell Row"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Uncategorized</SelectItem>
              {EXERCISE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Primary muscle</Label>
          <Select value={primaryMuscle} onValueChange={setPrimaryMuscle}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto-detect</SelectItem>
              {PRIMARY_MUSCLE_GROUPS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Equipment</Label>
          <Select value={equipment} onValueChange={setEquipment}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {EQUIPMENT_OPTIONS.map((eq) => (
                <SelectItem key={eq} value={eq}>{eq}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Default unit</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as "lb" | "kg")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lb">lb (pounds)</SelectItem>
              <SelectItem value="kg">kg (kilograms)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Collapsible open={more} onOpenChange={setMore}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            More details
            <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div>
            <Label>Secondary / legacy muscle notes</Label>
            <Input
              name="exercise_muscle_notes"
              autoComplete="off"
              value={muscleGroup}
              onChange={(e) => setMuscleGroup(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label>YouTube URL</Label>
            <Input
              name="exercise_youtube_url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
          </div>
          <div>
            <Label>Coaching cues</Label>
            <Textarea rows={2} value={cues} onChange={(e) => setCues(e.target.value)} />
          </div>
          <div>
            <Label>Common mistakes</Label>
            <Textarea rows={2} value={commonMistakes} onChange={(e) => setCommonMistakes(e.target.value)} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          disabled={busy || !name.trim()}
          className="bg-gradient-primary font-bold uppercase"
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
