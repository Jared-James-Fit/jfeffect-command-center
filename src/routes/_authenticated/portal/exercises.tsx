import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Play } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/exercises")({ component: ExerciseLibrary });

const CATEGORIES = ["Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back", "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility", "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio"];

function youtubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function ExerciseLibrary() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<any>(null);

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const { data } = await supabase.from("exercises").select("*").order("name");
      return data ?? [];
    },
  });

  const filtered = exercises.filter((e) =>
    (category === "all" || e.category === category) &&
    (!search || e.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <PageHeader title="Exercise Library" subtitle="Search, watch, learn the cues." />
      <div className="space-y-4 p-6 md:p-8">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search exercises…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
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
            {selected.youtube_url && youtubeEmbed(selected.youtube_url) && (
              <div className="mt-4 aspect-video w-full overflow-hidden rounded-md bg-black">
                <iframe src={youtubeEmbed(selected.youtube_url)!} className="h-full w-full" allowFullScreen title={selected.name} />
              </div>
            )}
            {selected.cues && <div className="mt-4"><div className="text-xs font-bold uppercase text-muted-foreground">Cues</div><p className="mt-1 text-sm">{selected.cues}</p></div>}
            {selected.common_mistakes && <div className="mt-3"><div className="text-xs font-bold uppercase text-muted-foreground">Common mistakes</div><p className="mt-1 text-sm">{selected.common_mistakes}</p></div>}
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((e) => (
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
          {filtered.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No exercises yet.</div>
          )}
        </div>
      </div>
    </>
  );
}