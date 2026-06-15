import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES = [
  "Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back",
  "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility",
  "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio",
];

export function QuickAddExerciseDialog({
  open,
  onOpenChange,
  defaultName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the name field (e.g. current search query). */
  defaultName?: string;
  /** Called with the new exercise id after a successful insert. */
  onCreated?: (id: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: defaultName ?? "",
    category: CATEGORIES[0],
    muscle_group: "",
    equipment: "",
    youtube_url: "",
    cues: "",
    common_mistakes: "",
    difficulty: "Intermediate",
    default_load_unit: "lb" as "kg" | "lb",
  });

  // Reset / prefill whenever the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setForm({
        name: defaultName ?? "",
        category: CATEGORIES[0],
        muscle_group: "",
        equipment: "",
        youtube_url: "",
        cues: "",
        common_mistakes: "",
        difficulty: "Intermediate",
        default_load_unit: "lb",
      });
    }
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("exercises")
      .insert(form)
      .select("id, name")
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Added "${data.name}" to library`);
    // Refresh both the admin list and the builder's minimal projection.
    qc.invalidateQueries({ queryKey: ["exercises"] });
    qc.invalidateQueries({ queryKey: ["exercises-min"] });
    onCreated?.(data.id, data.name);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick add exercise</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input
              autoFocus
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Muscle group</Label>
              <Input
                value={form.muscle_group}
                onChange={(e) => setForm({ ...form, muscle_group: e.target.value })}
              />
            </div>
            <div>
              <Label>Equipment</Label>
              <Input
                value={form.equipment}
                onChange={(e) => setForm({ ...form, equipment: e.target.value })}
              />
            </div>
            <div>
              <Label>Difficulty</Label>
              <Input
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Default unit</Label>
              <Select
                value={form.default_load_unit}
                onValueChange={(v) => setForm({ ...form, default_load_unit: v as "kg" | "lb" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lb">lb (pounds)</SelectItem>
                  <SelectItem value="kg">kg (kilograms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>YouTube URL</Label>
            <Input
              value={form.youtube_url}
              onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
            />
          </div>
          <div>
            <Label>Coaching cues</Label>
            <Textarea
              rows={2}
              value={form.cues}
              onChange={(e) => setForm({ ...form, cues: e.target.value })}
            />
          </div>
          <div>
            <Label>Common mistakes</Label>
            <Textarea
              rows={2}
              value={form.common_mistakes}
              onChange={(e) => setForm({ ...form, common_mistakes: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !form.name.trim()}
              className="bg-gradient-primary font-bold uppercase"
            >
              {busy ? "Saving…" : "Add to library"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}