import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createMemberPlan, publishFromTemplate } from "@/lib/member-plans.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/member-plans/new")({ component: NewPlan });

function NewPlan() {
  const navigate = useNavigate();
  const createBlank = useServerFn(createMemberPlan);
  const publishT = useServerFn(publishFromTemplate);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [days, setDays] = useState(3);
  const [style, setStyle] = useState("custom");
  const [diff, setDiff] = useState<"Beginner"|"Intermediate"|"Advanced"|"All Levels">("All Levels");
  const [access, setAccess] = useState("app_membership");

  const { data: templates = [] } = useQuery({
    queryKey: ["pl-templates"],
    queryFn: async () => (await supabase.from("pl_templates").select("id,name,training_style,weeks,days_per_week").eq("archived", false).order("name")).data ?? [],
  });
  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels"],
    queryFn: async () => (await supabase.from("access_levels").select("*").order("sort_order")).data ?? [],
  });

  const onBlank = async () => {
    try {
      const res = await createBlank({ data: { name, description, weeks, days_per_week: days, training_style: style, difficulty: diff, required_access_level: access, equipment_needed: [], tags: [] } });
      toast.success("Plan created"); navigate({ to: "/admin/member-plans/$planId", params: { planId: res.plan.id } });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const onPublish = async (templateId: string) => {
    try {
      const res = await publishT({ data: { templateId, overrides: { required_access_level: access } } });
      toast.success("Plan created from template"); navigate({ to: "/admin/member-plans/$planId", params: { planId: res.plan.id } });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="New Member Plan" subtitle="Start blank or publish from an existing coaching template." />

      <Card className="space-y-3 p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Default access level for new plans</div>
        <select className="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm" value={access} onChange={(e) => setAccess(e.target.value)}>
          {(levels as any[]).map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
        </select>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Publish from coaching template</div>
        <div className="divide-y rounded-md border">
          {(templates as any[]).length === 0 && <div className="p-3 text-sm text-muted-foreground">No templates yet.</div>}
          {(templates as any[]).map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.training_style} · {t.weeks}w/{t.days_per_week}d</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onPublish(t.id)}>Publish as plan</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Create blank plan</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>Weeks</Label><Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value)||1)} /></div>
          <div><Label>Days per week</Label><Input type="number" min={1} max={7} value={days} onChange={(e) => setDays(Number(e.target.value)||1)} /></div>
          <div>
            <Label>Training style</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
              {["powerlifting","bodybuilding","strength","hypertrophy","fat_loss","lifestyle","mobility","hybrid","custom"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label>Difficulty</Label>
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={diff} onChange={(e) => setDiff(e.target.value as any)}>
              {["Beginner","Intermediate","Advanced","All Levels"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onBlank} disabled={!name}>Create blank plan</Button>
          <Link to="/admin/member-plans"><Button variant="ghost">Cancel</Button></Link>
        </div>
      </Card>
    </div>
  );
}