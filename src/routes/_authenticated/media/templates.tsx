import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MediaHeader } from "@/components/media/media-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Copy, Edit, Archive, ArrowRightCircle, Megaphone, FileText,
} from "lucide-react";
import {
  listTemplates, createTemplate, patchTemplate, duplicateTemplate,
  archiveTemplate, convertTemplateToDraft, TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS, type Template, type TemplateCategory,
} from "@/lib/media-templates";

export const Route = createFileRoute("/_authenticated/media/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editing, setEditing] = useState<Template | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["media-templates", archived],
    queryFn: () => listTemplates({ archived }),
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return (data ?? []).filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (!q) return true;
      return t.title.toLowerCase().includes(q) || (t.body ?? "").toLowerCase().includes(q);
    });
  }, [data, filter, category]);

  const grouped = useMemo(() => {
    const m = new Map<string, Template[]>();
    for (const t of filtered) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return m;
  }, [filtered]);

  async function onNew() {
    const t = await createTemplate({
      category: (category !== "all" ? category : "caption_templates") as TemplateCategory,
      title: "Untitled template",
    });
    qc.invalidateQueries({ queryKey: ["media-templates"] });
    setEditing(t);
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Templates & Brand Kit"
        description="Reusable templates, brand colours, voice, and CTAs. No graphic editor — copy and paste only."
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New Template
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search templates…" className="h-9 w-64" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {TEMPLATE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{TEMPLATE_CATEGORY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={archived ? "default" : "outline"} size="sm" onClick={() => setArchived((v) => !v)}>
          <Archive className="mr-1 h-4 w-4" /> {archived ? "Archived" : "Active"}
        </Button>
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No templates yet. Save approved hooks, captions, brand colours and CTAs so the team can reuse them.
        </Card>
      )}

      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {TEMPLATE_CATEGORY_LABELS[cat as TemplateCategory] ?? cat}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={() => setEditing(t)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <TemplateDialog template={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TemplateCard({ template, onEdit }: { template: Template; onEdit: () => void }) {
  const qc = useQueryClient();
  const meta = template.metadata ?? {};

  async function copy() {
    const text = template.body ?? meta.value ?? template.title;
    await navigator.clipboard.writeText(String(text ?? ""));
    toast.success("Copied");
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{template.title}</div>
          {template.attached_campaign && (
            <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Megaphone className="h-3 w-3" /> {template.attached_campaign}
            </div>
          )}
        </div>
        {template.category === "brand_colours" && meta.hex && (
          <div
            className="h-8 w-8 shrink-0 rounded border"
            style={{ background: String(meta.hex) }}
            title={String(meta.hex)}
          />
        )}
      </div>
      {template.body && (
        <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{template.body}</p>
      )}
      {template.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={copy}><Copy className="mr-1 h-3 w-3" /> Copy</Button>
        <Button size="sm" variant="outline" onClick={async () => {
          await duplicateTemplate(template.id);
          qc.invalidateQueries({ queryKey: ["media-templates"] });
          toast.success("Duplicated");
        }}><Copy className="mr-1 h-3 w-3" /> Duplicate</Button>
        <Button size="sm" variant="outline" onClick={onEdit}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
        <Button size="sm" variant="outline" onClick={async () => {
          await convertTemplateToDraft(template.id);
          toast.success("Converted to draft");
        }}><ArrowRightCircle className="mr-1 h-3 w-3" /> To Draft</Button>
        <Button size="sm" variant="ghost" onClick={async () => {
          await archiveTemplate(template.id, !template.is_archived);
          qc.invalidateQueries({ queryKey: ["media-templates"] });
        }}><Archive className="h-3 w-3" /></Button>
      </div>
    </Card>
  );
}

function TemplateDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const [t, setT] = useState<Template>(template);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Template>(k: K, v: Template[K]) { setT((c) => ({ ...c, [k]: v })); }
  function setMeta(k: string, v: any) { setT((c) => ({ ...c, metadata: { ...(c.metadata ?? {}), [k]: v } })); }

  const showColour = t.category === "brand_colours";
  const showLink = t.category === "logos" || t.category === "font_references";

  async function save() {
    setSaving(true);
    try {
      const { id, created_at, updated_at, created_by, ...patch } = t;
      await patchTemplate(id, patch as any);
      qc.invalidateQueries({ queryKey: ["media-templates"] });
      toast.success("Saved");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Title"><Input value={t.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Category">
            <Select value={t.category as string} onValueChange={(v) => set("category", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{TEMPLATE_CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {showColour && (
            <Field label="Hex colour">
              <Input
                value={t.metadata?.hex ?? ""}
                onChange={(e) => setMeta("hex", e.target.value)}
                placeholder="#0F172A"
              />
            </Field>
          )}
          {showLink && (
            <Field label="Asset URL">
              <Input
                value={t.metadata?.url ?? ""}
                onChange={(e) => setMeta("url", e.target.value)}
                placeholder="https://…"
              />
            </Field>
          )}
          <Field label="Body / content">
            <Textarea rows={8} value={t.body ?? ""} onChange={(e) => set("body", e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)">
            <Input
              value={(t.tags ?? []).join(", ")}
              onChange={(e) => set("tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
          <Field label="Attached campaign">
            <Input value={t.attached_campaign ?? ""} onChange={(e) => set("attached_campaign", e.target.value)} />
          </Field>
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