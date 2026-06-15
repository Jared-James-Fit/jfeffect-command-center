import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Minus, Plus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { getSubmissionDetailFn, publishNutritionReviewFn } from "@/lib/nutrition-updates.functions";

export const Route = createFileRoute("/_authenticated/admin/nutrition-dashboard/review/$submissionId")({
  component: ReviewPage,
});

type DayRow = { day_label: string; calories: number | null; protein: number | null; carbs: number | null; fats: number | null; fibre?: number | null; notes?: string | null; };

function ReviewPage() {
  const { submissionId } = Route.useParams();
  const navigate = useNavigate();
  const get = useServerFn(getSubmissionDetailFn);
  const pub = useServerFn(publishNutritionReviewFn);

  const { data, isLoading } = useQuery({
    queryKey: ["nutrition-submission", submissionId],
    queryFn: () => get({ data: { submissionId } }),
  });

  const [days, setDays] = useState<DayRow[]>([]);
  const [cardio, setCardio] = useState("");
  const [steps, setSteps] = useState("");
  const [phase, setPhase] = useState("");
  const [coachNote, setCoachNote] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);

  useEffect(() => {
    if (!data?.currentTarget) return;
    const existingDays = (data.currentTarget as any).nutrition_target_days as any[] ?? [];
    setDays(existingDays.length
      ? existingDays.sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((d) => ({
          day_label: d.day_label, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, fibre: d.fibre, notes: d.notes,
        }))
      : [{ day_label: "Daily", calories: null, protein: null, carbs: null, fats: null }]);
    setPhase((data.currentTarget as any).custom_phase || (data.currentTarget as any).phase || "");
  }, [data?.currentTarget]);

  const sub = data?.submission as any;
  const client = data?.client as any;
  const previousDays = ((data?.currentTarget as any)?.nutrition_target_days ?? []) as any[];

  const publishM = useMutation({
    mutationFn: () => pub({ data: {
      submissionId,
      days: days.map((d) => ({ ...d, calories: numOrNull(d.calories), protein: numOrNull(d.protein), carbs: numOrNull(d.carbs), fats: numOrNull(d.fats), fibre: numOrNull(d.fibre) })),
      cardio_target: cardio || null,
      step_target: steps || null,
      phase: phase || null,
      coach_note: coachNote || null,
      notify_email: notifyEmail,
      notify_sms: notifySms,
    } }),
    onSuccess: () => { toast.success("Nutrition update published"); navigate({ to: "/admin/nutrition-dashboard" }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to publish"),
  });

  function adjustAll(field: "calories" | "protein" | "carbs" | "fats", delta: number) {
    setDays((ds) => ds.map((d) => ({ ...d, [field]: Math.max(0, (Number(d[field]) || 0) + delta) })));
  }

  function addDay() {
    setDays((ds) => [...ds, { day_label: "Training", calories: ds[0]?.calories ?? null, protein: ds[0]?.protein ?? null, carbs: ds[0]?.carbs ?? null, fats: ds[0]?.fats ?? null }]);
  }

  if (isLoading || !sub) {
    return <div className="p-6"><PageHeader title="Loading…" /></div>;
  }

  return (
    <>
      <PageHeader
        title={`Review · ${client?.full_name ?? "Client"}`}
        subtitle={`Submitted ${new Date(sub.submitted_at).toLocaleString()}`}
        actions={<Button variant="outline" size="sm" asChild><Link to="/admin/nutrition-dashboard"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>}
      />
      <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24">

        {/* Previous + weight trend */}
        <Card className="p-4 space-y-3">
          <div className="text-xs uppercase text-muted-foreground font-bold">Previous Targets</div>
          {previousDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous targets.</p>
          ) : previousDays.map((d, i) => (
            <div key={i} className="rounded border p-2 text-sm">
              <div className="font-bold">{d.day_label}</div>
              <div className="text-muted-foreground">{d.calories ?? "—"} kcal · P{d.protein ?? "-"} C{d.carbs ?? "-"} F{d.fats ?? "-"}</div>
            </div>
          ))}
          {data?.weightHistory && data.weightHistory.length > 0 ? (
            <div className="pt-3 border-t">
              <div className="text-xs uppercase text-muted-foreground font-bold flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Weight Trend</div>
              <div className="mt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                {data.weightHistory.slice(-10).reverse().map((w: any, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted-foreground">{new Date(w.recorded_at).toLocaleDateString()}</span>
                    <span className="font-mono">{w.weight} {w.weight_unit || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {/* Client submission */}
        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase text-muted-foreground font-bold">Client Submission</div>
          <Field label="Current bodyweight" v={sub.current_bodyweight ? `${sub.current_bodyweight} ${sub.bodyweight_unit}` : "—"} />
          <Field label="7-day avg" v={sub.avg_bodyweight ? `${sub.avg_bodyweight} ${sub.bodyweight_unit}` : "—"} />
          <Field label="Compliance" v={sub.compliance_pct != null ? `${sub.compliance_pct}%` : "—"} />
          <Field label="Goal direction" v={sub.goal_direction || "—"} />
          <div className="grid grid-cols-5 gap-1 pt-2">
            <Rating label="Hunger" v={sub.hunger_rating} />
            <Rating label="Energy" v={sub.energy_rating} />
            <Rating label="Digest" v={sub.digestion_rating} />
            <Rating label="Sleep" v={sub.sleep_rating} />
            <Rating label="Train" v={sub.training_performance_rating} />
          </div>
          <Field label="Steps" v={sub.steps_completed ?? "—"} />
          <Field label="Cardio" v={sub.cardio_completed || "—"} />
          <Field label="Missed meals" v={sub.missed_meals || "—"} />
          {sub.notes ? (
            <div className="pt-2 border-t">
              <div className="text-[10px] uppercase text-muted-foreground">Notes</div>
              <p className="text-sm whitespace-pre-wrap">{sub.notes}</p>
            </div>
          ) : null}
          {sub.progress_photo_urls?.length ? (
            <div className="pt-2 border-t">
              <div className="text-[10px] uppercase text-muted-foreground">Photos</div>
              <div className="grid grid-cols-3 gap-1 mt-1">
                {sub.progress_photo_urls.map((u: string, i: number) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Progress ${i + 1}`} className="rounded border object-cover aspect-square" /></a>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {/* Coach decision panel */}
        <Card className="p-4 space-y-3 lg:col-span-1">
          <div className="text-xs uppercase text-muted-foreground font-bold">Coach Decision</div>

          <div>
            <Label className="text-xs">Phase</Label>
            <Input value={phase} onChange={(e) => setPhase(e.target.value)} placeholder="Cut / Bulk / Maintenance / Performance / Lifestyle" />
          </div>

          <div className="flex flex-wrap gap-1">
            <QuickBtn label="Cal −100" onClick={() => adjustAll("calories", -100)} />
            <QuickBtn label="Cal +100" onClick={() => adjustAll("calories", 100)} />
            <QuickBtn label="P +10" onClick={() => adjustAll("protein", 10)} />
            <QuickBtn label="C −20" onClick={() => adjustAll("carbs", -20)} />
            <QuickBtn label="C +20" onClick={() => adjustAll("carbs", 20)} />
            <QuickBtn label="F −5" onClick={() => adjustAll("fats", -5)} />
            <QuickBtn label="F +5" onClick={() => adjustAll("fats", 5)} />
          </div>

          <div className="space-y-2">
            {days.map((d, i) => (
              <div key={i} className="rounded border p-2 space-y-1">
                <div className="flex items-center gap-1">
                  <Input value={d.day_label} onChange={(e) => updateDay(setDays, i, "day_label", e.target.value)} className="h-7 text-xs flex-1" />
                  {days.length > 1 ? <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDays(ds => ds.filter((_, x) => x !== i))}><Minus className="h-3 w-3" /></Button> : null}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <NumInput label="Cal" v={d.calories} on={(n) => updateDay(setDays, i, "calories", n)} />
                  <NumInput label="P" v={d.protein} on={(n) => updateDay(setDays, i, "protein", n)} />
                  <NumInput label="C" v={d.carbs} on={(n) => updateDay(setDays, i, "carbs", n)} />
                  <NumInput label="F" v={d.fats} on={(n) => updateDay(setDays, i, "fats", n)} />
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addDay}><Plus className="h-3 w-3 mr-1" />Add day</Button>
          </div>

          <div>
            <Label className="text-xs">Cardio target</Label>
            <Input value={cardio} onChange={(e) => setCardio(e.target.value)} placeholder="e.g. 3x 30 min LISS" />
          </div>
          <div>
            <Label className="text-xs">Step target</Label>
            <Input value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="e.g. 10,000/day" />
          </div>
          <div>
            <Label className="text-xs">Coach note to client</Label>
            <Textarea rows={3} value={coachNote} onChange={(e) => setCoachNote(e.target.value)} placeholder="What changed and why…" />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1"><Switch checked={notifyEmail} onCheckedChange={setNotifyEmail} /> Email</label>
            <label className="flex items-center gap-1"><Switch checked={notifySms} onCheckedChange={setNotifySms} /> SMS</label>
          </div>

          <Button className="w-full font-bold bg-gradient-primary" disabled={publishM.isPending} onClick={() => publishM.mutate()}>
            {publishM.isPending ? "Publishing…" : "Publish Nutrition Update"}
          </Button>
        </Card>
      </div>
    </>
  );
}

function numOrNull(v: any) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function updateDay(setDays: any, i: number, field: string, value: any) {
  setDays((ds: any[]) => ds.map((d, x) => x === i ? { ...d, [field]: field === "day_label" ? value : numOrNull(value) } : d));
}
function Field({ label, v }: { label: string; v: any }) { return <div className="text-sm flex justify-between border-b py-1"><span className="text-muted-foreground">{label}</span><span className="font-medium">{v}</span></div>; }
function Rating({ label, v }: { label: string; v: number | null }) {
  return <div className="text-center"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="font-bold">{v ?? "—"}{v != null ? "/5" : ""}</div></div>;
}
function NumInput({ label, v, on }: { label: string; v: number | null; on: (v: any) => void }) {
  return <div><div className="text-[10px] uppercase text-muted-foreground">{label}</div><Input className="h-7 text-xs" type="number" value={v ?? ""} onChange={(e) => on(e.target.value)} /></div>;
}
function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClick}>{label}</Button>;
}