import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus, Upload, Archive, Trash2, ArrowRightCircle, ShieldCheck,
} from "lucide-react";
import {
  listTestimonials, createTestimonial, patchTestimonial, deleteTestimonial,
  archiveTestimonial, uploadTestimonialMedia, convertTestimonialToContent,
  TESTIMONIAL_TYPES, TESTIMONIAL_TYPE_LABELS, PERMISSION_STATUSES, PERMISSION_LABELS,
  VISIBILITY_OPTIONS, type Testimonial,
} from "@/lib/media-testimonials";

export const Route = createFileRoute("/_authenticated/media/testimonials")({
  component: TestimonialsPage,
});

function TestimonialsPage() {
  const qc = useQueryClient();
  const { open: openContent } = useContentDrawer();
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const [permission, setPermission] = useState<string>("all");
  const [editing, setEditing] = useState<Testimonial | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["media-testimonials", archived],
    queryFn: () => listTestimonials({ archived }),
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return (data ?? []).filter((t) => {
      if (permission !== "all" && t.permission_status !== permission) return false;
      if (!q) return true;
      return (
        t.client_name.toLowerCase().includes(q) ||
        (t.headline ?? "").toLowerCase().includes(q) ||
        (t.quote ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, filter, permission]);

  async function onAdd() {
    const t = await createTestimonial({ client_name: "New testimonial" });
    qc.invalidateQueries({ queryKey: ["media-testimonials"] });
    setEditing(t);
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Testimonials"
        description="Client wins, transformations, and social proof — track permission before marketing."
        actions={
          <Button size="sm" onClick={onAdd}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Testimonial
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search testimonials…" className="h-9 w-64" />
        <Select value={permission} onValueChange={setPermission}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All permissions</SelectItem>
            {PERMISSION_STATUSES.map((p) => (
              <SelectItem key={p} value={p}>{PERMISSION_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={archived ? "default" : "outline"}
          size="sm"
          onClick={() => setArchived((v) => !v)}
        >
          <Archive className="mr-1 h-4 w-4" /> {archived ? "Archived" : "Active"}
        </Button>
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">No testimonials.</Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((t) => (
          <Card key={t.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{t.client_name}</div>
                {t.headline && <div className="truncate text-xs text-muted-foreground">{t.headline}</div>}
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {TESTIMONIAL_TYPE_LABELS[t.testimonial_type as keyof typeof TESTIMONIAL_TYPE_LABELS] ?? t.testimonial_type}
              </Badge>
            </div>
            {t.quote && <p className="line-clamp-3 text-xs text-muted-foreground">"{t.quote}"</p>}
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              <PermissionBadge status={t.permission_status as any} />
              <Badge variant="outline">{t.visibility}</Badge>
              {t.media_resource_ids?.length > 0 && (
                <Badge variant="outline">{t.media_resource_ids.length} media</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
              {t.permission_status !== "approved" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await patchTestimonial(t.id, { permission_status: "approved" } as any);
                    qc.invalidateQueries({ queryKey: ["media-testimonials"] });
                  }}
                >
                  <ShieldCheck className="mr-1 h-3 w-3" /> Approve for Marketing
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (t.permission_status !== "approved") {
                    if (!confirm("This testimonial isn't marketing-approved yet. Convert anyway?")) return;
                  }
                  const id = await convertTestimonialToContent(t.id);
                  toast.success("Converted to content");
                  openContent(id);
                }}
              >
                <ArrowRightCircle className="mr-1 h-3 w-3" /> Convert
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await archiveTestimonial(t.id, !t.is_archived);
                  qc.invalidateQueries({ queryKey: ["media-testimonials"] });
                }}
              >
                <Archive className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={async () => {
                  if (!confirm("Delete this testimonial permanently?")) return;
                  await deleteTestimonial(t.id);
                  qc.invalidateQueries({ queryKey: ["media-testimonials"] });
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <TestimonialDialog
          testimonial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PermissionBadge({ status }: { status: keyof typeof PERMISSION_LABELS }) {
  const variant = status === "approved" ? "default"
    : status === "declined" || status === "restricted" ? "destructive"
    : "secondary";
  return <Badge variant={variant}>{PERMISSION_LABELS[status] ?? status}</Badge>;
}

function TestimonialDialog({ testimonial, onClose }: { testimonial: Testimonial; onClose: () => void }) {
  const qc = useQueryClient();
  const [t, setT] = useState<Testimonial>(testimonial);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Testimonial>(k: K, v: Testimonial[K]) { setT((c) => ({ ...c, [k]: v })); }

  async function save() {
    setSaving(true);
    try {
      const { id, created_at, updated_at, created_by, ...patch } = t;
      await patchTestimonial(id, patch as any);
      qc.invalidateQueries({ queryKey: ["media-testimonials"] });
      toast.success("Saved");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await uploadTestimonialMedia(t.id, f);
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["media-testimonials"] });
      // refresh local count
      setT((c) => ({ ...c, media_resource_ids: [...(c.media_resource_ids ?? []), "new"] }));
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit testimonial</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Client name">
              <Input value={t.client_name} onChange={(e) => set("client_name", e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={t.testimonial_type as string} onValueChange={(v) => set("testimonial_type", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TESTIMONIAL_TYPES.map((x) => (
                    <SelectItem key={x} value={x}>{TESTIMONIAL_TYPE_LABELS[x]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Headline">
              <Input value={t.headline ?? ""} onChange={(e) => set("headline", e.target.value)} />
            </Field>
            <Field label="Source">
              <Input value={t.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="DM, email, form…" />
            </Field>
          </div>
          <Field label="Quote">
            <Textarea rows={3} value={t.quote ?? ""} onChange={(e) => set("quote", e.target.value)} />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Result">
              <Input value={t.result ?? ""} onChange={(e) => set("result", e.target.value)} />
            </Field>
            <Field label="Before">
              <Input value={t.before_measurement ?? ""} onChange={(e) => set("before_measurement", e.target.value)} />
            </Field>
            <Field label="After">
              <Input value={t.after_measurement ?? ""} onChange={(e) => set("after_measurement", e.target.value)} />
            </Field>
            <Field label="Timeframe">
              <Input value={t.timeframe ?? ""} onChange={(e) => set("timeframe", e.target.value)} placeholder="12 weeks" />
            </Field>
            <Field label="Date received">
              <Input type="date" value={t.date_received ?? ""} onChange={(e) => set("date_received", e.target.value || null)} />
            </Field>
            <Field label="Campaign">
              <Input value={t.campaign ?? ""} onChange={(e) => set("campaign", e.target.value)} />
            </Field>
            <Field label="Connected page">
              <Input value={t.connected_page ?? ""} onChange={(e) => set("connected_page", e.target.value)} placeholder="/coaching" />
            </Field>
            <Field label="Permission">
              <Select value={t.permission_status as string} onValueChange={(v) => set("permission_status", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERMISSION_STATUSES.map((p) => (
                    <SelectItem key={p} value={p}>{PERMISSION_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Visibility">
              <Select value={t.visibility} onValueChange={(v) => set("visibility", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Tags (comma separated)">
            <Input
              value={(t.tags ?? []).join(", ")}
              onChange={(e) => set("tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
          <Field label="Notes (private)">
            <Textarea rows={2} value={t.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Media files <span className="text-muted-foreground font-normal">({t.media_resource_ids?.length ?? 0})</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1.5 h-4 w-4" /> Upload
              </Button>
              <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,video/*,audio/*" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Uploaded media is stored privately. Files are only shown when permission is approved.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}