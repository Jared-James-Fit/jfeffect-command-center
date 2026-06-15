import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMembershipLibrary, enrollLibraryPlan } from "@/lib/membership-library.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Eye, PlusCircle, Calendar, Clock, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/m/plans")({ component: PlanLibrary });

type LibraryPlan = {
  id: string;
  name: string;
  public_title: string | null;
  description: string | null;
  training_style: string | null;
  difficulty: string | null;
  weeks: number | null;
  days_per_week: number | null;
  est_minutes_per_workout: number | null;
  goal: string | null;
  featured?: boolean | null;
  allow_full_program?: boolean | null;
};

function PlanLibrary() {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const enrollFn = useServerFn(enrollLibraryPlan);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [style, setStyle] = useState<string>("");
  const [diff, setDiff] = useState<string>("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [conflictPlan, setConflictPlan] = useState<LibraryPlan | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["m-membership-library"],
    queryFn: () => fetchLibrary(),
  });
  const plans = (data?.plans ?? []) as LibraryPlan[];

  const filtered = plans.filter((p) => {
    const name = (p.public_title || p.name || "").toLowerCase();
    if (q && !name.includes(q.toLowerCase())) return false;
    if (style && p.training_style !== style) return false;
    if (diff && p.difficulty !== diff) return false;
    return true;
  });

  const addToTraining = async (plan: LibraryPlan, confirmReplace = false) => {
    setPendingId(plan.id);
    try {
      const res = await enrollFn({
        data: {
          planId: plan.id,
          startDate: null,
          trainingDays: [],
          importMode: "full",
          confirmReplace,
        },
      });
      if (res.conflict) {
        setConflictPlan(plan);
        return;
      }
      toast.success("Added to your training");
      qc.invalidateQueries({ queryKey: ["m-enrollments"] });
      qc.invalidateQueries({ queryKey: ["m-active"] });
      navigate({ to: "/m/my-plans/$enrollmentId", params: { enrollmentId: res.enrollmentId! } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add this program");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Program Library" subtitle="Browse and add programs included in your membership." />
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search programs" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="">All styles</option>
          {["powerlifting","bodybuilding","strength","hypertrophy","fat_loss","lifestyle","mobility","hybrid","custom"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={diff} onChange={(e) => setDiff(e.target.value)}>
          <option value="">Any difficulty</option>
          {["Beginner","Intermediate","Advanced","All Levels"].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading programs…</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="flex flex-col overflow-hidden p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.public_title || p.name}</div>
                  <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {p.training_style ?? "custom"} · {p.difficulty ?? "All Levels"}
                  </div>
                </div>
                {p.featured && <Badge>Featured</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {p.weeks ?? "—"}w · {p.days_per_week ?? "—"}/wk
                </span>
                {p.est_minutes_per_workout && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />{p.est_minutes_per_workout} min
                  </span>
                )}
              </div>
              {p.description && (
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
              )}
              <div className="mt-auto flex gap-2 pt-4">
                <Link to="/m/plans/$planId" params={{ planId: p.id }} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Button>
                </Link>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={pendingId === p.id || p.allow_full_program === false}
                  onClick={() => addToTraining(p)}
                  title={p.allow_full_program === false ? "Full program imports disabled" : undefined}
                >
                  {pendingId === p.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="mr-1 h-3.5 w-3.5" />
                  )}
                  Add to My Training
                </Button>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
              No programs match those filters.
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!conflictPlan} onOpenChange={(o) => !o && setConflictPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have an active plan</AlertDialogTitle>
            <AlertDialogDescription>
              Adding <strong>{conflictPlan?.public_title || conflictPlan?.name}</strong> will end your current
              plan. Past workout logs and completed workouts will be preserved. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = conflictPlan;
                setConflictPlan(null);
                if (p) void addToTraining(p, true);
              }}
            >
              Switch plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}