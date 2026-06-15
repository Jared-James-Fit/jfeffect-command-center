import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import {
  getLinkedLibraryPlan, upsertLibraryListing, publishLibraryListing,
  unpublishLibraryListing, getListingAnalytics,
} from "@/lib/membership-library.functions";

type Template = {
  id: string; name: string; payload_revision: number;
  notes?: string | null; training_style?: string | null;
  weeks?: number | null; days_per_week?: number | null;
  tags?: string[] | null;
};

const DIFFICULTIES = ["Beginner","Intermediate","Advanced","All Levels"] as const;

export function MembershipPublishDrawer({
  template, open, onOpenChange,
}: { template: Template; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const fetchLinked = useServerFn(getLinkedLibraryPlan);
  const upsert      = useServerFn(upsertLibraryListing);
  const publish     = useServerFn(publishLibraryListing);
  const unpublish   = useServerFn(unpublishLibraryListing);
  const fetchStats  = useServerFn(getListingAnalytics);

  const { data: linked, refetch } = useQuery({
    queryKey: ["library-linked", template.id],
    queryFn: () => fetchLinked({ data: { templateId: template.id } }),
    enabled: open,
  });

  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels-list"],
    queryFn: async () => (await supabase.from("access_levels").select("key,label").order("sort_order")).data ?? [],
    enabled: open,
  });

  const plan = linked?.plan as any | null;
  const planId = plan?.id ?? null;

  const [form, setForm] = useState({
    name: "", public_title: "", description: "", cover_image_url: "",
    difficulty: "All Levels", goal: "", training_style: "custom",
    tags: "", equipment_needed: "",
    required_access_level: "app_membership",
    audience_mode: "access_level",
    allow_full_program: true, allow_partial_imports: false, allow_pdf_download: true,
    notify_on_publish: false, change_notes: "",
    est_minutes_per_workout: "",
  });

  useEffect(() => {
    if (!open) return;
    if (plan) {
      setForm({
        name: plan.name ?? template.name,
        public_title: plan.public_title ?? "",
        description: plan.description ?? template.notes ?? "",
        cover_image_url: plan.cover_image_url ?? "",
        difficulty: plan.difficulty ?? "All Levels",
        goal: plan.goal ?? "",
        training_style: plan.training_style ?? template.training_style ?? "custom",
        tags: (plan.tags ?? []).join(", "),
        equipment_needed: (plan.equipment_needed ?? []).join(", "),
        required_access_level: plan.required_access_level ?? "app_membership",
        audience_mode: plan.audience_mode ?? "access_level",
        allow_full_program: plan.allow_full_program ?? true,
        allow_partial_imports: plan.allow_partial_imports ?? false,
        allow_pdf_download: plan.allow_pdf_download ?? true,
        notify_on_publish: plan.notify_on_publish ?? false,
        change_notes: plan.change_notes ?? "",
        est_minutes_per_workout: plan.est_minutes_per_workout ? String(plan.est_minutes_per_workout) : "",
      });
    } else {
      setForm((f) => ({
        ...f,
        name: template.name,
        description: template.notes ?? "",
        training_style: template.training_style ?? "custom",
        tags: (template.tags ?? []).join(", "),
      }));
    }
  }, [open, plan?.id, template.id]);

  const { data: stats } = useQuery({
    queryKey: ["library-stats", planId],
    queryFn: () => fetchStats({ data: { planId: planId! } }),
    enabled: !!planId && open,
  });

  const isPublished = plan?.status === "Published";
  const hasUpdate = isPublished && plan && template.payload_revision != null
    && plan.last_published_version != null
    && template.payload_revision > plan.last_published_version;

  const invalidate = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["pl-templates"] });
  };

  const buildMetadata = () => ({
    name: form.name.trim() || template.name,
    public_title: form.public_title.trim() || null,
    description: form.description.trim() || null,
    cover_image_url: form.cover_image_url.trim() || null,
    difficulty: form.difficulty as any,
    goal: form.goal.trim() || null,
    training_style: form.training_style.trim() || "custom",
    tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
    equipment_needed: form.equipment_needed.split(",").map((s) => s.trim()).filter(Boolean),
    required_access_level: form.required_access_level,
    audience_mode: form.audience_mode as any,
    eligible_plan_ids: [] as string[],
    allow_full_program: form.allow_full_program,
    allow_partial_imports: form.allow_partial_imports,
    allow_pdf_download: form.allow_pdf_download,
    notify_on_publish: form.notify_on_publish,
    change_notes: form.change_notes.trim() || null,
    est_minutes_per_workout: form.est_minutes_per_workout ? Number(form.est_minutes_per_workout) : null,
  });

  const saveOnly = async () => {
    try {
      const res = await upsert({ data: { templateId: template.id, planId, metadata: buildMetadata() } });
      toast.success("Listing saved");
      invalidate();
      return res.planId;
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); return null; }
  };

  const handlePublish = async (isUpdate = false) => {
    const id = await saveOnly();
    if (!id) return;
    try {
      await publish({ data: { planId: id, isUpdate } });
      toast.success(isUpdate ? "Update published" : "Published to Membership Library");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Publish failed"); }
  };

  const handleUnpublish = async () => {
    if (!planId) return;
    if (!confirm("Unpublish this program?\n\nNew browsing, imports, and downloads will be blocked. Members who already added it keep their copy and workout history.")) return;
    try {
      await unpublish({ data: { planId, reason: null } });
      toast.success("Unpublished from Membership Library");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Unpublish failed"); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Membership Library — Publish</SheetTitle>
          <SheetDescription className="line-clamp-1">{template.name}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isPublished
            ? <Badge>Published v{plan.published_version ?? 1}</Badge>
            : plan?.membership_status === "unpublished"
              ? <Badge variant="secondary">Unpublished</Badge>
              : plan ? <Badge variant="outline">Draft</Badge> : <Badge variant="outline">Not Published</Badge>}
          {hasUpdate && <Badge variant="secondary">Update Available (template v{template.payload_revision})</Badge>}
          {planId && (
            <a
              href={`/m/plans/${planId}?preview=admin`}
              target="_blank" rel="noreferrer"
              className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
            >Preview as member ↗</a>
          )}
        </div>

        {stats && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Imports" value={stats.imports_count} />
            <Stat label="Previews" value={stats.previews_count} />
            <Stat label="PDF downloads" value={stats.pdf_downloads_count} />
          </div>
        )}

        <Separator className="my-4" />

        <div className="space-y-4">
          <Field label="Public title">
            <Input value={form.public_title} onChange={(e) => setForm({ ...form, public_title: e.target.value })} placeholder={form.name} />
          </Field>
          <Field label="Internal name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Cover image URL">
            <Input value={form.cover_image_url} onChange={(e) => setForm({ ...form, cover_image_url: e.target.value })} placeholder="https://…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Difficulty">
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Goal">
              <Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="hypertrophy, strength…" />
            </Field>
            <Field label="Training style">
              <Input value={form.training_style} onChange={(e) => setForm({ ...form, training_style: e.target.value })} />
            </Field>
            <Field label="Minutes / workout">
              <Input type="number" value={form.est_minutes_per_workout} onChange={(e) => setForm({ ...form, est_minutes_per_workout: e.target.value })} />
            </Field>
          </div>

          <Field label="Category tags (comma separated)">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="powerlifting, fat loss…" />
          </Field>
          <Field label="Required equipment (comma separated)">
            <Input value={form.equipment_needed} onChange={(e) => setForm({ ...form, equipment_needed: e.target.value })} placeholder="barbell, dumbbells…" />
          </Field>

          <Separator />

          <div className="space-y-2">
            <Label>Who can see this program?</Label>
            <div className="flex gap-3 text-sm">
              <RadioOpt name="aud" value="all_active" current={form.audience_mode} onChange={(v) => setForm({ ...form, audience_mode: v })} label="All active members" />
              <RadioOpt name="aud" value="access_level" current={form.audience_mode} onChange={(v) => setForm({ ...form, audience_mode: v })} label="By access level" />
            </div>
            {form.audience_mode === "access_level" && (
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.required_access_level}
                onChange={(e) => setForm({ ...form, required_access_level: e.target.value })}>
                {(levels as any[]).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>What members can add</Label>
            <ToggleRow label="Add full program" checked={form.allow_full_program} onChange={(v) => setForm({ ...form, allow_full_program: v })} />
            <ToggleRow label="Add individual blocks / weeks / days" checked={form.allow_partial_imports} onChange={(v) => setForm({ ...form, allow_partial_imports: v })} />
            <ToggleRow label="Allow PDF download" checked={form.allow_pdf_download} onChange={(v) => setForm({ ...form, allow_pdf_download: v })} />
          </div>

          <Separator />

          <ToggleRow label="Notify eligible members when published" checked={form.notify_on_publish} onChange={(v) => setForm({ ...form, notify_on_publish: v })} />

          <Field label="Version notes (shown in audit log)">
            <Textarea rows={2} value={form.change_notes} onChange={(e) => setForm({ ...form, change_notes: e.target.value })} placeholder="What changed in this version?" />
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={saveOnly}>Save settings</Button>
          {!isPublished && <Button size="sm" onClick={() => handlePublish(false)}>Publish to Library</Button>}
          {isPublished && hasUpdate && <Button size="sm" onClick={() => handlePublish(true)}>Publish update (v{(plan.published_version ?? 1) + 1})</Button>}
          {isPublished && <Button variant="destructive" size="sm" onClick={handleUnpublish}>Unpublish</Button>}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Published copies are pinned to the version members imported. Publishing an update never overwrites their workout logs.
        </p>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-secondary/20 px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
function RadioOpt({ name, value, current, onChange, label }: { name: string; value: string; current: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-secondary/20 p-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}