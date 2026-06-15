import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, AlertTriangle, CheckCircle2, Inbox, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { getMyNutritionStatusFn, submitNutritionUpdateFn } from "@/lib/nutrition-updates.functions";
import { listFormsForClient, pickNutritionUpdateForm } from "@/lib/native-forms";
import { usePortalUserId } from "@/lib/client-impersonation";

export function NutritionUpdatePanel() {
  const qc = useQueryClient();
  const getStatus = useServerFn(getMyNutritionStatusFn);
  const submit = useServerFn(submitNutritionUpdateFn);
  const { data, isLoading } = useQuery({ queryKey: ["my-nutrition-status"], queryFn: () => getStatus() });

  // Look up the client's "Nutrition Update Request" Fillout form so the
  // CTA can deep-link straight into the in-app embedded form view at
  // /portal/check-ins/$formId — same surface used for weekly check-ins.
  const portalUserId = usePortalUserId();
  const { data: meClient } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients").select("id").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });
  const { data: myForms = [] } = useQuery({
    queryKey: ["nf-forms-for-client", meClient?.id],
    enabled: !!meClient?.id,
    queryFn: () => listFormsForClient(meClient!.id),
  });
  const nutritionForm = pickNutritionUpdateForm(myForms as any);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    current_bodyweight: "", avg_bodyweight: "", bodyweight_unit: "lb",
    compliance_pct: "", hunger_rating: 3, energy_rating: 3, digestion_rating: 3, sleep_rating: 3, training_performance_rating: 3,
    steps_completed: "", cardio_completed: "", missed_meals: "", notes: "", goal_direction: "maintaining",
    progress_photo_urls: [] as string[],
  });
  const [uploading, setUploading] = useState(false);

  const m = useMutation({
    mutationFn: (v: any) => submit({ data: v }),
    onSuccess: () => {
      toast.success("Update submitted — your coach has been notified");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["my-nutrition-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Submission failed"),
  });

  if (isLoading || !data?.client) return null;

  const target = data.target as any;
  const openSub = data.openSubmission as any;
  const lastPub = data.lastPublished as any;
  const ts: string = target?.tracking_status || "up_to_date";

  const isSubmitted = !!openSub;
  const isUpdated = !!lastPub && (!target?.last_updated_date || new Date(lastPub.published_at) > new Date(target.last_updated_date + "T00:00:00") || true);

  const STATUS: Record<string, { icon: any; label: string; tone: string; sub: string }> = {
    up_to_date: { icon: CheckCircle2, label: "Up to date", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", sub: "Nothing to do right now." },
    due_soon: { icon: Clock, label: "Due soon", tone: "border-amber-500/40 bg-amber-500/10 text-amber-300", sub: "Your next update is coming up." },
    due_today: { icon: Clock, label: "Due today", tone: "border-amber-500/50 bg-amber-500/15 text-amber-300", sub: "Submit your update today." },
    overdue: { icon: AlertTriangle, label: "Overdue", tone: "border-red-500/50 bg-red-500/10 text-red-300", sub: "Please submit your update." },
    submitted: { icon: Inbox, label: "Submitted — waiting for coach", tone: "border-blue-500/40 bg-blue-500/10 text-blue-300", sub: "Your coach will review and reply." },
    under_review: { icon: Inbox, label: "Under review", tone: "border-blue-500/40 bg-blue-500/10 text-blue-300", sub: "Coach is working on it." },
    published: { icon: Sparkles, label: "Updated — review your new plan", tone: "border-violet-500/40 bg-violet-500/10 text-violet-300", sub: "Your targets were just updated." },
    paused: { icon: Clock, label: "Tracking paused", tone: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300", sub: "" },
    not_needed: { icon: CheckCircle2, label: "Not needed right now", tone: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300", sub: "" },
  };
  const s = STATUS[ts] ?? STATUS.up_to_date;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const urls: string[] = [];
      for (const f of files) {
        const path = `${uid}/${Date.now()}-${f.name.replace(/[^a-z0-9.]/gi, "_")}`;
        const { error } = await supabase.storage.from("nutrition-submissions").upload(path, f, { upsert: false });
        if (error) throw error;
        const { data: signed } = await supabase.storage.from("nutrition-submissions").createSignedUrl(path, 60 * 60 * 24 * 30);
        if (signed?.signedUrl) urls.push(signed.signedUrl);
      }
      setForm((f: any) => ({ ...f, progress_photo_urls: [...f.progress_photo_urls, ...urls] }));
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally { setUploading(false); }
  }

  function onSubmit() {
    m.mutate({
      current_bodyweight: num(form.current_bodyweight),
      avg_bodyweight: num(form.avg_bodyweight),
      bodyweight_unit: form.bodyweight_unit,
      compliance_pct: numInt(form.compliance_pct),
      hunger_rating: Number(form.hunger_rating),
      energy_rating: Number(form.energy_rating),
      digestion_rating: Number(form.digestion_rating),
      sleep_rating: Number(form.sleep_rating),
      training_performance_rating: Number(form.training_performance_rating),
      steps_completed: numInt(form.steps_completed),
      cardio_completed: form.cardio_completed || null,
      missed_meals: form.missed_meals || null,
      notes: form.notes || null,
      goal_direction: form.goal_direction,
      progress_photo_urls: form.progress_photo_urls,
    });
  }

  return (
    <>
      <Card className={`border ${s.tone} p-4 md:p-5`}>
        <div className="flex items-start gap-3">
          <s.icon className="h-6 w-6 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black text-lg">{s.label}</h2>
              {target?.next_due_date ? <Badge variant="outline" className="text-[10px]">Next: {new Date(target.next_due_date + "T00:00:00").toLocaleDateString()}</Badge> : null}
              {target?.last_updated_date ? <Badge variant="outline" className="text-[10px]">Last: {new Date(target.last_updated_date + "T00:00:00").toLocaleDateString()}</Badge> : null}
              {target?.update_cadence && target.update_cadence !== "manual" ? <Badge variant="outline" className="text-[10px] capitalize">{target.update_cadence}</Badge> : null}
            </div>
            {s.sub ? <p className="text-sm mt-1 opacity-80">{s.sub}</p> : null}
          </div>
          {nutritionForm ? (
            <Button asChild size="lg" className="font-black bg-gradient-primary hidden sm:inline-flex" disabled={isSubmitted}>
              <Link to="/portal/check-ins/$formId" params={{ formId: nutritionForm.id }}>
                {isSubmitted ? "Waiting…" : "Submit Update"}
              </Link>
            </Button>
          ) : (
            <Button size="lg" className="font-black bg-gradient-primary hidden sm:inline-flex" disabled={isSubmitted} onClick={() => setOpen(true)}>
              {isSubmitted ? "Waiting…" : "Submit Update"}
            </Button>
          )}
        </div>
        {nutritionForm ? (
          <Button asChild size="lg" className="font-black bg-gradient-primary w-full mt-3 sm:hidden" disabled={isSubmitted}>
            <Link to="/portal/check-ins/$formId" params={{ formId: nutritionForm.id }}>
              {isSubmitted ? "Waiting on coach…" : "Submit Nutrition Update"}
            </Link>
          </Button>
        ) : (
          <Button size="lg" className="font-black bg-gradient-primary w-full mt-3 sm:hidden" disabled={isSubmitted} onClick={() => setOpen(true)}>
            {isSubmitted ? "Waiting on coach…" : "Submit Nutrition Update"}
          </Button>
        )}
        {ts === "published" && lastPub?.coach_note ? (
          <div className="mt-3 rounded border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
            <div className="text-[10px] uppercase opacity-70 mb-1">Coach note</div>
            <p className="whitespace-pre-wrap">{lastPub.coach_note}</p>
          </div>
        ) : null}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nutrition Update</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Current bodyweight"><div className="flex gap-1"><Input type="number" step="0.1" value={form.current_bodyweight} onChange={(e) => setForm({ ...form, current_bodyweight: e.target.value })} /><Select value={form.bodyweight_unit} onValueChange={(v) => setForm({ ...form, bodyweight_unit: v })}><SelectTrigger className="w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lb">lb</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent></Select></div></FormField>
              <FormField label="7-day avg"><Input type="number" step="0.1" value={form.avg_bodyweight} onChange={(e) => setForm({ ...form, avg_bodyweight: e.target.value })} /></FormField>
            </div>
            <FormField label="Compliance % (0-100)"><Input type="number" min={0} max={100} value={form.compliance_pct} onChange={(e) => setForm({ ...form, compliance_pct: e.target.value })} /></FormField>
            <div className="grid grid-cols-5 gap-2">
              {(["hunger","energy","digestion","sleep","training_performance"] as const).map((k) => (
                <FormField key={k} label={k.replace("_"," ").replace("performance","perf")}>
                  <Select value={String(form[`${k}_rating`])} onValueChange={(v) => setForm({ ...form, [`${k}_rating`]: Number(v) })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Steps"><Input type="number" value={form.steps_completed} onChange={(e) => setForm({ ...form, steps_completed: e.target.value })} /></FormField>
              <FormField label="Cardio done"><Input value={form.cardio_completed} onChange={(e) => setForm({ ...form, cardio_completed: e.target.value })} placeholder="e.g. 3 x 30min" /></FormField>
            </div>
            <FormField label="Goal direction">
              <Select value={form.goal_direction} onValueChange={(v) => setForm({ ...form, goal_direction: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="losing">Losing</SelectItem>
                  <SelectItem value="maintaining">Maintaining</SelectItem>
                  <SelectItem value="gaining">Gaining</SelectItem>
                  <SelectItem value="unsure">Unsure</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Any missed meals?"><Textarea rows={2} value={form.missed_meals} onChange={(e) => setForm({ ...form, missed_meals: e.target.value })} /></FormField>
            <FormField label="Notes for coach"><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
            <FormField label="Progress photos (optional)">
              <div className="space-y-2">
                <label className="flex items-center justify-center gap-2 rounded border border-dashed p-3 cursor-pointer hover:bg-muted/30 text-sm">
                  <Upload className="h-4 w-4" />{uploading ? "Uploading…" : "Add photos"}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
                {form.progress_photo_urls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {form.progress_photo_urls.map((u: string, i: number) => (
                      <div key={i} className="relative aspect-square">
                        <img src={u} alt={`Photo ${i + 1}`} className="rounded object-cover w-full h-full" />
                        <button type="button" onClick={() => setForm((f: any) => ({ ...f, progress_photo_urls: f.progress_photo_urls.filter((_: any, x: number) => x !== i) }))} className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5">
                          <X className="h-3 w-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="font-bold" disabled={m.isPending} onClick={onSubmit}>{m.isPending ? "Submitting…" : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs capitalize">{label}</Label>{children}</div>;
}
function num(v: any) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function numInt(v: any) { const n = num(v); return n == null ? null : Math.round(n); }