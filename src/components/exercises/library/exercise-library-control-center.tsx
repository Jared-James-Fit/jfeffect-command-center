import { useEffect, useMemo, useRef, useState } from "react";
import { MOVEMENT_FAMILIES, MOVEMENT_FAMILY_COLOR_NAME, MOVEMENT_FAMILY_LABEL, resolveMovementFamily } from "@/lib/exercise-family";
import { FamilyDot } from "@/components/exercise-order-badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, Archive, BarChart3, ChevronDown, Copy, Flame, Layers, MoreHorizontal, Pencil, Play, Plus,
  RotateCcw, Search, Trash2, Users, VideoOff, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HighlightedExerciseName } from "@/components/exercise-search-highlight";
import { MuscleTagPicker } from "@/components/exercises/muscle-tag-picker";
import { invalidateExerciseLibrary } from "@/lib/exercise-library-cache";
import { buildCleanVimeoEmbedUrl } from "@/lib/exercise-video";
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from "@/lib/volume";
import {
  ISSUE_LABEL, exerciseIssues, exerciseVideoUrl, findPossibleDuplicates, muscleLabels, pairKey, previewEmbedUrl,
  searchLibrary, summarizeLibrary, videoStatus,
  type DuplicateMatch, type ExerciseAlias, type ExerciseIssue, type ExerciseUsage, type LibraryExercise, type MatchReason,
} from "@/lib/exercise-library";

type Filter = "all" | "attention" | "video" | "novideo" | "aliases" | "duplicates" | "muscles";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs Attention" },
  { value: "video", label: "Has Video" },
  { value: "novideo", label: "No Video" },
  { value: "aliases", label: "Has Aliases" },
  { value: "duplicates", label: "Possible Duplicates" },
  { value: "muscles", label: "Missing Muscle Tags" },
];
const PAGE = 50;

export type ControlCenterActions = {
  onAdd: () => void;
  onEditVideo: (e: any) => void;
  onWarmups: (e: any) => void;
  onVolumeTags: (e: any) => void;
  onArchive: (e: any, archived: boolean) => void;
  onDelete: (e: any) => void;
  busyId?: string | null;
};

export function ExerciseLibraryControlCenter({
  exercises,
  isAdmin,
  actions,
}: {
  exercises: LibraryExercise[];
  isAdmin: boolean;
  actions: ControlCenterActions;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "families">("list");
  const [family, setFamily] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [review, setReview] = useState<{ a: LibraryExercise; b: LibraryExercise } | null>(null);
  const [preview, setPreview] = useState<LibraryExercise | null>(null);

  const { data: aliases = [] } = useQuery({
    queryKey: ["exercise-aliases"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("exercise_aliases").select("alias_key, alias_name, exercise_id, source").order("alias_name");
      if (error) throw error;
      return (data ?? []) as ExerciseAlias[];
    },
  });
  const { data: usageRows = [] } = useQuery({
    queryKey: ["exercise-usage"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("exercise_library_usage");
      if (error) throw error;
      return (data ?? []) as ExerciseUsage[];
    },
  });
  const { data: dismissedRows = [] } = useQuery({
    queryKey: ["exercise-duplicate-dismissals"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("exercise_duplicate_dismissals").select("exercise_a, exercise_b");
      if (error) throw error;
      return (data ?? []) as { exercise_a: string; exercise_b: string }[];
    },
  });

  const usage = useMemo(() => new Map(usageRows.map((u) => [u.exercise_id, u])), [usageRows]);
  const aliasesBy = useMemo(() => {
    const m = new Map<string, ExerciseAlias[]>();
    for (const a of aliases) m.set(a.exercise_id, [...(m.get(a.exercise_id) ?? []), a]);
    return m;
  }, [aliases]);
  const aliasCount = useMemo(() => new Map([...aliasesBy].map(([k, v]) => [k, v.length])), [aliasesBy]);
  const active = useMemo(() => exercises.filter((e) => !e.archived), [exercises]);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const duplicates = useMemo(
    () => findPossibleDuplicates(active, aliases, new Set(dismissedRows.map((d) => pairKey(d.exercise_a, d.exercise_b)))),
    [active, aliases, dismissedRows],
  );
  const issues = useMemo(() => new Map(active.map((e) => [e.id, exerciseIssues(e, duplicates)])), [active, duplicates]);
  const summary = useMemo(() => summarizeLibrary(active, issues, aliasCount), [active, issues, aliasCount]);
  const families = useMemo(
    () => Array.from(new Set(active.map((e) => e.exercise_family).filter(Boolean) as string[])).sort(),
    [active],
  );

  const scope = showArchived ? exercises.filter((e) => e.archived) : active;
  const { hits, highlightTerms } = useMemo(() => {
    const pre = scope.filter((e) => {
      if (family !== "all" && (e.exercise_family ?? "") !== (family === "__none" ? "" : family)) return false;
      if (muscle !== "all") {
        const all = [...(e.muscle_groups ?? []), ...(e.secondary_muscle_groups ?? [])];
        if (!all.includes(muscle)) return false;
      }
      const list = issues.get(e.id) ?? [];
      switch (filter) {
        case "attention": return list.length > 0;
        case "video": return videoStatus(e) === "video";
        case "novideo": return videoStatus(e) !== "video";
        case "aliases": return (aliasCount.get(e.id) ?? 0) > 0;
        case "duplicates": return list.includes("possible_duplicate");
        case "muscles": return list.includes("missing_muscles");
        default: return true;
      }
    });
    const r = searchLibrary(pre, aliases, search);
    if (!search.trim()) {
      // Maintenance queues: most-used first so the fix that matters most is on top.
      const weight = (e: LibraryExercise) => {
        const u = usage.get(e.id);
        return u ? u.active_clients * 1000 + u.programs * 10 + u.logged_sets : 0;
      };
      const sorted = [...r.hits].sort((a, b) =>
        filter === "all" || filter === "video" || filter === "aliases"
          ? a.exercise.name.localeCompare(b.exercise.name)
          : weight(b.exercise) - weight(a.exercise) || a.exercise.name.localeCompare(b.exercise.name));
      return { hits: sorted, highlightTerms: r.highlightTerms };
    }
    return r;
  }, [scope, family, muscle, filter, issues, aliasCount, aliases, search, usage]);

  const [visible, setVisible] = useState(PAGE);
  useEffect(() => setVisible(PAGE), [search, filter, family, muscle, view, showArchived]);
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) setVisible((c) => c + PAGE);
    }, { rootMargin: "800px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [hits.length, view]);

  const refresh = () => {
    void invalidateExerciseLibrary(qc);
    qc.invalidateQueries({ queryKey: ["exercise-aliases"] });
    qc.invalidateQueries({ queryKey: ["exercise-usage"] });
    qc.invalidateQueries({ queryKey: ["exercise-duplicate-dismissals"] });
  };

  const rowProps = (e: LibraryExercise, reason: MatchReason | null) => ({
    exercise: e,
    reason,
    highlightTerms,
    aliases: aliasesBy.get(e.id) ?? [],
    issues: issues.get(e.id) ?? [],
    usage: usage.get(e.id),
    duplicates: duplicates.get(e.id) ?? [],
    families,
    isAdmin,
    open: expanded === e.id,
    onToggle: () => setExpanded((cur) => (cur === e.id ? null : e.id)),
    onPreview: () => setPreview(e),
    onReview: (m: DuplicateMatch) => {
      const other = byId.get(m.id);
      if (other) setReview({ a: e, b: other });
    },
    onChanged: refresh,
    actions,
  });

  const shown = hits.slice(0, visible);
  const grouped = useMemo(() => {
    if (view !== "families") return [];
    const m = new Map<string, typeof hits>();
    for (const h of hits) {
      const k = h.exercise.exercise_family || "No family";
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (a === "No family" ? 1 : b === "No family" ? -1 : a.localeCompare(b)));
  }, [hits, view]);

  return (
    <div className="space-y-3 px-3 py-4 sm:px-6 md:px-8">
      {/* Health summary — every number is a one-tap filter. */}
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <SummaryChip label="Exercises" value={summary.total} onClick={() => setFilter("all")} active={filter === "all"} />
        <SummaryChip label="With video" value={summary.withVideo} tone="good" onClick={() => setFilter("video")} active={filter === "video"} />
        <SummaryChip label="Missing video" value={summary.missingVideo + summary.brokenVideo} tone="warn" onClick={() => setFilter("novideo")} active={filter === "novideo"} />
        <SummaryChip label="Need attention" value={summary.needsAttention} tone="alert" onClick={() => setFilter("attention")} active={filter === "attention"} />
        <div className="hidden sm:ml-auto sm:block">
          <Button type="button" onClick={actions.onAdd} className="bg-gradient-primary font-bold uppercase tracking-wide">
            <Plus className="mr-1.5 h-4 w-4" /> Add exercise
          </Button>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-3 space-y-2 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9 pr-9 text-base sm:text-sm"
            placeholder="Search exercises, aliases, families, muscles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
          <Button type="button" onClick={actions.onAdd} aria-label="Add exercise" className="h-11 w-11 shrink-0 bg-gradient-primary p-0 sm:hidden">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTERS.map((f) => {
            const count = f.value === "attention" ? summary.needsAttention
              : f.value === "duplicates" ? summary.duplicates
              : f.value === "muscles" ? summary.missingMuscles
              : f.value === "aliases" ? summary.withAliases : null;
            return (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)}
                className={cn("min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors",
                  filter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                {f.label}{count != null && count > 0 && <span className="ml-1 opacity-80">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <div className="col-span-2 grid grid-cols-2 rounded-lg bg-muted/60 p-0.5 text-xs font-bold sm:col-span-1">
            {(["list", "families"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn("min-h-8 rounded-md px-3", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {v === "list" ? "Exercises" : "By family"}
              </button>
            ))}
          </div>
          <select aria-label="Family" value={family} onChange={(e) => setFamily(e.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs sm:w-52">
            <option value="all">All families</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="__none">No family</option>
          </select>
          <select aria-label="Muscle" value={muscle} onChange={(e) => setMuscle(e.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs sm:w-44">
            <option value="all">All muscles</option>
            {MUSCLE_GROUPS.filter((m) => m !== "other").map((m) => <option key={m} value={m}>{MUSCLE_GROUP_LABELS[m]}</option>)}
          </select>
          <label className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-1">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
          </label>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filter === "attention" && !search
            ? <><b className="text-foreground">{hits.length}</b> {hits.length === 1 ? "exercise needs" : "exercises need"} attention · most-used first</>
            : <><b className="text-foreground">{hits.length}</b> {showArchived ? "archived" : "canonical"} {hits.length === 1 ? "exercise" : "exercises"}</>}
        </span>
        <span className="hidden sm:inline">Aliases are other names for the same exercise — they share its video &amp; muscles.</span>
      </div>

      {hits.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filter === "attention" ? "Nothing needs attention. The library is healthy. ✅" : "No exercises match."}
        </div>
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground lg:grid">
            <span>Canonical exercise</span><span>Family</span><span>Primary muscles</span><span className="w-28 text-right">Used in</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((h) => <ExerciseRow key={h.exercise.id} {...rowProps(h.exercise, h.reason)} />)}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([fam, list]) => {
            const withVideo = list.filter((h) => videoStatus(h.exercise) === "video").length;
            return (
              <section key={fam} className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-black uppercase tracking-wider">{fam}</h3>
                  <span className="text-[11px] text-muted-foreground">{list.length} variation{list.length === 1 ? "" : "s"} · {withVideo}/{list.length} with video</span>
                </header>
                <ul className="divide-y divide-border">
                  {list.slice(0, 200).map((h) => <ExerciseRow key={h.exercise.id} {...rowProps(h.exercise, h.reason)} compactFamily />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {view === "list" && visible < hits.length && <div ref={sentinel} className="h-10" aria-hidden />}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && <VideoPreviewDialog exercise={preview} />}
      </Dialog>
      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        {review && (
          <DuplicateReviewDialog
            a={review.a}
            b={review.b}
            usage={usage}
            isAdmin={isAdmin}
            onDone={() => { setReview(null); refresh(); }}
          />
        )}
      </Dialog>
    </div>
  );
}

function SummaryChip({ label, value, tone, onClick, active }: {
  label: string; value: number; tone?: "good" | "warn" | "alert"; onClick: () => void; active: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex min-h-12 min-w-0 flex-col items-start justify-center rounded-xl border px-2 py-1 text-left transition-colors sm:min-h-10 sm:flex-row sm:items-baseline sm:gap-1.5 sm:px-3",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/50")}>
      <span className={cn("text-base font-black leading-tight tabular-nums sm:text-lg",
        tone === "good" && "text-emerald-600 dark:text-emerald-400",
        tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400",
        tone === "alert" && value > 0 && "text-destructive")}>{value.toLocaleString()}</span>
      <span className="text-[10px] font-semibold leading-tight text-muted-foreground sm:text-[11px]">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

function Pill({ children, tone = "neutral", onClick, title }: {
  children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "alert" | "primary" | "muted"; onClick?: () => void; title?: string;
}) {
  const cls = cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[10px] font-black uppercase tracking-wide",
    tone === "good" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    tone === "alert" && "bg-destructive/10 text-destructive",
    tone === "primary" && "bg-primary/10 text-primary",
    tone === "muted" && "bg-muted text-muted-foreground",
    tone === "neutral" && "border border-border text-muted-foreground",
    onClick && "cursor-pointer hover:opacity-80");
  return onClick
    ? <button type="button" title={title} className={cls} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
    : <span title={title} className={cls}>{children}</span>;
}

function VideoBadge({ e, onPreview }: { e: LibraryExercise; onPreview: () => void }) {
  const v = videoStatus(e);
  if (v === "video") return <Pill tone="good" onClick={onPreview} title="Preview demo"><Play className="h-2.5 w-2.5 fill-current" /> Video</Pill>;
  if (v === "broken") return <Pill tone="alert" title="Video link is flagged or unusable"><AlertTriangle className="h-2.5 w-2.5" /> Broken video</Pill>;
  return <Pill tone="warn"><VideoOff className="h-2.5 w-2.5" /> No video</Pill>;
}

type RowProps = {
  exercise: LibraryExercise;
  reason: MatchReason | null;
  highlightTerms: string[];
  aliases: ExerciseAlias[];
  issues: ExerciseIssue[];
  usage: ExerciseUsage | undefined;
  duplicates: DuplicateMatch[];
  families: string[];
  isAdmin: boolean;
  open: boolean;
  compactFamily?: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onReview: (m: DuplicateMatch) => void;
  onChanged: () => void;
  actions: ControlCenterActions;
};

function ExerciseRow(p: RowProps) {
  const e = p.exercise;
  const primaries = muscleLabels(e.muscle_groups);
  const otherIssues = p.issues.filter((i) => i !== "no_video" && i !== "broken_video");
  return (
    <li className={cn(p.open && "bg-muted/20")}>
      <div role="button" tabIndex={0} onClick={p.onToggle} aria-expanded={p.open}
        onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); p.onToggle(); } }}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5 text-left lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <FamilyDot family={resolveMovementFamily(e)} />
            <span className="truncate font-bold"><HighlightedExerciseName text={e.name} terms={p.highlightTerms} /></span>
            <VideoBadge e={e} onPreview={p.onPreview} />
            {p.aliases.length > 0 && <Pill tone="primary">{p.aliases.length} alias{p.aliases.length === 1 ? "" : "es"}</Pill>}
            {e.archived && <Pill tone="muted">Archived</Pill>}
            {otherIssues.map((i) => (
              <Pill key={i} tone={i === "possible_duplicate" ? "alert" : "warn"}>{ISSUE_LABEL[i]}</Pill>
            ))}
          </div>
          {p.reason && (
            <div className="mt-0.5 text-[11px] text-primary">
              {p.reason.kind === "alias" ? <>Alias match: “{p.reason.text}”</>
                : p.reason.kind === "family" ? <>Family: {p.reason.text}</>
                : <>Muscle: {p.reason.text}</>}
            </div>
          )}
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground lg:hidden">
            {[!p.compactFamily && (e.exercise_family || "No family"), primaries.join(" · ") || "No muscles"].filter(Boolean).join(" — ")}
          </div>
        </div>
        <div className="flex items-center gap-1.5 lg:hidden">
          <UsageMini u={p.usage} />
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", p.open && "rotate-180")} />
        </div>
        <div className="hidden truncate text-xs text-muted-foreground lg:block">{p.compactFamily ? "" : e.exercise_family || <span className="text-amber-600">No family</span>}</div>
        <div className="hidden truncate text-xs lg:block">{primaries.join(" · ") || <span className="text-amber-600">Missing</span>}</div>
        <div className="hidden w-28 items-center justify-end gap-1.5 lg:flex">
          <UsageMini u={p.usage} />
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", p.open && "rotate-180")} />
        </div>
      </div>
      {p.open && <ExerciseDetail {...p} />}
    </li>
  );
}

function UsageMini({ u }: { u: ExerciseUsage | undefined }) {
  if (!u || (u.programs === 0 && u.templates === 0)) return <span className="text-[11px] text-muted-foreground">Unused</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-muted-foreground" title={`${u.active_clients} active clients · ${u.programs} client programs · ${u.templates} templates`}>
      <Users className="h-3 w-3" />{u.active_clients}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ExerciseDetail(p: RowProps) {
  const e = p.exercise;
  const [familyDraft, setFamilyDraft] = useState(e.exercise_family ?? "");
  const [primary, setPrimary] = useState<string[]>((e.muscle_groups ?? []).filter((m) => m !== "other"));
  const [secondary, setSecondary] = useState<string[]>(e.secondary_muscle_groups ?? []);
  const [aliasDraft, setAliasDraft] = useState("");
  const [videoDraft, setVideoDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const musclesDirty = primary.join() !== (e.muscle_groups ?? []).filter((m) => m !== "other").join()
    || secondary.join() !== (e.secondary_muscle_groups ?? []).join();

  const save = async (patch: Record<string, unknown>, msg: string) => {
    setBusy(true);
    const { error } = await supabase.from("exercises").update(patch as never).eq("id", e.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(msg);
    p.onChanged();
  };
  const saveMuscles = () => {
    if (primary.length === 0) return toast.error("Pick at least one primary muscle.");
    void save({
      muscle_groups: primary,
      secondary_muscle_groups: secondary,
      primary_muscle_group: MUSCLE_GROUP_LABEL_TO_LEGACY[primary[0]] ?? "Other",
      needs_muscle_review: false,
    }, "Muscle tags saved");
  };
  const addAlias = async () => {
    const name = aliasDraft.trim();
    if (!name) return;
    setBusy(true);
    const { error } = await (supabase as any).from("exercise_aliases").insert({ alias_name: name, alias_key: name, exercise_id: e.id, source: "manual" });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" && !/already its own/.test(error.message) ? `“${name}” is already an alias of another exercise.` : error.message);
    setAliasDraft("");
    toast.success(`“${name}” now resolves to ${e.name}`);
    p.onChanged();
  };
  const removeAlias = async (a: ExerciseAlias) => {
    const { error } = await (supabase as any).from("exercise_aliases").delete().eq("alias_key", a.alias_key);
    if (error) return toast.error(error.message);
    toast.success(`Removed alias “${a.alias_name}”`);
    p.onChanged();
  };
  const saveVideo = () => {
    const raw = videoDraft.trim();
    if (!/^https?:\/\//i.test(raw)) return toast.error("Paste a full video link (https://…)");
    const vimeoId = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
    const patch: Record<string, unknown> = vimeoId
      ? { vimeo_video_id: vimeoId, vimeo_url: `https://vimeo.com/${vimeoId}`, vimeo_embed_url: buildCleanVimeoEmbedUrl(vimeoId), video_url: buildCleanVimeoEmbedUrl(vimeoId), video_provider: "vimeo", video_migration_status: "published_with_vimeo", vimeo_working: true, quality_warning: null }
      : { youtube_url: raw, video_url: raw, quality_warning: null };
    setVideoDraft("");
    void save(patch, "Demo video saved");
  };

  const u = p.usage;
  return (
    <div className="space-y-4 border-t border-border/60 px-3 pb-4 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="primary">Canonical exercise</Pill>
        <span className="text-xs text-muted-foreground">A distinct exercise. Its aliases are just other names for it.</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Family" hint="Group of related movements (e.g. Bench Press).">
          {p.isAdmin ? (
            <div className="flex gap-2">
              <Input list={`fam-${e.id}`} value={familyDraft} onChange={(ev) => setFamilyDraft(ev.target.value)} placeholder="e.g. Bench Press" className="h-9" />
              <datalist id={`fam-${e.id}`}>{p.families.map((f) => <option key={f} value={f} />)}</datalist>
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={busy || familyDraft.trim() === (e.exercise_family ?? "")}
                onClick={() => void save({ exercise_family: familyDraft.trim() || null }, "Family updated")}>Save</Button>
            </div>
          ) : <div>{e.exercise_family || "—"}</div>}
        </Section>

        <Section title="Movement (card colour)" hint="Only an actual squat, bench or deadlift variation gets a lift colour. Leg Curl, Row, Pulldown… stay Accessory.">
          {p.isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <FamilyDot family={resolveMovementFamily(e)} />
              <select aria-label="Movement family" value={resolveMovementFamily(e)} disabled={busy}
                onChange={(ev) => void save({ movement_family: ev.target.value }, "Movement updated")}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {MOVEMENT_FAMILIES.map((f) => <option key={f} value={f}>{MOVEMENT_FAMILY_LABEL[f]} · {MOVEMENT_FAMILY_COLOR_NAME[f]}</option>)}
              </select>
            </div>
          ) : <div className="flex items-center gap-2"><FamilyDot family={resolveMovementFamily(e)} />{MOVEMENT_FAMILY_LABEL[resolveMovementFamily(e)]}</div>}
        </Section>

        <Section title={`Aliases (${p.aliases.length})`} hint="Other names that resolve here. They use this exercise's video and muscles.">
          {p.aliases.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.aliases.map((a) => (
                <span key={a.alias_key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-semibold text-primary">
                  {a.alias_name}
                  <button type="button" aria-label={`Remove alias ${a.alias_name}`} onClick={() => void removeAlias(a)} className="rounded-full p-0.5 hover:bg-primary/20"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : <div className="text-xs text-muted-foreground">No aliases yet.</div>}
          <form className="mt-2 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); void addAlias(); }}>
            <Input value={aliasDraft} onChange={(ev) => setAliasDraft(ev.target.value)} placeholder="Add another name…" className="h-9" />
            <Button type="submit" size="sm" variant="outline" className="h-9" disabled={busy || !aliasDraft.trim()}>Add</Button>
          </form>
        </Section>
      </div>

      <Section title="Muscles" hint="Primary = full set in analytics · Secondary = half set.">
        {p.isAdmin ? (
          <>
            <MuscleTagPicker primary={primary} secondary={secondary} disabled={busy} onChange={(n) => { setPrimary(n.primary); setSecondary(n.secondary); }} />
            {musclesDirty && (
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={saveMuscles} disabled={busy}>Save muscles</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setPrimary((e.muscle_groups ?? []).filter((m) => m !== "other")); setSecondary(e.secondary_muscle_groups ?? []); }}>Reset</Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs">
            <div><b>Primary:</b> {muscleLabels(e.muscle_groups).join(", ") || "—"}</div>
            <div><b>Secondary:</b> {muscleLabels(e.secondary_muscle_groups).join(", ") || "—"}</div>
          </div>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Demo video" hint="Aliases use this same demo.">
          <div className="flex flex-wrap items-center gap-2">
            {videoStatus(e) === "video"
              ? <Button type="button" size="sm" variant="outline" onClick={p.onPreview}><Play className="mr-1.5 h-3.5 w-3.5" /> Preview video</Button>
              : <VideoBadge e={e} onPreview={p.onPreview} />}
            {p.isAdmin && <Button type="button" size="sm" variant="ghost" onClick={() => p.actions.onEditVideo(e)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Advanced video settings</Button>}
          </div>
          {p.isAdmin && (
            <form className="mt-2 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); saveVideo(); }}>
              <Input value={videoDraft} onChange={(ev) => setVideoDraft(ev.target.value)} inputMode="url" placeholder={videoStatus(e) === "video" ? "Replace: paste Vimeo/YouTube link" : "Add: paste Vimeo/YouTube link"} className="h-9" />
              <Button type="submit" size="sm" variant="outline" className="h-9" disabled={busy || !videoDraft.trim()}>Save</Button>
            </form>
          )}
        </Section>

        <Section title="Used in" hint="Check this before merging or archiving.">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4 md:grid-cols-2">
            <Stat k="Active clients" v={u?.active_clients ?? 0} />
            <Stat k="Client programs" v={u?.programs ?? 0} />
            <Stat k="Templates" v={u?.templates ?? 0} />
            <Stat k="Logged workouts" v={u?.logged_workouts ?? 0} />
          </div>
          {(u?.programs ?? 0) > 0 && (
            <button type="button" className="mt-1.5 text-xs font-semibold text-primary hover:underline" onClick={() => setShowUsage((s) => !s)}>
              {showUsage ? "Hide" : "Show"} where it's used
            </button>
          )}
          {showUsage && <UsageDetail exerciseId={e.id} />}
        </Section>
      </div>

      {p.duplicates.length > 0 && (
        <Section title="Possible duplicates" hint="Review before merging — nothing is merged automatically.">
          <ul className="space-y-1.5">
            {p.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs">
                <Copy className="h-3.5 w-3.5 text-destructive" />
                <span className="min-w-0 flex-1"><b>{e.name}</b> may match <b>{d.name}</b>{d.via === "alias" && " (alias name)"}</span>
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => p.onReview(d)}>Review</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button type="button" size="sm" variant="outline" onClick={() => p.actions.onVolumeTags(e)}><BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Volume settings</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => p.actions.onWarmups(e)}><Flame className="mr-1.5 h-3.5 w-3.5" /> Warm-ups</Button>
        {p.isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" disabled={p.actions.busyId === e.id}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {e.archived ? (
                <DropdownMenuItem onSelect={() => p.actions.onArchive(e, false)}><RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore to library</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => p.actions.onArchive(e, true)}><Archive className="mr-2 h-3.5 w-3.5" /> Archive (keeps history)</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => p.actions.onDelete(e)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete permanently
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

const MUSCLE_GROUP_LABEL_TO_LEGACY: Record<string, string> = {
  chest: "Chest", lats: "Lats", upper_back: "Upper Back", traps: "Traps", front_delts: "Front Delts",
  side_delts: "Side Delts", rear_delts: "Rear Delts", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms",
  quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", adductors: "Adductors", calves: "Calves",
  core: "Abs/Core", lower_back: "Lower Back", other: "Other",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5">
        <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">{title}</div>
        {hint && <div className="text-[11px] text-muted-foreground/80">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><b className="tabular-nums">{v.toLocaleString()}</b></div>;
}

function UsageDetail({ exerciseId }: { exerciseId: string }) {
  const { data = [], isPending, error } = useQuery({
    queryKey: ["exercise-usage-detail", exerciseId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("exercise_usage_detail", { _exercise_id: exerciseId });
      if (error) throw error;
      return (data ?? []) as { client_id: string; client_name: string; block_id: string; block_name: string; block_status: string; program_rows: number; logged_sets: number; last_logged_at: string | null }[];
    },
  });
  if (isPending) return <div className="mt-2 text-xs text-muted-foreground">Loading…</div>;
  if (error) return <div className="mt-2 text-xs text-destructive">{(error as Error).message}</div>;
  return (
    <ul className="mt-2 max-h-56 divide-y overflow-y-auto rounded-lg border text-xs">
      {data.map((r) => (
        <li key={r.block_id} className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate"><b>{r.client_name}</b> · {r.block_name}</span>
          <span className={cn("rounded px-1 text-[10px] font-bold uppercase", r.block_status?.toLowerCase() === "active" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{r.block_status}</span>
          <span className="w-16 text-right tabular-nums text-muted-foreground">{r.logged_sets} sets</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

function VideoPreviewDialog({ exercise }: { exercise: LibraryExercise }) {
  const url = exerciseVideoUrl(exercise);
  return (
    <DialogContent className="max-w-2xl p-3 sm:p-4">
      <DialogHeader><DialogTitle className="pr-6 text-base">{exercise.name}</DialogTitle></DialogHeader>
      {url ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe src={previewEmbedUrl(url)} title={`${exercise.name} demo`} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
        </div>
      ) : <div className="text-sm text-muted-foreground">No video attached.</div>}
    </DialogContent>
  );
}

type MergePreview = {
  duplicate_name: string; canonical_name: string; program_rows: number; logged_sets: number; member_logs: number;
  maxes: number; notes: number; templates: number; aliases: number; clients: number;
  video_moves: boolean; canonical_has_video: boolean; duplicate_has_video: boolean;
};

function DuplicateReviewDialog({ a, b, usage, isAdmin, onDone }: {
  a: LibraryExercise; b: LibraryExercise; usage: Map<string, ExerciseUsage>; isAdmin: boolean; onDone: () => void;
}) {
  // Default keeper: the one with a video, then the more-used one.
  const score = (e: LibraryExercise) => (videoStatus(e) === "video" ? 1e9 : 0) + (usage.get(e.id)?.logged_sets ?? 0) + (usage.get(e.id)?.programs ?? 0) * 100;
  const [keepId, setKeepId] = useState(score(a) >= score(b) ? a.id : b.id);
  const keep = keepId === a.id ? a : b;
  const drop = keepId === a.id ? b : a;
  const [busy, setBusy] = useState(false);
  const { data: pv, isPending, error } = useQuery({
    queryKey: ["exercise-merge-preview", drop.id, keep.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("exercise_merge_preview", { _duplicate: drop.id, _canonical: keep.id });
      if (error) throw error;
      return data as MergePreview;
    },
  });

  const keepSeparate = async () => {
    setBusy(true);
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const { error } = await (supabase as any).from("exercise_duplicate_dismissals").upsert({ exercise_a: x, exercise_b: y });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Kept as separate exercises");
    onDone();
  };
  const makeAlias = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("admin_make_exercise_alias", { _duplicate: drop.id, _canonical: keep.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`“${drop.name}” is now an alias of ${keep.name}`);
    onDone();
  };

  return (
    <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Possible duplicate</DialogTitle>
        <DialogDescription>Same exercise under two names? Pick the one to keep. Nothing changes until you confirm.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        {[a, b].map((e) => (
          <label key={e.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", keepId === e.id ? "border-primary bg-primary/5" : "border-border")}>
            <input type="radio" className="mt-1" checked={keepId === e.id} onChange={() => setKeepId(e.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 font-bold">{e.name} <VideoBadge e={e} onPreview={() => {}} /></div>
              <div className="text-[11px] text-muted-foreground">
                {e.exercise_family || "No family"} · {muscleLabels(e.muscle_groups).join(", ") || "no muscles"} · {usage.get(e.id)?.active_clients ?? 0} active clients · {usage.get(e.id)?.logged_sets ?? 0} logged sets
              </div>
              <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-primary">{keepId === e.id ? "Keep — canonical" : "Becomes an alias"}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="rounded-xl bg-muted/50 p-3 text-xs">
        <div className="mb-1 font-black uppercase tracking-wider text-muted-foreground">What “Make alias” will do</div>
        {isPending ? <div className="text-muted-foreground">Checking usage…</div>
          : error ? <div className="text-destructive">{(error as Error).message}</div>
          : pv && (
            <ul className="list-disc space-y-0.5 pl-4">
              <li><b>{pv.program_rows}</b> program rows ({pv.clients} client{pv.clients === 1 ? "" : "s"}) and <b>{pv.logged_sets + pv.member_logs}</b> logged sets move to <b>{keep.name}</b> — sets, reps, loads and notes are untouched.</li>
              {(pv.maxes > 0 || pv.notes > 0 || pv.templates > 0) && <li>{pv.maxes} maxes, {pv.notes} notes and {pv.templates} templates are re-pointed too.</li>}
              <li>“{drop.name}” becomes an alias{pv.aliases > 0 && ` (its ${pv.aliases} alias${pv.aliases === 1 ? "" : "es"} come along)`} — typing it still finds {keep.name}.</li>
              <li>{pv.video_moves ? <>Its demo video moves to {keep.name} (which has none).</> : pv.canonical_has_video ? <>{keep.name}'s demo video is used.</> : <>Neither has a demo video yet.</>}</li>
              <li>“{drop.name}” is archived, never deleted — history, PRs and analytics stay intact.</li>
            </ul>
          )}
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="ghost" onClick={keepSeparate} disabled={busy}>Keep separate</Button>
        {isAdmin
          ? <Button type="button" onClick={makeAlias} disabled={busy || isPending || !!error} className="bg-gradient-primary font-bold">Make alias</Button>
          : <span className="text-xs text-muted-foreground">Only admins can merge.</span>}
      </DialogFooter>
    </DialogContent>
  );
}
