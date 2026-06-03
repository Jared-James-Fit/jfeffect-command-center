import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, Youtube } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/exercises")({
  component: ExercisesAdmin,
});

const CATEGORIES = ["Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back", "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility", "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio"];

function ExercisesAdmin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const { data, error } = await supabase.from("exercises").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = exercises.filter((e) =>
    (category === "all" || e.category === category) &&
    (!search || e.name.toLowerCase().includes(search.toLowerCase()))
  );

  const del = async (id: string) => {
    if (!confirm("Delete exercise?")) return;
    await supabase.from("exercises").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["exercises"] });
  };

  return (
    <>
      <PageHeader
        title="Exercise Library"
        subtitle={`${exercises.length} exercises · clients can search & watch`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add exercise
              </Button>
            </DialogTrigger>
            <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["exercises"] })} />
          </Dialog>
        }
      />
      <div className="space-y-4 p-6 md:p-8">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <Card key={e.id} className="border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.category} · {e.muscle_group ?? "—"}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => del(e.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              {e.youtube_url && (
                <a href={e.youtube_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  <Youtube className="h-3 w-3" /> Watch video
                </a>
              )}
              {e.cues && <p className="text-xs text-muted-foreground line-clamp-2">{e.cues}</p>}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function NewExerciseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", category: CATEGORIES[0], muscle_group: "", equipment: "",
    youtube_url: "", cues: "", common_mistakes: "", difficulty: "Intermediate",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("exercises").insert(form);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Added");
    onCreated();
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>New exercise</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Muscle group</Label><Input value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} /></div>
          <div><Label>Equipment</Label><Input value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} /></div>
          <div><Label>Difficulty</Label><Input value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} /></div>
        </div>
        <div><Label>YouTube URL</Label><Input value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} /></div>
        <div><Label>Coaching cues</Label><Textarea rows={2} value={form.cues} onChange={(e) => setForm({ ...form, cues: e.target.value })} /></div>
        <div><Label>Common mistakes</Label><Textarea rows={2} value={form.common_mistakes} onChange={(e) => setForm({ ...form, common_mistakes: e.target.value })} /></div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} className="bg-gradient-primary font-bold uppercase">{busy ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}