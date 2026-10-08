import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Dumbbell, Plus, Repeat2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WorkoutAddExercise } from "@/components/workout-day/workout-add-exercise";
import { createMemberWorkout, listMyMemberWorkouts, repeatMemberWorkout } from "@/lib/member-workouts.functions";
import { todayLocalISO } from "@/lib/today";

type Pick = { exerciseId: string; name: string; sets: number; reps: string; load: string };
export const MY_WORKOUTS_KEY = ["my-member-workouts"];

/** "My workouts": build your own workout from the exercise library, log it, do it again. */
export function MyWorkoutsCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyMemberWorkouts);
  const createFn = useServerFn(createMemberWorkout);
  const repeatFn = useServerFn(repeatMemberWorkout);
  const { data } = useQuery({ queryKey: MY_WORKOUTS_KEY, queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);

  const open_ = (dayId: string, instance: string | null) =>
    navigate({ to: "/m/my-workouts/$dayId" as any, params: { dayId } as any, search: (instance ? { instance } : {}) as any });

  async function save() {
    if (!title.trim()) return toast.error("Give it a name");
    if (!picks.length) return toast.error("Add at least one exercise");
    setBusy(true);
    try {
      const res = await createFn({
        data: {
          title: title.trim(),
          date: todayLocalISO(),
          exercises: picks.map((p) => ({
            exerciseId: p.exerciseId, sets: p.sets, reps: p.reps.trim() || "8",
            loadKg: p.load.trim() ? Number(p.load) : null,
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: MY_WORKOUTS_KEY });
      setOpen(false); setTitle(""); setPicks([]);
      open_(res.dayId, res.scheduledWorkoutId);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the workout");
    } finally {
      setBusy(false);
    }
  }

  async function again(dayId: string) {
    try {
      const res = await repeatFn({ data: { dayId, date: todayLocalISO() } });
      await qc.invalidateQueries({ queryKey: MY_WORKOUTS_KEY });
      open_(res.dayId, res.scheduledWorkoutId);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start it again");
    }
  }

  const update = (i: number, patch: Partial<Pick>) => setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const workouts = data?.workouts ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">My workouts</div>
          <div className="text-sm text-muted-foreground">Build your own session. PRs count like any other workout.</div>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Build</Button>
      </div>

      {workouts.length > 0 && (
        <ul className="divide-y divide-border">
          {workouts.slice(0, 8).map((w) => (
            <li key={w.dayId} className="flex items-center justify-between gap-2 py-2">
              <button type="button" className="min-w-0 text-left" onClick={() => open_(w.dayId, w.scheduledWorkoutId)}>
                <div className="truncate text-sm font-semibold">{w.title}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {w.completedAt ? <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Done</> : "Not finished"}
                  {w.date ? ` · ${w.date}` : ""}
                </div>
              </button>
              <Button size="sm" variant="ghost" className="gap-1 shrink-0" onClick={() => again(w.dayId)}>
                <Repeat2 className="h-4 w-4" /> Again
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Build a workout</SheetTitle>
            <SheetDescription>Pick exercises from the library. You'll log sets and loads as you train.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <Input placeholder="Name (e.g. Upper A)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            {picks.map((p, i) => (
              <div key={`${p.exerciseId}-${i}`} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{p.name}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove"
                    onClick={() => setPicks((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-muted-foreground">Sets
                    <Input type="number" inputMode="numeric" min={1} max={20} value={p.sets}
                      onChange={(e) => update(i, { sets: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
                  </label>
                  <label className="text-xs text-muted-foreground">Reps
                    <Input value={p.reps} maxLength={20} onChange={(e) => update(i, { reps: e.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground">Load kg (optional)
                    <Input type="number" inputMode="decimal" min={0} value={p.load} onChange={(e) => update(i, { load: e.target.value })} />
                  </label>
                </div>
              </div>
            ))}
            <WorkoutAddExercise
              disabled={picks.length >= 20}
              onAdd={async (ex) => setPicks((ps) => [...ps, { exerciseId: ex.id, name: ex.name, sets: 3, reps: "8", load: "" }])}
            />
            <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save and start"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
