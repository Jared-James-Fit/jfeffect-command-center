import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { updateMemberPlan, setPlanStatus, duplicateMemberPlan, deleteMemberPlan } from "@/lib/member-plans.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { Copy, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/member-plans/$planId")({ component: MemberPlanEditor });

function MemberPlanEditor() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const update = useServerFn(updateMemberPlan);
  const setStatus = useServerFn(setPlanStatus);
  const dup = useServerFn(duplicateMemberPlan);
  const del = useServerFn(deleteMemberPlan);

  const { data: plan } = useQuery({
    queryKey: ["admin-member-plan", planId],
    queryFn: async () => (await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle()).data as any,
  });
  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels"],
    queryFn: async () => (await supabase.from("access_levels").select("*").order("sort_order")).data ?? [],
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState("");
  const [diff, setDiff] = useState("");
  const [style, setStyle] = useState("");
  const [goal, setGoal] = useState("");
  const [estMin, setEstMin] = useState<string>("");
  const [tracking, setTracking] = useState(true);
  const [logging, setLogging] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [equip, setEquip] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!plan) return;
    setName(plan.name ?? "");
    setDescription(plan.description ?? "");
    setAccess(plan.required_access_level ?? "app_membership");
    setDiff(plan.difficulty ?? "All Levels");
    setStyle(plan.training_style ?? "custom");
    setGoal(plan.goal ?? "");
    setEstMin(plan.est_minutes_per_workout != null ? String(plan.est_minutes_per_workout) : "");
    setTracking(!!plan.tracking_enabled);
    setLogging(!!plan.logging_enabled);
    setFeatured(!!plan.featured);
    setEquip((plan.equipment_needed ?? []).join(", "));
    setTags((plan.tags ?? []).join(", "));
  }, [plan]);

  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-member-plan", planId] });

  const save = async () => {
    try {
      await update({ data: { planId, patch: {
        name, description, required_access_level: access, difficulty: diff, training_style: style, goal,
        est_minutes_per_workout: estMin === "" ? null : Number(estMin),
        tracking_enabled: tracking, logging_enabled: logging, featured,
        equipment_needed: equip.split(",").map((s) => s.trim()).filter(Boolean),
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      } } });
      toast.success("Saved"); refresh();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };

  const onPublish = async () => { await setStatus({ data: { planId, status: "Published" } }); toast.success("Published"); refresh(); };
  const onUnpublish = async () => { await setStatus({ data: { planId, status: "Draft" } }); toast.success("Moved to draft"); refresh(); };
  const onArchive = async () => { await setStatus({ data: { planId, status: "Archived" } }); toast.success("Archived"); refresh(); };
  const onDuplicate = async () => { const r = await dup({ data: { planId } }); toast.success("Duplicated"); navigate({ to: "/admin/member-plans/$planId", params: { planId: r.plan.id } }); };
  const onDelete = async () => { if (!confirm("Delete this plan? This can't be undone.")) return; await del({ data: { planId } }); toast.success("Deleted"); navigate({ to: "/admin/member-plans" }); };

  return (
    <div className="space-y-5">
      <PageHeader
        title={plan.name}
        subtitle={`${plan.weeks} weeks · ${plan.days_per_week}/wk · ${plan.workouts_total ?? 0} workouts`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={plan.status === "Published" ? "default" : "secondary"}>{plan.status}</Badge>
            {plan.status === "Published"
              ? <Button size="sm" variant="outline" onClick={onUnpublish}>Move to Draft</Button>
              : <Button size="sm" onClick={onPublish}>Publish</Button>}
            <Button size="sm" variant="outline" onClick={onDuplicate}><Copy className="mr-1 h-4 w-4" />Duplicate</Button>
            {plan.status !== "Archived" && <Button size="sm" variant="ghost" onClick={onArchive}>Archive</Button>}
            <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        }
      />
      <Card className="space-y-4 p-5">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Required access</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={access} onChange={(e) => setAccess(e.target.value)}>
              {(levels as any[]).map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Difficulty</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={diff} onChange={(e) => setDiff(e.target.value)}>
              {["Beginner","Intermediate","Advanced","All Levels"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <Label>Training style</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
              {["powerlifting","bodybuilding","strength","hypertrophy","fat_loss","lifestyle","mobility","hybrid","custom"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Goal</Label><Input value={goal} onChange={(e) => setGoal(e.target.value)} /></div>
          <div><Label>Est. minutes / workout</Label><Input type="number" value={estMin} onChange={(e) => setEstMin(e.target.value)} /></div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={featured} onCheckedChange={setFeatured} /><Label>Featured</Label>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Equipment (comma-separated)</Label><Input value={equip} onChange={(e) => setEquip(e.target.value)} /></div>
          <div><Label>Tags (comma-separated)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2"><Switch checked={tracking} onCheckedChange={setTracking} />Tracking enabled</label>
          <label className="flex items-center gap-2"><Switch checked={logging} onCheckedChange={setLogging} />Set logging enabled</label>
        </div>
        <div><Button onClick={save}>Save changes</Button></div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Plan content (frozen snapshot)</div>
        <div className="text-sm text-muted-foreground">
          This plan was {plan.source_template_id ? "published from a coaching template" : plan.source_block_id ? "published from a coaching block" : "created blank"}. The structure below is what members see.
        </div>
        <div className="space-y-2">
          {(plan.published_payload?.weeks_data ?? []).map((w: any) => (
            <div key={w.week_index} className="rounded-md border p-3">
              <div className="text-sm font-semibold">Week {w.week_index}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(w.days ?? []).map((d: any) => (
                  <div key={d.day_index} className="rounded border bg-muted/30 p-2 text-sm">
                    <div className="font-medium">{d.title || `Day ${d.day_index}`}</div>
                    <div className="text-xs text-muted-foreground">{(d.rows?.length ?? 0)} exercises</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}