import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchLibrary, type ExerciseAlias, type LibraryExercise } from "@/lib/exercise-library";
import { MuscleTagPicker } from "@/components/exercises/muscle-tag-picker";
import { useIsCoarsePointer } from "@/hooks/use-touch-viewport";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { findCanonicalExerciseMatch } from "@/lib/exercise-search";
import { MOVEMENT_FAMILIES, MOVEMENT_FAMILY_COLOR_NAME, MOVEMENT_FAMILY_LABEL } from "@/lib/exercise-family";
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
  librarySetup = false,
}: {
  defaultName?: string;
  onCancel: () => void;
  onCreated?: (id: string, name: string) => void;
  submitLabel?: string;
  /** Admin library: full guided setup (family, aliases, required muscles). */
  librarySetup?: boolean;
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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState("");
  const [movementFamily, setMovementFamily] = useState<string>(AUTO);
  const [aliasText, setAliasText] = useState("");
  const [muscles, setMuscles] = useState<{ primary: string[]; secondary: string[] }>({ primary: [], secondary: [] });

  // Live duplicate guard: canonical names AND aliases, as the coach types.
  const { data: lookup = [] } = useQuery({
    queryKey: ["exercise-create-lookup"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("exercises").select("id,name,archived,exercise_family,equipment,muscle_group,primary_muscle_group,category" as any).eq("archived", false).limit(5000);
      return (data ?? []) as unknown as LibraryExercise[];
    },
  });
  const { data: aliases = [] } = useQuery({
    queryKey: ["exercise-aliases"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("exercise_aliases").select("alias_key, alias_name, exercise_id, source").order("alias_name");
      return (data ?? []) as ExerciseAlias[];
    },
  });
  const families = useMemo(
    () => Array.from(new Set(lookup.map((e) => e.exercise_family).filter(Boolean) as string[])).sort(),
    [lookup],
  );
  const matches = useMemo(() => {
    const q = name.trim();
    if (q.length < 3) return [];
    return searchLibrary(lookup, aliases, q).hits.filter((h) => h.strong).slice(0, 3);
  }, [lookup, aliases, name]);
  const pickExisting = (e: LibraryExercise) => {
    upsertExerciseInLibraryCaches(qc, e as never);
    toast.success(`Using existing "${e.name}"`);
    onCreated?.(e.id, e.name);
  };
  const needsMuscles = librarySetup && muscles.primary.length === 0;

  useEffect(() => { setName(defaultName ?? ""); }, [defaultName]);

  const focusNameFromTouchGesture = () => {
    if (!coarsePointer || busy) return;
    window.requestAnimationFrame(() => {
      const input = nameInputRef.current;
      if (input && document.activeElement !== input) input.focus({ preventScroll: true });
    });
  };

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
    if (family.trim()) payload.exercise_family = family.trim();
    // Left on Auto → the database classifies squat / bench / deadlift / accessory from the name.
    if (movementFamily !== AUTO) payload.movement_family = movementFamily;
    if (muscles.primary.length) {
      payload.muscle_groups = muscles.primary;
      payload.secondary_muscle_groups = muscles.secondary;
    }

    try {
      // Reuse the canonical library record before creating anything new.
      // Programming labels (PRIMARY/SECONDARY/etc.) are prescription metadata,
      // never part of exercise identity.
      const { data: existingRows, error: lookupError } = await supabase
        .from("exercises")
        .select("id,name,archived")
        .eq("archived", false);
      if (lookupError) {
        toast.error(lookupError.message);
        return;
      }
      const existing = findCanonicalExerciseMatch((existingRows ?? []) as any[], trimmed, aliases);
      if (existing) {
        upsertExerciseInLibraryCaches(qc, existing as never);
        toast.success(`Using existing "${existing.name}" from library`);
        onCreated?.(existing.id, existing.name);
        return;
      }

      const { data, error } = await supabase
        .from("exercises")
        .insert(payload as never)
        .select("*")
        .single();
      if (error && (error as { code?: string }).code === "23505") {
        // The database's duplicate guard recognised an alias / equivalent name the
        // lookup above couldn't (e.g. another coach just added it). Reuse it.
        const canonicalId = /canonical id ([0-9a-f-]{36})/i.exec(error.message)?.[1];
        if (canonicalId) {
          const { data: found } = await supabase.from("exercises").select("*").eq("id", canonicalId).maybeSingle();
          if (found) {
            upsertExerciseInLibraryCaches(qc, found as never);
            toast.success(`Using existing "${(found as any).name}" from library`);
            onCreated?.((found as any).id, (found as any).name);
            return;
          }
        }
      }
      if (error || !data) {
        toast.error(error?.message ?? "Could not save exercise");
        return;
      }
      upsertExerciseInLibraryCaches(qc, data as never);
      const aliasNames = aliasText.split(/[,\n]/).map((a) => a.trim()).filter(Boolean);
      for (const alias of aliasNames) {
        const { error: aliasError } = await (supabase as any).from("exercise_aliases")
          .insert({ alias_name: alias, alias_key: alias, exercise_id: (data as any).id, source: "manual" });
        if (aliasError) toast.error(`Alias “${alias}”: ${aliasError.message}`);
      }
      qc.invalidateQueries({ queryKey: ["exercise-aliases"] });
      toast.success(`Added "${(data as any).name}" to library`);
      void invalidateExerciseLibrary(qc);
      onCreated?.((data as any).id, (data as any).name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save exercise");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" autoComplete="off">
      <div>
        <Label>Name *</Label>
        <Input
          ref={nameInputRef}
          autoFocus={!coarsePointer}
          required
          onPointerDown={(event) => {
            if (event.pointerType === "touch") focusNameFromTouchGesture();
          }}
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
        {matches.length > 0 && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-50 p-2 dark:bg-amber-500/10">
            <div className="text-[11px] font-black uppercase tracking-wide text-amber-800 dark:text-amber-300">Possible existing exercise</div>
            {matches.map((m) => (
              <div key={m.exercise.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{m.exercise.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {m.reason?.kind === "alias" ? `Alias: ${m.reason.text}` : m.exercise.exercise_family || "Exercise"}
                  </div>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => pickExisting(m.exercise)}>Use existing</Button>
              </div>
            ))}
            <div className="text-[11px] text-muted-foreground">Only create a new one if it's a genuinely different movement.</div>
          </div>
        )}
      </div>

      {librarySetup && (
        <>
          <div>
            <Label>Exercise family</Label>
            <Input list="exercise-family-options" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="e.g. Bench Press (auto-detected if blank)" autoComplete="off" />
            <datalist id="exercise-family-options">{families.map((f) => <option key={f} value={f} />)}</datalist>
          </div>
          <div>
            <Label>Movement (card colour)</Label>
            <Select value={movementFamily} onValueChange={setMovementFamily}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto-detect from name</SelectItem>
                {MOVEMENT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>{MOVEMENT_FAMILY_LABEL[f]} · {MOVEMENT_FAMILY_COLOR_NAME[f]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-1 text-[11px] text-muted-foreground">Only an actual squat, bench or deadlift variation. Leg Curl, Row, Pulldown… are Accessory.</div>
          </div>
          <div>
            <Label>Primary &amp; secondary muscles *</Label>
            <div className="mt-1.5"><MuscleTagPicker primary={muscles.primary} secondary={muscles.secondary} onChange={setMuscles} /></div>
          </div>
          <div>
            <Label>Aliases <span className="font-normal text-muted-foreground">(other names for this exact exercise)</span></Label>
            <Input value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="e.g. Comp Bench, Flat Barbell Bench" autoComplete="off" />
          </div>
        </>
      )}

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
        <div className={librarySetup ? "hidden" : undefined}>
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
          disabled={busy || !name.trim() || needsMuscles}
          title={needsMuscles ? "Pick at least one primary muscle" : undefined}
          className="bg-gradient-primary font-bold uppercase"
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
