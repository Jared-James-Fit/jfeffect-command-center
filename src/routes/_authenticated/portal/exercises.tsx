import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Play } from "lucide-react";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { useExerciseVideoSetGlobal } from "@/hooks/use-exercise-video-set";

export const Route = createFileRoute("/_authenticated/portal/exercises")({
  component: ExerciseLibrary,
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
});

const CATEGORIES = ["Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back", "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility", "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio"];

function ExerciseLibrary() {
  const { id: focusId } = Route.useSearch();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<any>(null);

  // Debounce search input (300ms) so filtering doesn't run on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: exercises = [], isLoading: exercisesLoading } = useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const { data } = await supabase.from("exercises").select("*").order("name").limit(5000);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!focusId || !exercises.length) return;
    const match = exercises.find((e: any) => e.id === focusId);
    if (match) {
      setSelected(match);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [focusId, exercises]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return exercises.filter((e: any) =>
      (category === "all" || e.category === category) &&
      (!q || e.name.toLowerCase().includes(q))
    );
  }, [exercises, category, search]);

  // Windowed rendering — only render a slice at a time. Load more on scroll
  // via IntersectionObserver. Keeps the 1700+ exercise library snappy.
  const PAGE = 80;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => { setVisibleCount(PAGE); }, [search, category]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisibleCount((c) => Math.min(c + PAGE, filtered.length));
      }
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [filtered.length]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <>
      <PageHeader title="Exercise Library" subtitle="Search, watch, learn the cues." />
      <div className="space-y-4 p-6 md:p-8">
        <div className="sticky top-0 z-20 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-6 md:px-8 py-3 bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search exercises…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selected && (
          <Card className="border-primary/40 bg-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-black">{selected.name}</div>
                <div className="text-xs text-muted-foreground">{selected.category} · {selected.muscle_group}</div>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>Close</button>
            </div>
            <ExerciseVideo exercise={selected} />
            {selected.cues && <div className="mt-4"><div className="text-xs font-bold uppercase text-muted-foreground">Cues</div><p className="mt-1 text-sm">{selected.cues}</p></div>}
            {selected.common_mistakes && <div className="mt-3"><div className="text-xs font-bold uppercase text-muted-foreground">Common mistakes</div><p className="mt-1 text-sm">{selected.common_mistakes}</p></div>}
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {exercisesLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Card key={`sk-${i}`} className="h-full border-border bg-card p-4" aria-hidden="true">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                </Card>
              ))
            : visible.map((e) => (
            <button key={e.id} onClick={() => setSelected(e)} className="text-left">
              <Card className="group h-full border-border bg-card p-4 transition hover:border-primary hover:shadow-glow">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-gradient-primary text-primary-foreground"><Play className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <div className="truncate font-bold">{e.name}</div>
                    <div className="text-xs text-muted-foreground">{e.category}</div>
                  </div>
                </div>
              </Card>
            </button>
          ))}
          {!exercisesLoading && filtered.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No exercises yet.</div>
          )}
        </div>
        {!exercisesLoading && visibleCount < filtered.length && (
          <div ref={sentinelRef} className="h-10 w-full" aria-hidden="true" />
        )}
      </div>
    </>
  );
}

function ExerciseVideo({ exercise }: { exercise: any }) {
  const { data: globalSet } = useExerciseVideoSetGlobal();
  const src = getExerciseVideoSource(exercise, { globalOverride: globalSet ?? null });
  if (src.status === "coming_soon") {
    return (
      <div className="mt-4 grid aspect-video w-full place-items-center rounded-xl border border-dashed border-border bg-black/40 text-sm text-muted-foreground">
        Video coming soon.
      </div>
    );
  }
  return (
    <iframe
      src={src.url}
      title={`${exercise.name} video`}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      className="mt-4 w-full aspect-video rounded-xl border border-border bg-black"
    />
  );
}