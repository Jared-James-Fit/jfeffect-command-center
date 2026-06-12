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
import { useState, useEffect, useMemo, useRef } from "react";
import { Copy, Trash2 } from "lucide-react";
import { runJob } from "@/lib/progress-jobs";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { useConflictWatch } from "@/hooks/use-conflict-watch";
import { AlertTriangle } from "lucide-react";

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
    hydratedRef.current = true;
  }, [plan]);

  // Track hydration so autosave never fires until after we've loaded the server values.
  const hydratedRef = useRef(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-member-plan", planId] });

  // Snapshot of all editable meta fields used by the manual save AND autosave.
  const metaSnapshot = useMemo(() => ({
    name, description, access, diff, style, goal, estMin, tracking, logging, featured, equip, tags,
  }), [name, description, access, diff, style, goal, estMin, tracking, logging, featured, equip, tags]);

  const buildPatch = (s: typeof metaSnapshot) => ({
    name: s.name,
    description: s.description,
    required_access_level: s.access,
    difficulty: s.diff,
    training_style: s.style,
    goal: s.goal,
    est_minutes_per_workout: s.estMin === "" ? null : Number(s.estMin),
    tracking_enabled: s.tracking,
    logging_enabled: s.logging,
    featured: s.featured,
    equipment_needed: s.equip.split(",").map((x: string) => x.trim()).filter(Boolean),
    tags: s.tags.split(",").map((x: string) => x.trim()).filter(Boolean),
  });

  const autosave = useAutosave({
    key: plan ? `member-plan:${planId}:meta` : null,
    value: metaSnapshot,
    delay: 1200,
    enabled: !!plan && hydratedRef.current,
    onSave: async (s) => {
      await update({ data: { planId, patch: buildPatch(s) } });
      refresh();
    },
  });

  // Cross-coach conflict watcher — compare the freshly fetched meta against
  // what we last successfully saved. If another coach moves a field while we
  // have an unsaved local edit, surface a warning instead of silently
  // clobbering them on the next autosave round.
  const remoteSnapshot = useMemo(
    () => plan ? {
      name: plan.name ?? "",
      description: plan.description ?? "",
      access: plan.required_access_level ?? "app_membership",
      diff: plan.difficulty ?? "All Levels",
      style: plan.training_style ?? "custom",
      goal: plan.goal ?? "",
      estMin: plan.est_minutes_per_workout != null ? String(plan.est_minutes_per_workout) : "",
      tracking: !!plan.tracking_enabled,
      logging: !!plan.logging_enabled,
      featured: !!plan.featured,
      equip: (plan.equipment_needed ?? []).join(", "),
      tags: (plan.tags ?? []).join(", "),
    } : undefined,
    [plan],
  );
  const conflictWatch = useConflictWatch({
    remote: remoteSnapshot,
    local: metaSnapshot,
    savedAt: autosave.savedAt,
  });
  const applyRemote = (s: typeof metaSnapshot) => {
    setName(s.name); setDescription(s.description); setAccess(s.access); setDiff(s.diff);
    setStyle(s.style); setGoal(s.goal); setEstMin(s.estMin); setTracking(s.tracking);
    setLogging(s.logging); setFeatured(s.featured); setEquip(s.equip); setTags(s.tags);
  };

  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const [busy, setBusy] = useState(false);

  const save = () => runJob(
    {
      title: `Saving "${name || plan.name}"`,
      description: "Member plan",
      steps: ["Validate plan", "Save changes", "Sync visibility", "Finalize"],
      successToast: "Saved",
    },
    async (job) => {
      setBusy(true);
      try {
        job.completeStep(0);
        await autosave.flush();
        await update({ data: { planId, patch: buildPatch(metaSnapshot) } });
        job.completeStep(1);
        job.completeStep(2);
        refresh();
        job.completeStep(3);
      } finally { setBusy(false); }
    },
  );

  const onPublish = () => runJob(
    {
      title: `Publishing "${plan.name}"`,
      description: "Member plan",
      steps: ["Validate content", "Save final content", "Publish to members", "Sync visibility/access", "Finalize"],
      successToast: "Plan published",
      successAction: { label: "View published plan", onClick: () => navigate({ to: "/m/plans/$planId", params: { planId } }) },
    },
    async (job) => {
      job.completeStep(0); job.completeStep(1);
      await setStatus({ data: { planId, status: "Published" } });
      job.completeStep(2); job.completeStep(3);
      refresh();
      job.completeStep(4);
    },
  );
  const onUnpublish = () => runJob(
    {
      title: `Unpublishing "${plan.name}"`,
      description: "Member plan",
      steps: ["Confirm plan", "Remove from published access", "Update visibility", "Finalize"],
      successToast: "Moved to draft",
      successAction: { label: "View plans", onClick: () => navigate({ to: "/admin/member-plans" }) },
    },
    async (job) => {
      setBusy(true);
      try {
        job.completeStep(0);
        await setStatus({ data: { planId, status: "Draft" } });
        job.completeStep(1); job.completeStep(2);
        refresh();
        job.completeStep(3);
      } finally { setBusy(false); }
    },
  );
  const onArchive = () => runJob(
    {
      title: `Archiving "${plan.name}"`,
      description: "Member plan",
      steps: ["Confirm archive", "Update status", "Remove from active lists", "Finalize"],
      successToast: "Archived",
      successAction: { label: "View plans", onClick: () => navigate({ to: "/admin/member-plans" }) },
    },
    async (job) => {
      setBusy(true);
      try {
        job.completeStep(0);
        await setStatus({ data: { planId, status: "Archived" } });
        job.completeStep(1); job.completeStep(2);
        refresh();
        job.completeStep(3);
      } finally { setBusy(false); }
    },
  );
  const onDuplicate = () => runJob<{ planId: string }>(
    {
      title: `Duplicating "${plan.name}"`,
      description: "Member plan",
      steps: ["Copy plan", "Copy sections/content", "Save duplicate", "Open duplicate"],
      successToast: "Duplicated",
    },
    async (job) => {
      setBusy(true);
      try {
        job.completeStep(0);
        const r = await dup({ data: { planId } });
        job.completeStep(1); job.completeStep(2);
        const newId = r.plan.id;
        navigate({ to: "/admin/member-plans/$planId", params: { planId: newId } });
        job.completeStep(3);
        return { planId: newId };
      } finally { setBusy(false); }
    },
  );
  const onDelete = () => {
    if (!confirm("Delete this plan? This can't be undone.")) return;
    return runJob(
      {
        title: `Deleting "${plan.name}"`,
        description: "Member plan",
        steps: ["Confirm delete", "Remove plan", "Clean related references", "Finalize"],
        successToast: "Deleted",
      },
      async (job) => {
        setBusy(true);
        try {
          job.completeStep(0);
          await del({ data: { planId } });
          job.completeStep(1); job.completeStep(2);
          navigate({ to: "/admin/member-plans" });
          job.completeStep(3);
        } finally { setBusy(false); }
      },
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        backTo="/admin/member-plans"
        backLabel="Back to Member Plans"
        breadcrumbs={[{ label: "Member Plans", to: "/admin/member-plans" }, { label: plan.name }]}
        title={plan.name}
        subtitle={`${plan.weeks} weeks · ${plan.days_per_week}/wk · ${plan.workouts_total ?? 0} workouts`}
        actions={
          <div className="flex flex-wrap gap-2">
            <span className="self-center"><SaveStatus state={autosave.state} savedAt={autosave.savedAt} /></span>
            <Badge variant={plan.status === "Published" ? "default" : "secondary"}>{plan.status}</Badge>
            {plan.status === "Published"
              ? <Button size="sm" variant="outline" disabled={busy} onClick={onUnpublish}>Move to Draft</Button>
              : <Button size="sm" disabled={busy} onClick={onPublish}>Publish</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={onDuplicate}><Copy className="mr-1 h-4 w-4" />Duplicate</Button>
            {plan.status !== "Archived" && <Button size="sm" variant="ghost" disabled={busy} onClick={onArchive}>Archive</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        }
      />
      {conflictWatch.conflict && (
        <Card className="flex flex-wrap items-start gap-3 border-amber-500/60 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-amber-700 dark:text-amber-400">This plan was updated somewhere else.</div>
            <div className="text-xs text-muted-foreground">
              Another coach (or another tab) saved changes to this plan after you started editing. Pick how to proceed:
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={conflictWatch.dismiss}>Keep mine</Button>
            <Button size="sm" variant="outline" onClick={() => { if (conflictWatch.conflict) applyRemote(conflictWatch.conflict as typeof metaSnapshot); conflictWatch.acceptRemote(); }}>Use latest saved value</Button>
            <Button size="sm" variant="ghost" onClick={conflictWatch.dismiss}>Review</Button>
          </div>
        </Card>
      )}
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
        <div><Button onClick={save} disabled={busy}>Save changes</Button></div>
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