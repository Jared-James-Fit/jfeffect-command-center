import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Loader2,
  Play,
  X,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { applySwap, getSwapImpact } from "@/lib/quick-swap.functions";
import {
  applyMemberSwap,
  getMemberSwapImpact,
} from "@/lib/member-swap.functions";

type ExerciseLite = {
  id: string;
  name: string;
  muscle_group: string | null;
  category: string | null;
  equipment: string | null;
  difficulty: string | null;
  vimeo_embed_url?: string | null;
  youtube_url?: string | null;
  thumbnail_url?: string | null;
  cues?: string | null;
  common_mistakes?: string | null;
  default_measurement_type?: string | null;
  primary_movement_pattern?: string | null;
};

type RankedSuggestion = { ex: ExerciseLite; reason: string };

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[,/&·\-]+|\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

const KEYWORD_STOPWORDS = new Set([
  "the", "and", "with", "for", "bar", "barbell", "dumbbell", "machine",
  "cable", "band", "bodyweight", "single", "double", "left", "right",
  "front", "back", "side", "view", "competition", "high", "low", "wide",
  "narrow", "close", "grip", "stance", "alternating", "alternate",
]);

function distinctiveKeyword(name: string): string | null {
  const toks = tokenize(name).filter((t) => !KEYWORD_STOPWORDS.has(t));
  return toks[toks.length - 1] ?? null;
}

/**
 * Movement-pattern synonym groups. When the source exercise's name (or
 * primary_movement_pattern) matches one of `keywords`, we treat every
 * `synonyms` entry as an equally valid alternate — so Leg Press finds
 * Hack/Pendulum/Belt Squat even though the library has no shared
 * `category` or muscle metadata to tie them together.
 */
const MOVEMENT_GROUPS: { label: string; keywords: string[]; synonyms: string[] }[] = [
  { label: "Machine squat / leg press",
    keywords: ["leg press","hack squat","pendulum squat","belt squat","smith squat"],
    synonyms: ["leg press","hack squat","pendulum squat","belt squat","smith squat"] },
  { label: "Squat",
    keywords: ["back squat","front squat","goblet squat","safety bar squat","competition squat","paused squat","box squat","tempo squat"],
    synonyms: ["squat"] },
  { label: "Lunge / split squat",
    keywords: ["lunge","split squat","bulgarian","step-up","step up"],
    synonyms: ["lunge","split squat","bulgarian","step-up","step up"] },
  { label: "Hip hinge",
    keywords: ["deadlift","romanian deadlift","rdl","stiff leg","good morning","hip thrust","glute bridge","back extension","45 extension","hyperextension"],
    synonyms: ["deadlift","rdl","romanian","good morning","hip thrust","glute bridge","extension"] },
  { label: "Horizontal row",
    keywords: ["chest supported row","cable row","dumbbell row","barbell row","seal row","pendlay row","t-bar row","tbar row","machine row","seated row","bent over row","bent-over row","meadows row"],
    synonyms: ["row"] },
  { label: "Vertical pull",
    keywords: ["pull-up","pull up","pullup","chin-up","chin up","chinup","lat pulldown","pulldown"],
    synonyms: ["pull-up","pull up","pullup","chin","pulldown","lat pull"] },
  { label: "Horizontal push",
    keywords: ["bench press","push-up","push up","pushup","dumbbell press","db press","machine chest press","chest press","incline press","decline press","floor press","pec deck","cable fly","chest fly"],
    synonyms: ["bench","press","push-up","push up","pushup","chest press","fly","pec deck"] },
  { label: "Overhead press",
    keywords: ["overhead press","ohp","shoulder press","military press","seated press","arnold press","landmine press"],
    synonyms: ["overhead","shoulder press","military","ohp"] },
  { label: "Side delt",
    keywords: ["lateral raise","side raise","cable lateral","db lateral","y raise"],
    synonyms: ["lateral raise","side raise","y raise"] },
  { label: "Rear delt",
    keywords: ["rear delt","reverse fly","face pull","rear fly"],
    synonyms: ["rear delt","reverse fly","face pull","rear fly"] },
  { label: "Biceps",
    keywords: ["curl","hammer curl","preacher curl","incline curl","spider curl","ez curl","cable curl","drag curl","bayesian"],
    synonyms: ["curl","biceps"] },
  { label: "Triceps",
    keywords: ["pushdown","tricep extension","triceps extension","skull crusher","skullcrusher","jm press","close grip bench","dip","overhead extension","kickback"],
    synonyms: ["tricep","pushdown","skull crusher","jm press","dip","kickback","extension"] },
  { label: "Calf",
    keywords: ["calf raise","standing calf","seated calf","donkey calf"],
    synonyms: ["calf"] },
  { label: "Adductor / Copenhagen",
    keywords: ["copenhagen","adductor","hip adduction"],
    synonyms: ["copenhagen","adductor","hip adduction","side plank"] },
  { label: "Abductor",
    keywords: ["abductor","hip abduction","banded walk","monster walk"],
    synonyms: ["abductor","hip abduction","banded walk","monster walk","clam"] },
  { label: "Side plank / oblique",
    keywords: ["side plank","oblique","copenhagen","windshield wiper","russian twist"],
    synonyms: ["side plank","oblique","copenhagen","windshield wiper","russian twist"] },
  { label: "Plank / anti-extension",
    keywords: ["plank","ab wheel","rollout","dead bug","hollow"],
    synonyms: ["plank","ab wheel","rollout","dead bug","hollow"] },
  { label: "Hamstring curl",
    keywords: ["leg curl","hamstring curl","nordic","slider curl"],
    synonyms: ["leg curl","hamstring curl","nordic"] },
  { label: "Quad isolation",
    keywords: ["leg extension","sissy squat","cyclist squat"],
    synonyms: ["leg extension","sissy","cyclist"] },
];

function matchMovementGroups(src: ExerciseLite): typeof MOVEMENT_GROUPS {
  const haystack = `${src.name ?? ""} ${src.primary_movement_pattern ?? ""}`.toLowerCase();
  return MOVEMENT_GROUPS.filter((g) => g.keywords.some((k) => haystack.includes(k)));
}

/** Coarse equipment family so "Machine" ≈ "Leg press" ≈ "Cable machine". */
function equipmentFamily(equipment: string | null | undefined): string {
  const eq = (equipment ?? "").toLowerCase();
  if (!eq) return "unknown";
  if (/bodyweight/.test(eq)) return "bodyweight";
  if (/barbell/.test(eq)) return "barbell";
  if (/dumbbell/.test(eq)) return "dumbbell";
  if (/kettlebell/.test(eq)) return "kettlebell";
  if (/band/.test(eq)) return "band";
  if (/cable/.test(eq)) return "cable";
  if (/smith|hack|pendulum|leg press|belt squat|machine|pec deck/.test(eq)) return "machine";
  return "other";
}

function rankSuggestions(src: ExerciseLite, pool: ExerciseLite[]): RankedSuggestion[] {
  const cand = pool.filter((e) => e.id !== src.id);
  const byName = (a: ExerciseLite, b: ExerciseLite) =>
    (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase());
  const srcTokens = new Set(tokenize(src.muscle_group));
  const kw = distinctiveKeyword(src.name);
  const sameCat = (e: ExerciseLite) => !!src.category && e.category === src.category;
  const sharedMuscles = (e: ExerciseLite) => {
    if (srcTokens.size === 0) return false;
    return tokenize(e.muscle_group).some((t) => srcTokens.has(t));
  };
  const srcGroups = matchMovementGroups(src);
  const srcGroupKey = new Set(srcGroups.map((g) => g.label));
  const inSameGroup = (e: ExerciseLite) => {
    if (srcGroupKey.size === 0) return false;
    const groups = matchMovementGroups(e);
    return groups.some((g) => srcGroupKey.has(g.label));
  };
  const srcFamily = equipmentFamily(src.equipment);
  const sameFamily = (e: ExerciseLite) => equipmentFamily(e.equipment) === srcFamily && srcFamily !== "unknown";
  const sameTracking = (e: ExerciseLite) =>
    !!src.default_measurement_type &&
    e.default_measurement_type === src.default_measurement_type;

  const buckets: Array<[ExerciseLite[], string]> = [
    // Movement-group matches come first — these are the curated synonyms
    // (Leg Press ↔ Hack/Pendulum/Belt Squat, Copenhagen ↔ side plank, etc.)
    [cand.filter((e) => inSameGroup(e) && sameFamily(e) && sameTracking(e)).sort(byName), "Same pattern · same equipment"],
    [cand.filter((e) => inSameGroup(e) && sameFamily(e)).sort(byName), "Same pattern · similar equipment"],
    [cand.filter((e) => inSameGroup(e) && sameTracking(e)).sort(byName), "Same pattern"],
    [cand.filter(inSameGroup).sort(byName), "Same pattern"],
    [cand.filter((e) => sameCat(e) && e.equipment === src.equipment).sort(byName), "Closest match"],
    [cand.filter((e) => sameCat(e) && sameFamily(e)).sort(byName), "Same category · similar equipment"],
    [cand.filter(sameCat).sort(byName), "Same movement"],
    [cand.filter((e) => sharedMuscles(e) && sameTracking(e)).sort(byName), "Same muscles"],
    [cand.filter(sharedMuscles).sort(byName), "Same muscles"],
    [
      kw
        ? cand
            .filter((e) => (e.name ?? "").toLowerCase().includes(kw))
            .sort(byName)
        : [],
      "Similar",
    ],
  ];

  const out: RankedSuggestion[] = [];
  const seen = new Set<string>();
  for (const [bucket, reason] of buckets) {
    for (const e of bucket) {
      if (out.length >= 16) break;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ ex: e, reason });
    }
    if (out.length >= 16) break;
  }
  return out;
}

/** Map equipment chip → predicate over an exercise's free-text equipment field. */
const EQUIPMENT_CHIPS = [
  "Best Match",
  "Full Gym",
  "Home Gym",
  "Dumbbells",
  "Machines",
  "Bodyweight",
  "No Barbell",
] as const;
type EquipmentChip = (typeof EQUIPMENT_CHIPS)[number];

function matchesChip(chip: EquipmentChip, equipment: string | null): boolean {
  if (chip === "Best Match") return true;
  const eq = (equipment ?? "").toLowerCase();
  switch (chip) {
    case "Full Gym":
      return true; // anything's available in a full gym
    case "Home Gym":
      return /dumbbell|bodyweight|band|kettlebell/.test(eq);
    case "Dumbbells":
      return /dumbbell/.test(eq);
    case "Machines":
      return /machine|smith|pendulum|hack|leg press|cable/.test(eq);
    case "Bodyweight":
      return /bodyweight/.test(eq);
    case "No Barbell":
      return !/barbell/.test(eq);
  }
}

const SELECT_COLS = "id,name,muscle_group,category,equipment,difficulty,vimeo_embed_url,youtube_url,thumbnail_url,cues,common_mistakes,default_measurement_type,primary_movement_pattern";
const PAGE_SIZE = 20;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function youtubeEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  // Match v=ID or youtu.be/ID or /embed/ID
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1` : null;
}

function vimeoAutoplay(url: string | null | undefined): string | null {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}autoplay=1&title=0&byline=0&portrait=0`;
}

function ExerciseRowCard({
  ex,
  reason,
  onSelect,
}: {
  ex: ExerciseLite;
  reason?: string;
  onSelect: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const meta = [ex.muscle_group, ex.equipment].filter(Boolean).join(" · ");
  const vimeoSrc = vimeoAutoplay(ex.vimeo_embed_url);
  const ytSrc = !vimeoSrc ? youtubeEmbed(ex.youtube_url) : null;
  const hasVideo = !!(vimeoSrc || ytSrc);
  const cues = (ex.cues ?? "").trim();
  const mistakes = (ex.common_mistakes ?? "").trim();

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{ex.name}</div>
          {reason && <div className="mt-0.5 text-[11px] font-medium text-primary/80">{reason}</div>}
          {meta && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasVideo && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={(e) => { e.stopPropagation(); setPlaying((p) => !p); }}
              aria-label={playing ? `Hide ${ex.name} video` : `Play ${ex.name} video`}
              aria-pressed={playing}
            >
              {playing ? <X className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            </Button>
          )}
          <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={onSelect}>
            Use
          </Button>
        </div>
      </div>
      {playing && hasVideo && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <div className="relative w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={(vimeoSrc ?? ytSrc) as string}
              title={`${ex.name} demonstration`}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          {(cues || mistakes) && (
            <div className="mt-2 space-y-1.5 text-[12px] leading-snug">
              {cues && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Cues</div>
                  <div className="whitespace-pre-line text-foreground/90">{cues}</div>
                </div>
              )}
              {mistakes && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Avoid</div>
                  <div className="whitespace-pre-line text-foreground/90">{mistakes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ViewMode = "suggestions" | "search" | "warning" | "scope";

/**
 * Shared Quick Swap entry point used by every exercise row in
 * WorkoutDayView (both coaching clients and membership users).
 */
export function QuickSwapButton({
  rowId,
  exerciseId,
  exerciseName,
  muscleGroup,
  category,
  equipment,
  difficulty,
  swapContext,
}: {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  muscleGroup?: string | null;
  category?: string | null;
  equipment?: string | null;
  difficulty?: string | null;
  /**
   * Where to persist the swap. Defaults to the coaching-client path
   * (writes to `pl_exercise_rows`). When the calling row belongs to a
   * member workout, pass `{ kind: "member", enrollmentId, weekIndex,
   * dayIndex, exerciseIndex }` so the swap is stored in
   * `member_exercise_swaps` and survives refresh.
   */
  swapContext?:
    | { kind: "client" }
    | {
        kind: "member";
        enrollmentId: string;
        weekIndex: number;
        dayIndex: number;
        exerciseIndex: number;
      };
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>("suggestions");
  const [pending, setPending] = useState<ExerciseLite | null>(null);
  const [scope, setScope] = useState<"today" | "future">("today");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [chip, setChip] = useState<EquipmentChip>("Best Match");
  const debouncedSearch = useDebounced(search.trim(), 300);
  const qc = useQueryClient();
  const isMember = swapContext?.kind === "member";
  const getImpactFnClient = useServerFn(getSwapImpact);
  const applySwapFnClient = useServerFn(applySwap);
  const getImpactFnMember = useServerFn(getMemberSwapImpact);
  const applySwapFnMember = useServerFn(applyMemberSwap);

  // Reset state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setMode("suggestions");
      setPending(null);
      setScope("today");
      setSearch("");
      setPage(0);
      setChip("Best Match");
    }
  }, [open]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const {
    data: suggestions = [],
    isLoading,
    isError,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ["quick-swap-suggestions", exerciseId, muscleGroup, category, difficulty, equipment, exerciseName],
    enabled: open && !!exerciseId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      if (!exerciseId) return [] as RankedSuggestion[];
      let src: ExerciseLite = {
        id: exerciseId,
        name: exerciseName,
        muscle_group: muscleGroup ?? null,
        category: category ?? null,
        equipment: equipment ?? null,
        difficulty: difficulty ?? null,
      };

      // Pull authoritative source metadata so ranking has the full
      // picture (default_measurement_type, primary_movement_pattern,
      // canonical muscle_group string) even when the row only carried
      // an exerciseId.
      const { data: srcRow } = await supabase
        .from("exercises")
        .select(SELECT_COLS)
        .eq("id", exerciseId)
        .maybeSingle();
      if (srcRow) src = { ...src, ...(srcRow as ExerciseLite), id: exerciseId, name: srcRow.name ?? exerciseName };

      const pool = new Map<string, ExerciseLite>();
      const ingest = (rows: ExerciseLite[] | null | undefined) => {
        for (const r of rows ?? []) if (r.id !== exerciseId) pool.set(r.id, r);
      };

      // Tier 0: pull every exercise whose name matches a synonym of any
      // movement group the source belongs to. This is what makes
      // Leg Press → Hack/Pendulum/Belt Squat work even with no shared
      // category. PostgREST's .or() needs ilike.*pattern* and commas
      // would split values, so issue parallel queries instead.
      const srcGroups = matchMovementGroups(src);
      const synonyms = Array.from(
        new Set(srcGroups.flatMap((g) => g.synonyms.map((s) => s.toLowerCase()))),
      );
      if (synonyms.length > 0) {
        const results = await Promise.all(
          synonyms.map((syn) =>
            supabase
              .from("exercises")
              .select(SELECT_COLS)
              .eq("archived", false)
              .ilike("name", `%${syn}%`)
              .neq("id", exerciseId)
              .limit(40)
              .then((r) => (r.error ? [] : ((r.data ?? []) as ExerciseLite[]))),
          ),
        );
        for (const rows of results) ingest(rows);
      }

      // Tier 1: same category — still the strongest signal when the
      // movement-group net misses (e.g. "Abdominals" catches a lot).
      if (src.category) {
        const { data, error } = await supabase
          .from("exercises")
          .select(SELECT_COLS)
          .eq("archived", false)
          .eq("category", src.category)
          .neq("id", exerciseId)
          .limit(60);
        if (error) throw error;
        ingest(data as ExerciseLite[]);
      }

      // Tier 2: keyword fallback on the distinctive movement noun
      const kw = distinctiveKeyword(src.name);
      if (kw && pool.size < 24) {
        const { data, error } = await supabase
          .from("exercises")
          .select(SELECT_COLS)
          .eq("archived", false)
          .ilike("name", `%${kw}%`)
          .neq("id", exerciseId)
          .limit(60);
        if (error) throw error;
        ingest(data as ExerciseLite[]);
      }

      return rankSuggestions(src, Array.from(pool.values()));
    },
  });

  // Which equipment chips actually yield results — only those render.
  const availableChips = useMemo<EquipmentChip[]>(() => {
    if (suggestions.length === 0) return ["Best Match"];
    return EQUIPMENT_CHIPS.filter((c) =>
      c === "Best Match" || suggestions.some((s) => matchesChip(c, s.ex.equipment)),
    );
  }, [suggestions]);

  const filteredSuggestions = useMemo(
    () => suggestions.filter((s) => matchesChip(chip, s.ex.equipment)),
    [suggestions, chip],
  );

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ["quick-swap-search", debouncedSearch, page, exerciseId],
    enabled: open && mode === "search" && debouncedSearch.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from("exercises")
        .select(SELECT_COLS, { count: "exact" })
        .eq("archived", false)
        .ilike("name", `%${debouncedSearch}%`)
        .order("name")
        .range(from, to);
      if (exerciseId) q = q.neq("id", exerciseId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as ExerciseLite[], total: count ?? 0 };
    },
  });

  const startSelect = (ex: ExerciseLite) => {
    setPending(ex);
    setScope("today");
    const diff =
      (muscleGroup && ex.muscle_group && ex.muscle_group !== muscleGroup) ||
      (category && ex.category && ex.category !== category);
    setMode(diff ? "warning" : "scope");
  };

  // Pull "how many future workouts" for the scope step.
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: ["quick-swap-impact", rowId, isMember],
    enabled: open && mode === "scope" && !!pending,
    staleTime: 30_000,
    queryFn: async () => {
      if (isMember && swapContext && swapContext.kind === "member") {
        return getImpactFnMember({
          data: {
            enrollmentId: swapContext.enrollmentId,
            weekIndex: swapContext.weekIndex,
            dayIndex: swapContext.dayIndex,
            exerciseIndex: swapContext.exerciseIndex,
          },
        });
      }
      return getImpactFnClient({ data: { rowId } });
    },
  });

  const swapMutation = useMutation({
    mutationFn: async (vars: { newExerciseId: string; scope: "today" | "future" }) => {
      if (isMember && swapContext && swapContext.kind === "member") {
        return applySwapFnMember({
          data: {
            enrollmentId: swapContext.enrollmentId,
            weekIndex: swapContext.weekIndex,
            dayIndex: swapContext.dayIndex,
            exerciseIndex: swapContext.exerciseIndex,
            newExerciseId: vars.newExerciseId,
            scope: vars.scope,
          },
        });
      }
      return applySwapFnClient({ data: { rowId, ...vars } });
    },
    onSuccess: (res: { count: number }, vars) => {
      toast.success(
        vars.scope === "future"
          ? `Swapped across ${res.count} workout${res.count === 1 ? "" : "s"}`
          : `Swapped for today`,
      );
      // Refresh any cached workout-day data so the new exercise appears
      // immediately. We refetch (not just invalidate) so the row card
      // re-renders before the sheet closes — otherwise users saw the old
      // exercise name lingering and assumed the swap didn't apply.
      qc.refetchQueries({
        type: "active",
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && k.startsWith("pl-");
        },
      });
      setOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Swap failed");
    },
  });

  const totalPages = useMemo(() => {
    if (!searchResults) return 1;
    return Math.max(1, Math.ceil(searchResults.total / PAGE_SIZE));
  }, [searchResults]);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-xs"
        aria-label={`Quick swap ${exerciseName}`}
      >
        <ArrowLeftRight className="mr-1 h-3 w-3" /> Swap
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate">{exerciseName}</SheetTitle>
            <SheetDescription>
              {mode === "search"
                ? "Search all exercises."
                : mode === "warning"
                ? "Confirm different target."
                : mode === "scope"
                ? "Choose where to apply."
                : "Pick an alternate exercise."}
            </SheetDescription>
          </SheetHeader>

          {mode === "suggestions" && (
            <div className="mt-4 space-y-2">
              {!exerciseId && (
                <p className="text-sm text-muted-foreground">
                  This row isn't linked to an exercise, so we can't suggest alternates.
                </p>
              )}
              {exerciseId && isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Finding alternates…
                </div>
              )}
              {exerciseId && !isLoading && isError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex-1 text-xs">
                    <strong className="block">Couldn't load alternates</strong>
                    {(suggestionsError as Error)?.message ?? "Network error"}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => refetchSuggestions()}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" /> Retry
                  </Button>
                </div>
              )}

              {exerciseId && !isLoading && !isError && suggestions.length > 0 && availableChips.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {availableChips.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setChip(c)}
                      className={
                        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
                        (chip === c
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground")
                      }
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {exerciseId && !isLoading && !isError && suggestions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No close alternates found. Try Search All Exercises below.
                </p>
              )}
              {exerciseId && !isLoading && !isError && suggestions.length > 0 && filteredSuggestions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No alternates match "{chip}". Pick another filter.
                </p>
              )}
              {filteredSuggestions.map(({ ex, reason }) => (
                <ExerciseRowCard key={ex.id} ex={ex} reason={reason} onSelect={() => startSelect(ex)} />
              ))}

              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setMode("search")}
                disabled={!exerciseId}
              >
                <Search className="mr-2 h-4 w-4" /> Search All Exercises
              </Button>
            </div>
          )}

          {mode === "search" && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setMode("suggestions")}
                  aria-label="Back to suggestions"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Input
                  autoFocus
                  placeholder="Search exercises…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>

              {debouncedSearch.length < 2 && (
                <p className="text-xs text-muted-foreground px-1">Type at least 2 characters.</p>
              )}
              {debouncedSearch.length >= 2 && isSearching && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              )}
              {debouncedSearch.length >= 2 && !isSearching && (searchResults?.rows.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">No matches.</p>
              )}
              {(searchResults?.rows ?? []).map((ex) => (
                <ExerciseRowCard key={ex.id} ex={ex} onSelect={() => startSelect(ex)} />
              ))}

              {searchResults && searchResults.total > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}

          {mode === "warning" && pending && (
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <strong className="block">Different target</strong>
                  This exercise targets a different muscle group or category. Continue anyway?
                </div>
              </div>
              <ExerciseRowCard ex={pending} onSelect={() => setMode("scope")} />
              <Button variant="ghost" className="w-full" onClick={() => setMode("suggestions")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </div>
          )}

          {mode === "scope" && pending && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">New exercise</div>
                <div className="mt-0.5 truncate text-sm font-medium">{pending.name}</div>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Where should this swap apply?</div>
                <RadioGroup
                  value={scope}
                  onValueChange={(v) => setScope(v as "today" | "future")}
                  className="space-y-2"
                >
                  <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                    <RadioGroupItem value="today" id="swap-scope-today" className="mt-0.5" />
                    <Label htmlFor="swap-scope-today" className="flex-1 cursor-pointer">
                      <div className="text-sm font-medium">Today only</div>
                      <div className="text-xs text-muted-foreground">Just this workout.</div>
                    </Label>
                  </div>
                  <div
                    className={
                      "flex items-start gap-2 rounded-md border border-border px-3 py-2 " +
                      (impact?.isTemplate ? "opacity-50" : "")
                    }
                  >
                    <RadioGroupItem
                      value="future"
                      id="swap-scope-future"
                      className="mt-0.5"
                      disabled={!!impact?.isTemplate}
                    />
                    <Label htmlFor="swap-scope-future" className="flex-1 cursor-pointer">
                      <div className="text-sm font-medium">Future workouts in this block</div>
                      <div className="text-xs text-muted-foreground">
                        {impactLoading
                          ? "Counting…"
                          : impact?.isTemplate
                          ? "Not available on template blocks."
                          : `${impact?.futureCount ?? 0} uncompleted workout${(impact?.futureCount ?? 0) === 1 ? "" : "s"} affected.`}
                      </div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="ghost" onClick={() => setMode("suggestions")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => swapMutation.mutate({ newExerciseId: pending.id, scope })}
                  disabled={swapMutation.isPending}
                  className="flex-1"
                >
                  {swapMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Confirm Swap
                </Button>
              </div>
            </div>
          )}

          <SheetFooter className="mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default QuickSwapButton;