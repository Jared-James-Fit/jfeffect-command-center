import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateTemplatePayload, type DayIssue } from "@/lib/pl-template-validation";
import {
  Plus, BookOpen, UserPlus, Eye, Pencil, Copy, Archive as ArchiveIcon,
  ArchiveRestore, Trash2, Clock, Calendar, Layers, MoreVertical, Search, Users, AlertTriangle, Share2, Inbox, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { runJob } from "@/lib/progress-jobs";
import {
  listTemplates, createTemplate, applyTemplateToClient, duplicateTemplate, updateTemplate,
  setTemplateArchived, deleteTemplate, summarizeTemplatePayload,
  getTemplateWeeks, computeEndDateFromStart,
  listTemplateAssignments,
  type TemplateType, type TrainingStyle, type TemplatePlacement,
} from "@/lib/pl-programs";
import { BLOCK_PHASE_OPTIONS } from "@/lib/pl-template-blocks";
import { supabase } from "@/integrations/supabase/client";
import { findOverlappingBlock, suggestNextStartISO } from "@/lib/block-schedule";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareProgramSheet } from "@/components/programs/share-program-sheet";
import { DestinationBadges } from "@/components/programs/destination-badges";
import { listShares, summarizeShares, type TemplateShare } from "@/lib/programs/sharing";
import { listClientMaxes, upsertClientMax, type ClientMaxRow } from "@/lib/pl-maxes";
import { notifyMissingMaxesFn } from "@/lib/missing-maxes.functions";

// Quick-pick weight class tags (admin-only). Free-form tags still supported in the input.
const WEIGHT_CLASS_TAGS: string[] = [
  "47kg", "52kg", "57kg", "59kg", "63kg", "66kg", "69kg", "74kg",
  "76kg", "83kg", "84kg", "84kg+", "93kg", "105kg", "120kg", "120kg+",
];

function tagListFromString(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function tagsStringWithToggle(s: string, tag: string): string {
  const list = tagListFromString(s);
  const i = list.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
  if (i >= 0) list.splice(i, 1); else list.push(tag);
  return list.join(", ");
}

function WeightClassPicker({
  value, onChange,
}: { value: string; onChange: (next: string) => void }) {
  const active = new Set(tagListFromString(value).map((t) => t.toLowerCase()));
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Weight class quick-pick
      </Label>
      <div className="flex flex-wrap gap-1">
        {WEIGHT_CLASS_TAGS.map((t) => {
          const on = active.has(t.toLowerCase());
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(tagsStringWithToggle(value, t))}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                on
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeightClassFilter({
  value, onChange,
}: { value: string | null; onChange: (next: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Weight class:</span>
      <button
        onClick={() => onChange(null)}
        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
          value === null
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        All
      </button>
      {WEIGHT_CLASS_TAGS.map((t) => {
        const on = value === t;
        return (
          <button
            key={t}
            onClick={() => onChange(on ? null : t)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/admin/program-library")({ component: ProgramLibraryRedirect });

function ProgramLibraryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/programming", search: { tab: "programs" } as any, replace: true });
  }, [navigate]);
  return null;
}

const TEMPLATE_TYPES: { v: TemplateType; label: string }[] = [
  { v: "full_prep", label: "Full Prep" },
  { v: "block", label: "Block" },
  { v: "week", label: "Week" },
  { v: "day", label: "Day" },
  { v: "exercise_row", label: "Exercise Row" },
];
const STYLES: { v: TrainingStyle; label: string }[] = [
  { v: "powerlifting", label: "Powerlifting" },
  { v: "bodybuilding", label: "Bodybuilding" },
  { v: "strength", label: "Strength" },
  { v: "lifestyle", label: "Lifestyle" },
  { v: "hybrid", label: "Hybrid" },
  { v: "rehab", label: "Rehab / Pivot" },
  { v: "conditioning", label: "Conditioning" },
  { v: "custom", label: "Custom" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TEMPLATE_TYPES.map((t) => [t.v, t.label]));
const STYLE_LABEL: Record<string, string> = Object.fromEntries(STYLES.map((s) => [s.v, s.label]));

type FilterChip =
  | { kind: "all" }
  | { kind: "type"; v: TemplateType }
  | { kind: "style"; v: TrainingStyle }
  | { kind: "archived" };

export function ProgramLibrary({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<FilterChip>({ kind: "all" });
  const [weightClass, setWeightClass] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [assignTpl, setAssignTpl] = useState<any | null>(null);
  const [shareTpl, setShareTpl] = useState<any | null>(null);

  const showArchived = chip.kind === "archived";
  const type = chip.kind === "type" ? chip.v : ("all" as const);
  const style = chip.kind === "style" ? chip.v : ("all" as const);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pl-templates", q, type, style, showArchived],
    queryFn: () =>
      listTemplates({
        q,
        type,
        style,
        ...(showArchived ? { includeArchived: true, onlyArchived: true } : {}),
      } as any),
  });

  const filteredTemplates = useMemo(() => {
    if (!weightClass) return templates as any[];
    const wc = weightClass.toLowerCase();
    return (templates as any[]).filter((t) =>
      (t.tags ?? []).some((tag: string) => String(tag).toLowerCase() === wc),
    );
  }, [templates, weightClass]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pl-templates"] });

  return (
    <>
      {!embedded && <PageHeader
        title="Program Library"
        subtitle="Reusable preps, blocks, weeks, days, and exercise rows"
      />}
      <div className="p-6 md:p-8 space-y-4">
        {/* Search + New */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button onClick={() => setOpenNew(true)} className="ml-auto">
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/program-submissions">
              <Inbox className="mr-2 h-4 w-4" /> Submissions
            </Link>
          </Button>
        </div>

        {/* Filter chips */}
        <FilterChips chip={chip} setChip={setChip} />
        <WeightClassFilter value={weightClass} onChange={setWeightClass} />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filteredTemplates.length === 0 ? (
          <Card className="p-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {weightClass
                ? `No templates tagged ${weightClass}.`
                : showArchived
                  ? "No archived templates."
                  : "No templates yet. Create your first reusable program."}
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((t: any) => (
              <TemplateCard
                key={t.id}
                tpl={t}
                onPreview={() => setPreviewId(t.id)}
                onAssign={() => setAssignTpl(t)}
                onShare={() => setShareTpl(t)}
                onChanged={invalidate}
              />
            ))}
          </div>
        )}
      </div>

      <NewTemplateDialog open={openNew} onOpenChange={setOpenNew} onCreated={invalidate} />
      <PreviewDialog templateId={previewId} onClose={() => setPreviewId(null)} onAssign={(tpl) => { setPreviewId(null); setAssignTpl(tpl); }} />
      <AssignDialog template={assignTpl} onClose={() => setAssignTpl(null)} />
      <ShareProgramSheet
        template={shareTpl}
        open={!!shareTpl}
        onOpenChange={(v) => !v && setShareTpl(null)}
        viewerRole="admin"
      />
    </>
  );
}

function FilterChips({ chip, setChip }: { chip: FilterChip; setChip: (c: FilterChip) => void }) {
  const Chip = ({ active, onClick, children }: any) => (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip active={chip.kind === "all"} onClick={() => setChip({ kind: "all" })}>All</Chip>
      <span className="mx-1 text-muted-foreground">·</span>
      {TEMPLATE_TYPES.map((t) => (
        <Chip key={t.v} active={chip.kind === "type" && chip.v === t.v} onClick={() => setChip({ kind: "type", v: t.v })}>
          {t.label}
        </Chip>
      ))}
      <span className="mx-1 text-muted-foreground">·</span>
      {STYLES.map((s) => (
        <Chip key={s.v} active={chip.kind === "style" && chip.v === s.v} onClick={() => setChip({ kind: "style", v: s.v })}>
          {s.label}
        </Chip>
      ))}
      <span className="mx-1 text-muted-foreground">·</span>
      <Chip active={chip.kind === "archived"} onClick={() => setChip({ kind: "archived" })}>Archived</Chip>
    </div>
  );
}

function TemplateCard({ tpl, onPreview, onAssign, onShare, onChanged }: { tpl: any; onPreview: () => void; onAssign: () => void; onShare: () => void; onChanged: () => void }) {
  const summary = useMemo(() => summarizeTemplatePayload(tpl), [tpl]);
  const updated = tpl.updated_at ? new Date(tpl.updated_at).toLocaleDateString() : "—";
  const { data: assignments = [] } = useQuery({
    queryKey: ["pl-template-assignments", tpl.id],
    queryFn: () => listTemplateAssignments(tpl.id),
  });
  const { data: shares = [] } = useQuery({
    queryKey: ["pl-template-shares", tpl.id],
    queryFn: () => listShares(tpl.id),
  });
  const shareSummary = useMemo(
    () => summarizeShares(tpl, shares as TemplateShare[]),
    [tpl, shares],
  );
  const activeAssignments = (assignments as any[]).filter((a) => !a.archived);
  const uniqueClients = Array.from(new Map(activeAssignments.map((a: any) => [a.clientId, a])).values()) as any[];
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold leading-tight">{tpl.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">Updated {updated}</div>
        </div>
        <RowMenu tpl={tpl} onChanged={onChanged} />
      </div>

      <DestinationBadges summary={shareSummary} ownerRole={tpl.owner_role} compact />

      <div className="flex flex-wrap gap-1 text-[10px]">
        <Badge variant="outline">{TYPE_LABEL[tpl.template_type] ?? tpl.template_type}</Badge>
        <Badge variant="secondary">{STYLE_LABEL[tpl.training_style] ?? tpl.training_style}</Badge>
        {tpl.training_focus && <Badge variant="outline">{tpl.training_focus}</Badge>}
        {tpl.status && tpl.status !== "Draft" && <Badge variant="outline">{tpl.status}</Badge>}
        {tpl.archived && <Badge variant="destructive">Archived</Badge>}
        {(tpl.tags || []).map((tag: string) => (
          <Badge key={tag} variant="outline" className="bg-muted/30">{tag}</Badge>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 rounded-md border border-border bg-secondary/30 px-2 py-2 text-center text-[10px]">
        <Stat label="Weeks" value={tpl.weeks ?? summary.weeks ?? "—"} icon={<Calendar className="h-3 w-3" />} />
        <Stat label="Days/wk" value={tpl.days_per_week ?? "—"} icon={<Layers className="h-3 w-3" />} />
        <Stat label="Duration" value={tpl.est_duration_min ? `${tpl.est_duration_min}m` : "—"} icon={<Clock className="h-3 w-3" />} />
        <Stat label="Rows" value={summary.rows} icon={<BookOpen className="h-3 w-3" />} />
      </div>

      {tpl.description && (
        <p className="line-clamp-2 text-xs text-foreground/80">{tpl.description}</p>
      )}
      {tpl.notes && <p className="line-clamp-2 text-xs text-muted-foreground italic">{tpl.notes}</p>}

      <AssignedToPanel templateId={tpl.id} clients={uniqueClients} />

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" className="flex-1" onClick={onPreview}>
          <Eye className="mr-1 h-3 w-3" /> Preview
        </Button>
        <Button size="sm" variant="outline" className="flex-1" asChild>
          <Link to="/admin/program-library/$templateId" params={{ templateId: tpl.id }}>
            <Pencil className="mr-1 h-3 w-3" /> Edit
          </Link>
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onShare}>
          <Share2 className="mr-1 h-3 w-3" /> Share
        </Button>
        <Button size="sm" className="flex-1" onClick={onAssign}>
          <UserPlus className="mr-1 h-3 w-3" /> Assign
        </Button>
      </div>
    </Card>
  );
}

function AssignedToPanel({ templateId: _templateId, clients }: { templateId: string; clients: any[] }) {
  const [open, setOpen] = useState(false);
  if (clients.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" /> Not assigned to anyone yet
      </div>
    );
  }
  const shown = open ? clients : clients.slice(0, 3);
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> Assigned to {clients.length}</span>
        <span className="text-[10px]">{open ? "Hide" : clients.length > 3 ? "Show all" : "Show"}</span>
      </button>
      <ul className="mt-1 space-y-0.5">
        {shown.map((c) => (
          <li key={c.clientId}>
            <Link
              to="/admin/client-programs/$clientId"
              params={{ clientId: c.clientId }}
              className="flex items-center justify-between rounded px-1 py-0.5 text-[11px] hover:bg-secondary/60"
            >
              <span className="truncate font-medium">{c.clientName ?? "Unknown client"}</span>
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{c.kind === "prep" ? "Prep" : "Block"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: any; icon?: any }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="font-bold text-foreground">{value}</div>
    </div>
  );
}

function RowMenu({ tpl, onChanged }: { tpl: any; onChanged: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const run = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => setEditOpen(true)}>
          <Settings2 className="mr-2 h-3.5 w-3.5" /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const next = window.prompt("Rename template", tpl.name ?? "");
            if (next == null) return;
            const name = next.trim();
            if (!name || name === tpl.name) return;
            run(() => updateTemplate(tpl.id, { name }), "Renamed");
          }}
        >
          <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run(() => duplicateTemplate(tpl.id), "Duplicated")}>
          <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
        </DropdownMenuItem>
        {tpl.archived ? (
          <DropdownMenuItem onClick={() => run(() => setTemplateArchived(tpl.id, false), "Restored")}>
            <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => run(() => setTemplateArchived(tpl.id, true), "Archived")}>
            <ArchiveIcon className="mr-2 h-3.5 w-3.5" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (!confirm(`Delete "${tpl.name}"? This cannot be undone.`)) return;
            run(() => deleteTemplate(tpl.id), "Deleted");
          }}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <EditTemplateDetailsDialog
      templateId={tpl.id}
      open={editOpen}
      onOpenChange={setEditOpen}
      onSaved={onChanged}
    />
    </>
  );
}

// ------- New Template dialog -------
function NewTemplateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "", template_type: "block" as TemplateType, training_style: "powerlifting" as TrainingStyle,
    training_focus: "", weeks: 4, days_per_week: 4, description: "", notes: "", tags: "",
    blocks: 1,
    blockFocuses: [""] as string[],
  });
  // Keep per-block focus array length in sync with the blocks count.
  const blockCount = Math.max(1, form.blocks || 1);
  const blockFocuses = form.blockFocuses.length === blockCount
    ? form.blockFocuses
    : Array.from({ length: blockCount }, (_, i) => form.blockFocuses[i] ?? "");
  const setBlockFocus = (i: number, v: string) => {
    const next = [...blockFocuses];
    next[i] = v;
    setForm({ ...form, blockFocuses: next });
  };
  const seedPayload = () => {
    const buildWeeksData = () =>
      Array.from({ length: Math.max(1, form.weeks) }, (_, i) => ({
        week_index: i + 1,
        days: Array.from({ length: Math.max(1, form.days_per_week) }, (_, j) => ({ day_index: j + 1, title: `Day ${j + 1}`, rows: [] })),
      }));
    const effectiveType: TemplateType =
      form.template_type === "block" && (form.blocks || 1) > 1 ? "full_prep" : form.template_type;
    switch (effectiveType) {
      case "full_prep": {
        const count = Math.max(1, form.blocks || 1);
        const blocks_data = Array.from({ length: count }, (_, i) => ({
          name: `Block ${i + 1}`,
          weeks: Math.max(1, form.weeks),
          days_per_week: Math.max(1, form.days_per_week),
          training_focus: (blockFocuses[i] || form.training_focus || "").trim() || null,
          weeks_data: buildWeeksData(),
        }));
        return { prep: { event_name: null, event_date: null }, blocks_data };
      }
      case "block": {
        return { weeks_data: buildWeeksData() };
      }
      case "week":
        return { days: Array.from({ length: Math.max(1, form.days_per_week) }, (_, j) => ({ day_index: j + 1, title: `Day ${j + 1}`, rows: [] })) };
      case "day":
        return { day_index: 1, title: "Day 1", rows: [] };
      case "exercise_row":
        return { sets: 3, reps_text: "8-12", time_profile: "accessory_compound" };
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Program Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Template type</Label>
            <div className="mt-1 grid grid-cols-5 gap-1">
              {TEMPLATE_TYPES.map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setForm({ ...form, template_type: t.v })}
                  className={`rounded-md border px-2 py-2 text-[11px] ${
                    form.template_type === t.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 4 Week Volume Block" />
          </div>
          <div>
            <Label>Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Briefly explain what this program is designed for and who it is best suited to."
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Saved on the template so coaches see what this {form.template_type === "exercise_row" ? "exercise row" : form.template_type === "full_prep" ? "full prep" : form.template_type} is for. Separate from internal Notes.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Style</Label>
              <Select value={form.training_style} onValueChange={(v) => setForm({ ...form, training_style: v as TrainingStyle })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STYLES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Focus</Label>
              <Select
                value={form.training_focus || "__none"}
                onValueChange={(v) => setForm({ ...form, training_focus: v === "__none" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="Optional focus" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(form.template_type === "block" || form.template_type === "full_prep") && (
            <>
              <div>
                <Label>Blocks</Label>
                <Input
                  type="number" inputMode="numeric" min={1}
                  value={form.blocks}
                  onChange={(e) => setForm({ ...form, blocks: Math.max(1, parseInt(e.target.value) || 1) })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {form.template_type === "full_prep"
                    ? "Seeds this many blocks (each with the weeks & days set below). You can add, rename, duplicate, or remove blocks in the editor afterwards."
                    : (form.blocks || 1) > 1
                      ? "More than 1 block — this will be saved as a Full Prep template containing this many blocks."
                      : "Single block. Increase to seed multiple blocks (auto-converts to a Full Prep)."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>{(form.template_type === "full_prep" || (form.blocks || 1) > 1) ? "Weeks/block" : "Weeks"}</Label><Input type="number" inputMode="numeric" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: parseInt(e.target.value) || 0 })} /></div>
                <div><Label>Days/week</Label><Input type="number" inputMode="numeric" value={form.days_per_week} onChange={(e) => setForm({ ...form, days_per_week: parseInt(e.target.value) || 0 })} /></div>
              </div>
              {(form.template_type === "full_prep" || (form.blocks || 1) > 1) && (
                <div className="space-y-1">
                  <Label>Per-block focus</Label>
                  <p className="text-[11px] text-muted-foreground">Label each block (e.g. Volume/Accumulation, Strength, Peak). Optional — you can edit later.</p>
                  <div className="space-y-1">
                    {blockFocuses.map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Block {i + 1}</span>
                        <Select
                          value={v || "__none"}
                          onValueChange={(val) => setBlockFocus(i, val === "__none" ? "" : val)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder={form.training_focus || "Pick a focus"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— None —</SelectItem>
                            {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="meet-prep, taper, accessories" />
          </div>
          <WeightClassPicker
            value={form.tags}
            onChange={(next) => setForm({ ...form, tags: next })}
          />
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!form.name) return toast.error("Name required");
              try {
                const tags = form.tags.split(",").map((s) => s.trim()).filter(Boolean);
                const tpl = await createTemplate({
                  name: form.name,
                  template_type:
                    form.template_type === "block" && (form.blocks || 1) > 1
                      ? "full_prep"
                      : form.template_type,
                  training_style: form.training_style,
                  training_focus: form.training_focus || undefined,
                  weeks: form.weeks || undefined, days_per_week: form.days_per_week || undefined,
                  tags, notes: form.notes || undefined,
                  description: form.description.trim() || undefined,
                  payload: seedPayload(),
                });
                toast.success("Template created — opening editor");
                onCreated();
                onOpenChange(false);
                navigate({ to: "/admin/program-library/$templateId", params: { templateId: tpl.id } });
              } catch (e: any) { toast.error(e.message); }
            }}
          >Create & edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------- Edit details dialog -------
function EditTemplateDetailsDialog({
  templateId,
  open,
  onOpenChange,
  onSaved,
}: {
  templateId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { data: tpl, isFetching } = useQuery({
    queryKey: ["pl-template-details", templateId, open],
    enabled: open && !!templateId,
    queryFn: async () =>
      (await (supabase as any).from("pl_templates").select("*").eq("id", templateId).maybeSingle()).data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<{
    name: string; description: string; training_style: TrainingStyle;
    training_focus: string; tags: string; notes: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (open && tpl && !form) {
      setForm({
        name: tpl.name ?? "",
        description: (tpl as any).description ?? "",
        training_style: (tpl.training_style as TrainingStyle) ?? "custom",
        training_focus: tpl.training_focus ?? "",
        tags: (tpl.tags ?? []).join(", "),
        notes: tpl.notes ?? "",
      });
      setBaselineUpdatedAt(tpl.updated_at ?? null);
    }
    if (!open) {
      setForm(null);
      setBaselineUpdatedAt(null);
    }
  }, [open, tpl, form]);

  const onSave = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const { data: latest } = await (supabase as any)
        .from("pl_templates").select("updated_at").eq("id", templateId).maybeSingle();
      if (latest?.updated_at && baselineUpdatedAt && latest.updated_at !== baselineUpdatedAt) {
        const proceed = confirm(
          "This template was edited elsewhere since you opened this dialog. Overwrite with your changes?",
        );
        if (!proceed) { setSaving(false); return; }
      }
      await updateTemplate(templateId, {
        name,
        description: form.description.trim() || null,
        training_style: form.training_style,
        training_focus: form.training_focus || null,
        tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
      });
      toast.success("Template details saved");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit template details</DialogTitle>
        </DialogHeader>
        {!form ? (
          <p className="text-sm text-muted-foreground">{isFetching ? "Loading…" : "Template not found."}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Briefly explain what this program is designed for and who it is best suited to."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Visible to coaches in the library / assignment preview. Clear the field to remove it.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Style</Label>
                <Select value={form.training_style} onValueChange={(v) => setForm({ ...form, training_style: v as TrainingStyle })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STYLES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Focus</Label>
                <Select
                  value={form.training_focus || "__none"}
                  onValueChange={(v) => setForm({ ...form, training_focus: v === "__none" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Optional focus" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="meet-prep, taper, accessories" />
            </div>
            <WeightClassPicker
              value={form.tags}
              onChange={(next) => setForm({ ...form, tags: next })}
            />
            <div>
              <Label>Notes <span className="font-normal text-muted-foreground">(internal — never shown to clients/members)</span></Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !form}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------- Preview dialog -------
function PreviewDialog({ templateId, onClose, onAssign }: { templateId: string | null; onClose: () => void; onAssign: (tpl: any) => void }) {
  const { data: tpl } = useQuery({
    queryKey: ["pl-template", templateId],
    enabled: !!templateId,
    queryFn: async () => (await (supabase as any).from("pl_templates").select("*").eq("id", templateId).maybeSingle()).data,
  });
  if (!templateId) return null;
  return (
    <Dialog open={!!templateId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tpl?.name ?? "Template"}</DialogTitle></DialogHeader>
        {!tpl ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {tpl.description && String(tpl.description).trim().length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground whitespace-pre-wrap">
                {tpl.description}
              </div>
            )}
            <TemplateTreeView tpl={tpl} />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {tpl && (
            <>
              <Button variant="outline" asChild>
                <Link to="/admin/program-library/$templateId" params={{ templateId: tpl.id }}>
                  <Pencil className="mr-1 h-3 w-3" /> Edit
                </Link>
              </Button>
              <Button onClick={() => onAssign(tpl)}><UserPlus className="mr-1 h-3 w-3" /> Assign</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateTreeView({ tpl }: { tpl: any }) {
  const p = tpl.payload || {};
  const type = tpl.template_type;

  const Row = ({ r }: { r: any }) => (
    <div className="border-t border-border py-1 text-[11px]">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-4 truncate font-medium">{r.exercise_name_override || r.exercise_name || "Exercise"}</div>
        <div className="col-span-1 text-center text-muted-foreground">{r.sets ?? "—"}×</div>
        <div className="col-span-2 text-center">{r.reps_text || "—"}</div>
        <div className="col-span-1 text-center text-muted-foreground">{r.rpe ? `@${r.rpe}` : r.rir ? `${r.rir} RIR` : "—"}</div>
        <div className="col-span-2 text-center text-muted-foreground">{r.percentage ? `${r.percentage}%` : r.load_kg ? `${r.load_kg}kg` : "—"}</div>
        <div className="col-span-2 text-center text-muted-foreground">{r.rest_seconds ? `${r.rest_seconds}s` : "—"}</div>
      </div>
      {(r.tempo || r.notes) && (
        <div className="mt-0.5 pl-1 text-[10px] text-muted-foreground italic">
          {r.tempo && <span>tempo {r.tempo}</span>}
          {r.tempo && r.notes && <span> · </span>}
          {r.notes && <span>{r.notes}</span>}
        </div>
      )}
    </div>
  );

  const Day = ({ d }: { d: any }) => (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <div className="text-xs font-bold">{d.title || `Day ${d.day_index}`}</div>
      {d.focus && <div className="text-[10px] text-muted-foreground">{d.focus}</div>}
      {(d.rows || []).length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">No rows</p>
      ) : (
        <div className="mt-1">{d.rows.map((r: any, i: number) => <Row key={i} r={r} />)}</div>
      )}
    </div>
  );

  const Week = ({ w }: { w: any }) => (
    <div className="space-y-2">
      <div className="text-xs font-bold text-muted-foreground">Week {w.week_index}</div>
      <div className="grid gap-2">{(w.days || []).map((d: any, i: number) => <Day key={i} d={d} />)}</div>
    </div>
  );

  if (type === "full_prep") {
    const blocks = p.blocks_data || [];
    return (
      <div className="space-y-4">
        {p.prep?.event_name && (
          <div className="rounded-md border border-border bg-secondary/20 p-2 text-xs">
            <span className="font-bold">Event:</span> {p.prep.event_name} {p.prep.event_date ? `· ${p.prep.event_date}` : ""}
          </div>
        )}
        {blocks.length === 0 ? <p className="text-sm text-muted-foreground">No blocks yet.</p> : blocks.map((b: any, i: number) => (
          <div key={i} className="rounded-md border border-border p-3">
            <div className="font-bold">{b.name || `Block ${i + 1}`}</div>
            {b.training_focus && <div className="text-[11px] text-muted-foreground">{b.training_focus}</div>}
            <div className="mt-2 space-y-3">{(b.weeks_data || []).map((w: any, j: number) => <Week key={j} w={w} />)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (type === "block") {
    return (<div className="space-y-3">{(p.weeks_data || []).map((w: any, i: number) => <Week key={i} w={w} />)}</div>);
  }
  if (type === "week") return <Week w={p} />;
  if (type === "day") return <Day d={p} />;
  return <Row r={p} />;
}

// ------- Assign dialog with placement -------
function AssignDialog({ template, onClose }: { template: any; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [clientId, setClientId] = useState<string>("");
  const [mode, setMode] = useState<string>("");
  const [prepId, setPrepId] = useState<string>("");
  const [blockId, setBlockId] = useState<string>("");
  const [weekId, setWeekId] = useState<string>("");
  const [dayId, setDayId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [visible, setVisible] = useState(true);
  const [newPrep, setNewPrep] = useState({ title: "", event_name: "", event_date: "" });
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>("");
  // Validation gate state — set when submit detects missing requirements.
  // The dialog then switches to a confirm view that lists every issue and
  // requires a second explicit "Assign anyway" click before running.
  const [pendingIssues, setPendingIssues] = useState<DayIssue[] | null>(null);
  const templateWeeks = template ? getTemplateWeeks(template) : 0;

  useEffect(() => {
    if (startDate && templateWeeks > 0) {
      setEndDate(computeEndDateFromStart(startDate, templateWeeks));
    }
  }, [startDate, templateWeeks]);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"], enabled: !!template,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("archived", false).order("full_name")).data ?? [],
  });
  const { data: preps = [] } = useQuery({
    queryKey: ["pl-preps-client", clientId], enabled: !!clientId,
    queryFn: async () => (await (supabase as any).from("pl_preps").select("*").eq("client_id", clientId).neq("status", "Archived").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: blocks = [] } = useQuery({
    queryKey: ["pl-blocks-client", clientId], enabled: !!clientId,
    queryFn: async () => (await (supabase as any).from("pl_blocks").select("*").eq("client_id", clientId).neq("status", "Archived").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: weeks = [] } = useQuery({
    queryKey: ["pl-weeks-block", blockId], enabled: !!blockId,
    queryFn: async () => (await (supabase as any).from("pl_weeks").select("*").eq("block_id", blockId).order("week_index")).data ?? [],
  });
  const { data: days = [] } = useQuery({
    queryKey: ["pl-days-week", weekId], enabled: !!weekId,
    queryFn: async () => (await (supabase as any).from("pl_days").select("*").eq("week_id", weekId).order("day_index")).data ?? [],
  });
  // Always re-fetch the template (with its full payload) so requirement
  // checks see fresh data — list rows may not have `payload` selected.
  const { data: fullTpl } = useQuery({
    queryKey: ["pl-template-assign", template?.id],
    enabled: !!template?.id,
    queryFn: async () =>
      (await (supabase as any).from("pl_templates").select("*").eq("id", template.id).maybeSingle()).data,
  });

  if (!template) return null;

  const isBlockish = template.template_type === "block" || template.template_type === "full_prep";
  const conflict = isBlockish
    ? findOverlappingBlock(blocks as any[], startDate, endDate || startDate)
    : null;
  const suggestedStart = suggestNextStartISO(blocks as any[]);
  const applySuggestion = () => {
    setStartDate(suggestedStart);
    if (templateWeeks > 0) setEndDate(computeEndDateFromStart(suggestedStart, templateWeeks));
  };

  const type = template.template_type;
  const validModes: { v: string; label: string }[] =
    type === "full_prep"
      ? [{ v: "new_prep", label: "Create new prep (with all blocks)" }]
      : type === "block"
      ? [
          { v: "standalone_block", label: "Standalone block (no prep)" },
          { v: "existing_prep", label: "Inside existing prep" },
          { v: "new_prep", label: "Inside a new prep" },
        ]
      : type === "week"
      ? [{ v: "into_block", label: "Append to existing block" }]
      : type === "day"
      ? [{ v: "into_week", label: "Append to existing week" }]
      : [{ v: "into_day", label: "Append to existing day" }];

  const effectiveMode = mode || validModes[0].v;

  const submit = async () => {
    if (!clientId) return toast.error("Pick a client");
    if (conflict) {
      return toast.error(
        `Overlaps with "${conflict.name ?? "another block"}" (${conflict.start_date ?? "?"} – ${conflict.end_date ?? "?"}). Use the suggested start date.`,
      );
    }
    // Requirement check: every day needs an exercise + sets + reps. If any
    // gaps exist, switch to a confirm view that lists each missing item.
    const tplForCheck = fullTpl ?? template;
    const issues = validateTemplatePayload(tplForCheck);
    if (issues.length > 0) {
      setPendingIssues(issues);
      return;
    }
    await runAssignment();
  };

  const runAssignment = async () => {
    if (!clientId) return toast.error("Pick a client");
    let placement: TemplatePlacement;
    try {
      switch (effectiveMode) {
        case "standalone_block":
          placement = { mode: "standalone_block" }; break;
        case "existing_prep":
          if (!prepId) return toast.error("Pick a prep");
          placement = { mode: "existing_prep", prepId }; break;
        case "new_prep":
          placement = { mode: "new_prep", prep: { title: newPrep.title || undefined, event_name: newPrep.event_name || null, event_date: newPrep.event_date || null } }; break;
        case "into_block":
          if (!blockId) return toast.error("Pick a block");
          placement = { mode: "into_block", blockId }; break;
        case "into_week":
          if (!weekId) return toast.error("Pick a week");
          placement = { mode: "into_week", weekId }; break;
        case "into_day":
          if (!dayId) return toast.error("Pick a day");
          placement = { mode: "into_day", dayId }; break;
        default:
          placement = { mode: "standalone_block" };
      }
      const clientName = (clients as any[]).find((c) => c.id === clientId)?.full_name ?? "client";
      await runJob(
        {
          title: `Assigning "${template.name}"`,
          description: `To ${clientName}`,
          steps: ["Validate library", "Prepare assignment", "Assign workouts", "Sync access", "Finalize"],
          successToast: "Template assigned",
        },
        async (job) => {
          job.completeStep(0);
          job.completeStep(1);
          await applyTemplateToClient({ templateId: template.id, clientId, placement, name: name || undefined, clientVisible: visible, startDate: startDate || null, endDate: endDate || null });
          job.completeStep(2);
          qc.invalidateQueries({ queryKey: ["pl-template-assignments", template.id] });
          qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
          qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
          qc.invalidateQueries({ queryKey: ["assigned-preps", clientId] });
          qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
          qc.invalidateQueries({ queryKey: ["my-workouts"] });
          job.completeStep(3);
          setPendingIssues(null);
          onClose();
          navigate({ to: "/admin/client-programs/$clientId", params: { clientId } });
          job.completeStep(4);
        },
      );
    } catch (e: any) {
      // runJob already toasts on error; only catch pre-runJob throws
      if (e?.message) toast.error(e.message);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {pendingIssues ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Missing requirements
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-semibold">"{template.name}"</span> has{" "}
                {pendingIssues.length} day{pendingIssues.length === 1 ? "" : "s"} with missing
                requirements. The client will see incomplete workouts if you continue.
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <ul className="space-y-2">
                  {pendingIssues.map((d, i) => (
                    <li key={i}>
                      <div className="font-semibold text-amber-700 dark:text-amber-200">{d.location}</div>
                      <ul className="mt-0.5 list-disc pl-4 space-y-0.5 text-muted-foreground">
                        {d.missing.map((m, j) => <li key={j}>{m}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                You can go back and fix them, or assign anyway — for example if you'll edit the
                client's copy directly after.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingIssues(null)}>Go back &amp; fix</Button>
              <Button
                variant="destructive"
                onClick={() => { setPendingIssues(null); runAssignment(); }}
              >
                Assign anyway
              </Button>
            </DialogFooter>
          </>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Assign "{template.name}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Client</Label>
            <Select value={clientId} onValueChange={(v) => { setClientId(v); setPrepId(""); setBlockId(""); setWeekId(""); setDayId(""); }}>
              <SelectTrigger><SelectValue placeholder="Choose client…" /></SelectTrigger>
              <SelectContent>{(clients as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {clientId && (
            <>
              <div>
                <Label>Placement</Label>
                <Select value={effectiveMode} onValueChange={setMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{validModes.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {effectiveMode === "existing_prep" && (
                <div>
                  <Label>Prep</Label>
                  <Select value={prepId} onValueChange={setPrepId}>
                    <SelectTrigger><SelectValue placeholder={(preps as any[]).length ? "Choose prep…" : "No preps for client"} /></SelectTrigger>
                    <SelectContent>{(preps as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.title} {p.event_date ? `· ${p.event_date}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {effectiveMode === "new_prep" && (
                <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3">
                  <div><Label>Prep title</Label><Input value={newPrep.title} onChange={(e) => setNewPrep({ ...newPrep, title: e.target.value })} placeholder="e.g. Provincials Prep" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Event name</Label><Input value={newPrep.event_name} onChange={(e) => setNewPrep({ ...newPrep, event_name: e.target.value })} /></div>
                    <div><Label>Event date</Label><Input type="date" value={newPrep.event_date} onChange={(e) => setNewPrep({ ...newPrep, event_date: e.target.value })} /></div>
                  </div>
                </div>
              )}

              {effectiveMode === "into_block" && (
                <div>
                  <Label>Block</Label>
                  <Select value={blockId} onValueChange={setBlockId}>
                    <SelectTrigger><SelectValue placeholder={(blocks as any[]).length ? "Choose block…" : "No blocks for client"} /></SelectTrigger>
                    <SelectContent>{(blocks as any[]).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {effectiveMode === "into_week" && (
                <>
                  <div>
                    <Label>Block</Label>
                    <Select value={blockId} onValueChange={(v) => { setBlockId(v); setWeekId(""); }}>
                      <SelectTrigger><SelectValue placeholder="Choose block…" /></SelectTrigger>
                      <SelectContent>{(blocks as any[]).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {blockId && (
                    <div>
                      <Label>Week</Label>
                      <Select value={weekId} onValueChange={setWeekId}>
                        <SelectTrigger><SelectValue placeholder="Choose week…" /></SelectTrigger>
                        <SelectContent>{(weeks as any[]).map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              {effectiveMode === "into_day" && (
                <>
                  <div>
                    <Label>Block</Label>
                    <Select value={blockId} onValueChange={(v) => { setBlockId(v); setWeekId(""); setDayId(""); }}>
                      <SelectTrigger><SelectValue placeholder="Choose block…" /></SelectTrigger>
                      <SelectContent>{(blocks as any[]).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {blockId && (
                    <div>
                      <Label>Week</Label>
                      <Select value={weekId} onValueChange={(v) => { setWeekId(v); setDayId(""); }}>
                        <SelectTrigger><SelectValue placeholder="Choose week…" /></SelectTrigger>
                        <SelectContent>{(weeks as any[]).map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {weekId && (
                    <div>
                      <Label>Day</Label>
                      <Select value={dayId} onValueChange={setDayId}>
                        <SelectTrigger><SelectValue placeholder="Choose day…" /></SelectTrigger>
                        <SelectContent>{(days as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.title || `Day ${d.day_index}`}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              {(type === "block" || type === "full_prep") && (
                <div>
                  <Label>Override name (optional)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={template.name} />
                </div>
              )}

              {(type === "block" || type === "full_prep") && (
                <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/30 p-3">
                  <div>
                    <Label className="text-xs">Start date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">End date (optional)</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
              )}

              {isBlockish && conflict && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold">Schedule conflict</div>
                      <div>
                        Overlaps with <span className="font-semibold">{conflict.name ?? "an existing block"}</span>
                        {conflict.start_date && conflict.end_date ? ` (${conflict.start_date} – ${conflict.end_date})` : ""}.
                      </div>
                      <button type="button" onClick={applySuggestion} className="mt-1 underline underline-offset-2 hover:no-underline">
                        Use suggested start: {suggestedStart}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {isBlockish && !conflict && suggestedStart !== startDate && (blocks as any[]).some((b: any) => b.end_date) && (
                <button
                  type="button"
                  onClick={applySuggestion}
                  className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50"
                >
                  Next free start after current blocks: {suggestedStart} · click to use
                </button>
              )}

              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
                <Label className="text-xs">Visible to client</Label>
                <Switch checked={visible} onCheckedChange={setVisible} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!!conflict}>Assign to client</Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}