import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveCommittedSchedule } from "@/lib/schedule-bulk.functions";
import { invalidateScheduleQueries } from "@/lib/schedule-invalidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { validateTemplatePayload, type DayIssue } from "@/lib/pl-template-validation";
import {
  Plus, BookOpen, UserPlus, Eye, Pencil, Copy, Archive as ArchiveIcon, ArchiveRestore, Trash2,
  MoreHorizontal, Search, Users, AlertTriangle, Smartphone, Settings2, X as XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { runJob } from "@/lib/progress-jobs";
import {
  listTemplates, createTemplate, applyTemplateToClient, duplicateTemplate, updateTemplate,
  setTemplateArchived, deleteTemplate, summarizeTemplatePayload,
  getTemplateWeeks, computeEndDateFromStart,
  type TrainingStyle, type TemplatePlacement,
} from "@/lib/pl-programs";
import { BLOCK_PHASE_OPTIONS, normalizeTemplatePayload, getActiveTemplateBlocks } from "@/lib/pl-template-blocks";
import { AvailabilityGuardDialog } from "@/components/program-planner/AvailabilityGuardDialog";
import {
  evaluateAvailabilityGuard, frequencyFromTemplateBlocks, resolveClientAvailability,
  GUARD_WEEKDAY_LABEL,
} from "@/lib/program-availability-guard";
import type { Weekday } from "@/lib/program-planner/types";
import { supabase } from "@/integrations/supabase/client";
import { findOverlappingBlock, suggestNextStartISO } from "@/lib/block-schedule";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgramStatusBadge } from "@/components/programs/program-status-badge";
import { MembershipListingSheet, type MembershipTemplate } from "@/components/programs/membership-listing-sheet";
import { unpublishLibraryListing } from "@/lib/membership-library.functions";
import { listClientMaxes, upsertClientMax, type ClientMaxRow } from "@/lib/pl-maxes";
import { notifyMissingMaxesFn } from "@/lib/missing-maxes.functions";
import { todayLocalISO } from "@/lib/today";
import { useClientWeightUnit } from "@/hooks/use-client-weight-unit";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  LIBRARY_SCOPES, clientsLabel, emptyLibraryCopy, inScope, libraryCategorySections, matchesSearch, membershipByTemplate,
  scopeCounts, toLibraryPrograms, usageByTemplate, visibleScopes,
  type LibraryProgram, type LibraryScope, type ListingRow, type UsageBlock,
} from "@/lib/programs/library-view";

/**
 * Old addresses (/admin/program-library) land on Programming → Programs;
 * `?new=1` (the palette's Create Program) opens New program there.
 */
export function ProgramLibraryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const isNew = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
    navigate({ to: "/admin/programming", search: { tab: "programs", ...(isNew ? { new: 1 } : {}) } as any, replace: true });
  }, [navigate]);
  return null;
}

const STYLES: { v: TrainingStyle; label: string }[] = [
  { v: "powerlifting", label: "Powerlifting" },
  { v: "bodybuilding", label: "Bodybuilding" },
  { v: "strength", label: "Strength" },
  { v: "hybrid", label: "Powerbuilding / hybrid" },
  { v: "lifestyle", label: "General fitness" },
  { v: "conditioning", label: "Conditioning" },
  { v: "rehab", label: "Rehab / pivot" },
  { v: "custom", label: "Other" },
];

/** Every client block made from a library program, read whole (the usage line on each row). */
async function loadLibraryUsage(): Promise<UsageBlock[]> {
  const out: UsageBlock[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase as any)
      .from("pl_blocks")
      .select("id, source_template_id, client_id, end_date, archived, clients:clients(first_name, full_name, archived, status)")
      .not("source_template_id", "is", null)
      .eq("archived", false)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const b of (data ?? []) as any[]) {
      out.push({
        source_template_id: b.source_template_id,
        client_id: b.client_id,
        end_date: b.end_date,
        archived: b.archived,
        client_name: b.clients?.first_name || b.clients?.full_name || null,
        client_archived: !!b.clients?.archived,
        client_status: b.clients?.status ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function loadListings(): Promise<ListingRow[]> {
  const { data, error } = await (supabase as any)
    .from("member_plans")
    .select("id, source_template_id, status, membership_status, last_published_version")
    .not("source_template_id", "is", null);
  if (error) throw error;
  return (data ?? []) as ListingRow[];
}

export function ProgramLibrary({
  embedded: _embedded = false,
  initialAudience = "all",
  openNew = false,
}: {
  embedded?: boolean;
  initialAudience?: "all" | "membership";
  /** opens New program on arrival (the palette's Create Program) */
  openNew?: boolean;
} = {}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<LibraryScope>(initialAudience === "membership" ? "membership" : "all");
  const [newOpen, setNewOpen] = useState(openNew);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [assignTpl, setAssignTpl] = useState<any | null>(null);
  const [membershipTpl, setMembershipTpl] = useState<MembershipTemplate | null>(null);

  useEffect(() => { if (openNew) setNewOpen(true); }, [openNew]);
  useEffect(() => { setScope(initialAudience === "membership" ? "membership" : "all"); }, [initialAudience]);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pl-templates", "library"],
    queryFn: () => listTemplates({ includeArchived: true } as any),
  });
  const { data: usageRows = [] } = useQuery({
    queryKey: ["admin-library-usage"],
    queryFn: loadLibraryUsage,
    staleTime: 60_000,
  });
  const { data: listings = [] } = useQuery({
    queryKey: ["admin-library-membership"],
    queryFn: loadListings,
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const byId = useMemo(() => new Map((templates as any[]).map((t) => [t.id as string, t])), [templates]);
  const programs = useMemo(() => {
    const revisions = new Map((templates as any[]).map((t) => [t.id as string, (t.payload_revision ?? null) as number | null]));
    return toLibraryPrograms(
      templates as any[],
      usageByTemplate(usageRows, todayLocalISO()),
      membershipByTemplate(isAdmin ? listings : [], revisions),
      (id) => {
        const s = summarizeTemplatePayload(byId.get(id));
        return { weeks: s.weeks, blocks: s.blocks };
      },
    );
  }, [templates, usageRows, listings, isAdmin, byId]);

  const counts = useMemo(() => scopeCounts(programs), [programs]);
  const chips = visibleScopes(counts, scope, isAdmin);
  const shown = programs.filter((p) => inScope(p, scope) && matchesSearch(p, q));
  const empty = emptyLibraryCopy(scope, q.trim().length > 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pl-templates"] });
    qc.invalidateQueries({ queryKey: ["admin-library-membership"] });
  };

  return (
    <>
      <div className="mx-auto w-full max-w-5xl space-y-3 p-3 sm:p-4 md:p-6" data-program-library>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search programs"
              className="h-11 pl-9 pr-9 text-base"
              aria-label="Search programs"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button className="h-11 shrink-0 px-3.5" onClick={() => setNewOpen(true)} data-new-program>
            <Plus className="mr-1 h-4 w-4" />
            New<span className="max-sm:hidden">&nbsp;program</span>
          </Button>
        </div>

        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0" role="tablist" aria-label="Show">
          {chips.map((key) => {
            const label = LIBRARY_SCOPES.find((s) => s.key === key)!.label;
            const on = scope === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setScope(key)}
                data-library-scope={key}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition",
                  on ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/80",
                )}
              >
                {label}
                <span className={cn("tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>{counts[key]}</span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="h-[76px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center" data-library-empty>
            {scope === "membership" ? (
              <Smartphone className="mx-auto h-8 w-8 text-muted-foreground" />
            ) : (
              <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            )}
            <div className="mt-3 text-[15px] font-semibold">{empty.title}</div>
            {empty.body && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{empty.body}</p>}
            {scope === "all" && !q && (
              <Button className="mt-4" onClick={() => setNewOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> New program
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {(scope === "all" && !q.trim() ? libraryCategorySections(shown) : [{ key: "list", label: "", items: shown }]).map((section) => (
              <section key={section.key} data-library-section={section.key}>
                {section.label && (
                  <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[15px] font-semibold">
                    {section.label}
                    <span className="text-[13px] font-normal text-muted-foreground tabular-nums">{section.items.length}</span>
                  </h2>
                )}
                <ul className="grid gap-2 lg:grid-cols-2">
                  {section.items.map((p) => (
                    <LibraryRow
                      key={p.id}
                      program={p}
                      tpl={byId.get(p.id)}
                      isAdmin={isAdmin}
                      onPreview={() => setPreviewId(p.id)}
                      onAssign={() => setAssignTpl(byId.get(p.id))}
                      onMembership={() => setMembershipTpl(byId.get(p.id) ?? null)}
                      onChanged={invalidate}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <NewProgramDialog open={newOpen} onOpenChange={setNewOpen} onCreated={invalidate} />
      <PreviewDialog templateId={previewId} onClose={() => setPreviewId(null)} onAssign={(tpl) => { setPreviewId(null); setAssignTpl(tpl); }} />
      <AssignDialog template={assignTpl} onClose={() => setAssignTpl(null)} />
      {isAdmin && (
        <MembershipListingSheet
          template={membershipTpl}
          open={!!membershipTpl}
          onOpenChange={(v) => { if (!v) setMembershipTpl(null); }}
        />
      )}
    </>
  );
}

const CHIP = "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium";

function LibraryRow({
  program: p, tpl, isAdmin, onPreview, onAssign, onMembership, onChanged,
}: {
  program: LibraryProgram;
  tpl: any;
  isAdmin: boolean;
  onPreview: () => void;
  onAssign: () => void;
  onMembership: () => void;
  onChanged: () => void;
}) {
  const showMembership = isAdmin && p.membership.kind !== "off";
  return (
    <li className="rounded-2xl border border-border bg-card" data-library-row={p.id}>
      <div className="flex items-start gap-1 py-3 pl-3.5 pr-1.5 sm:pl-4">
        <Link
          to="/admin/program-library/$templateId"
          params={{ templateId: p.id }}
          className="min-w-0 flex-1 py-0.5"
        >
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</div>
          {p.line && <div className="mt-0.5 text-[13px] text-muted-foreground">{p.line}</div>}
        </Link>
        <RowMenu
          program={p}
          tpl={tpl}
          isAdmin={isAdmin}
          onPreview={onPreview}
          onAssign={onAssign}
          onMembership={onMembership}
          onChanged={onChanged}
        />
      </div>
      <div className="-mt-1 flex flex-wrap gap-1.5 px-3.5 pb-3 empty:hidden sm:px-4">
        {p.clients.length > 0 && (
          <span className={cn(CHIP, "bg-secondary text-foreground")} data-library-clients title={p.clients.map((c) => c.name).join(", ")}>
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{clientsLabel(p.clients)}</span>
          </span>
        )}
        {showMembership && p.membership.kind === "live" && (
          <span className={cn(CHIP, "bg-secondary text-foreground")} data-library-membership="live">
            <Smartphone className="h-3.5 w-3.5 text-muted-foreground" /> Membership app
          </span>
        )}
        {showMembership && p.membership.kind === "behind" && (
          <button type="button" onClick={onMembership} className={cn(CHIP, "bg-warning/10 text-warning")} data-library-membership="behind">
            <Smartphone className="h-3.5 w-3.5" /> Members have an older version
          </button>
        )}
        {p.archived && <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>Archived</span>}
        {tpl && !p.archived && <ProgramStatusBadge template={tpl} quiet />}
      </div>
    </li>
  );
}

function RowMenu({
  program: p, tpl, isAdmin, onPreview, onAssign, onMembership, onChanged,
}: {
  program: LibraryProgram;
  tpl: any;
  isAdmin: boolean;
  onPreview: () => void;
  onAssign: () => void;
  onMembership: () => void;
  onChanged: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unpublish = useServerFn(unpublishLibraryListing);
  const listed = isAdmin && p.membership.kind !== "off" && !!p.membership.planId;

  const run = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged(); } catch (e: any) { toast.error(e?.message ?? "Something went wrong"); }
  };
  // a program that's archived or deleted can't be started by members: take it out first
  const leaveMembership = async () => {
    if (listed && p.membership.planId) await unpublish({ data: { planId: p.membership.planId, reason: null } });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" aria-label={`Options for ${p.name}`}>
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {!p.archived && (
            <DropdownMenuItem onSelect={onAssign}>
              <UserPlus className="mr-2 h-4 w-4" /> Assign to a client
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/admin/program-library/$templateId" params={{ templateId: p.id }}>
              <Pencil className="mr-2 h-4 w-4" /> Edit program
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPreview}>
            <Eye className="mr-2 h-4 w-4" /> Preview
          </DropdownMenuItem>
          {isAdmin && !p.archived && (
            <DropdownMenuItem onSelect={onMembership} data-menu-membership>
              <Smartphone className="mr-2 h-4 w-4" />
              {p.membership.kind === "off" ? "Add to membership app" : "Membership app…"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Name and details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => duplicateTemplate(p.id), "Copied")}>
            <Copy className="mr-2 h-4 w-4" /> Make a copy
          </DropdownMenuItem>
          {p.archived ? (
            <DropdownMenuItem onSelect={() => run(() => setTemplateArchived(p.id, false), "Restored")}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => run(async () => { await leaveMembership(); await setTemplateArchived(p.id, true); }, listed ? "Archived and taken out of the membership app" : "Archived")}
            >
              <ArchiveIcon className="mr-2 h-4 w-4" /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditTemplateDetailsDialog templateId={p.id} open={detailsOpen} onOpenChange={setDetailsOpen} onSaved={onChanged} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>It comes out of your library for good.</p>
                {p.clients.length > 0 && (
                  <p>
                    {p.clients.length === 1
                      ? `${clientsLabel(p.clients)} keeps their own copy of it, with every workout logged.`
                      : `${clientsLabel(p.clients)} keep their own copies of it, with every workout logged.`}
                  </p>
                )}
                {listed && <p>It also comes out of the membership app.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => run(async () => { await leaveMembership(); await deleteTemplate(p.id); }, "Deleted")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------- New program dialog -------
const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7];
const BLOCK_CHOICES = [1, 2, 3, 4];

function NewProgramDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const blank = { name: "", training_style: "bodybuilding" as TrainingStyle, days: 4, blocks: 1, weeks: "12", description: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeks = Math.max(1, Math.min(52, Number.parseInt(form.weeks, 10) || 0));
  const multi = form.blocks > 1;

  const create = async () => {
    const name = form.name.trim();
    if (!name) { toast.error("Give the program a name"); return; }
    if (!Number.parseInt(form.weeks, 10)) { toast.error("How many weeks?"); return; }
    setBusy(true);
    try {
      const weekList = () => Array.from({ length: weeks }, (_, i) => ({
        week_index: i + 1,
        days: Array.from({ length: form.days }, (_, j) => ({ day_index: j + 1, title: `Day ${j + 1}`, rows: [] })),
      }));
      const payload = multi
        ? {
            prep: { event_name: null, event_date: null },
            blocks_data: Array.from({ length: form.blocks }, (_, i) => ({
              name: `Block ${i + 1}`, weeks, days_per_week: form.days, training_focus: null, weeks_data: weekList(),
            })),
          }
        : { weeks_data: weekList() };
      const tpl = await createTemplate({
        name,
        template_type: multi ? "full_prep" : "block",
        training_style: form.training_style,
        weeks,
        days_per_week: form.days,
        description: form.description.trim() || undefined,
        payload,
      });
      onCreated();
      onOpenChange(false);
      navigate({ to: "/admin/program-library/$templateId", params: { templateId: tpl.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create it");
    } finally {
      setBusy(false);
    }
  };

  const pill = (on: boolean) => cn(
    "h-10 min-w-10 rounded-lg px-3 text-sm font-medium transition",
    on ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/80",
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Name</Label>
            <Input
              id="np-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Upper / Lower Hypertrophy"
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Style</Label>
            <Select value={form.training_style} onValueChange={(v) => setForm({ ...form, training_style: v as TrainingStyle })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{STYLES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Days a week</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_CHOICES.map((d) => (
                <button key={d} type="button" className={pill(form.days === d)} aria-pressed={form.days === d} onClick={() => setForm({ ...form, days: d })}>{d}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Blocks</Label>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_CHOICES.map((b) => (
                <button key={b} type="button" className={pill(form.blocks === b)} aria-pressed={form.blocks === b} onClick={() => setForm({ ...form, blocks: b })}>{b}</button>
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">One block for a single phase. More to split it into phases, like 3 blocks of 4 weeks.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-weeks">{multi ? "Weeks in each block" : "Weeks"}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="np-weeks"
                inputMode="numeric"
                value={form.weeks}
                onChange={(e) => setForm({ ...form, weeks: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
                className="h-11 w-24 text-base"
              />
              {multi && Number.parseInt(form.weeks, 10) > 0 && (
                <span className="text-sm text-muted-foreground">{weeks * form.blocks} weeks in all</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-desc">What it's for <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="np-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Who it suits and what it builds."
              className="text-base"
            />
          </div>
        </div>
        <DialogFooter>
          <Button className="h-11 w-full sm:w-auto" onClick={create} disabled={busy} data-create-program>{busy ? "Creating…" : "Create and build it"}</Button>
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
        notes: form.notes.trim() || null,
      });
      toast.success("Saved");
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
          <DialogTitle>Name and details</DialogTitle>
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
export function AssignDialog({ template, onClose }: { template: any; onClose: () => void }) {
  const qc = useQueryClient();
  const saveSchedule = useServerFn(saveCommittedSchedule);
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
  const [startDate, setStartDate] = useState<string>(() => todayLocalISO());
  const [endDate, setEndDate] = useState<string>("");
  // Validation gate state — set when submit detects missing requirements.
  // The dialog then switches to a confirm view that lists every issue and
  // requires a second explicit "Assign anyway" click before running.
  const [pendingIssues, setPendingIssues] = useState<DayIssue[] | null>(null);
  // Missing-maxes gate state. When the chosen client has no active 1RM/TM
  // records, the dialog switches to a blocking view that requires the coach
  // to either add one or explicitly notify the admin before continuing.
  const [showMaxesGate, setShowMaxesGate] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
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
  const { data: clientMaxes = [], refetch: refetchMaxes } = useQuery({
    queryKey: ["pl-client-maxes", clientId],
    enabled: !!clientId,
    queryFn: () => listClientMaxes(clientId),
  });
  const hasAnyMax = (clientMaxes as ClientMaxRow[]).some(
    (m) => m.active && (m.one_rm != null || m.training_max != null),
  );
  // Always re-fetch the template (with its full payload) so requirement
  // checks see fresh data — list rows may not have `payload` selected.
  const { data: fullTpl } = useQuery({
    queryKey: ["pl-template-assign", template?.id],
    enabled: !!template?.id,
    queryFn: async () =>
      (await (supabase as any).from("pl_templates").select("*").eq("id", template.id).maybeSingle()).data,
  });

  // Availability guardrail — the client's saved training days vs the
  // template's actual programmed workouts per week.
  const { data: clientRow } = useQuery({
    queryKey: ["assign-client-availability", clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase
      .from("clients")
      .select("id, full_name, committed_training_days, available_training_days, preferred_training_days, unavailable_training_days")
      .eq("id", clientId).maybeSingle()).data,
  });

  if (!template) return null;

  const guardBlocks = (() => {
    const tpl = fullTpl ?? template;
    try {
      const p = normalizeTemplatePayload(tpl.payload, { templateType: tpl.template_type, templateId: tpl.id });
      return getActiveTemplateBlocks(p) as any[];
    } catch { return [] as any[]; }
  })();
  const guard = evaluateAvailabilityGuard({
    frequency: frequencyFromTemplateBlocks(guardBlocks as any),
    availability: resolveClientAvailability(clientRow as any),
    clientName: (clients as any[]).find((c) => c.id === clientId)?.full_name ?? null,
  });
  const firstWeekTitles = (() => {
    const w = (guardBlocks[0] as any)?.weeks?.[0];
    const ds = Array.isArray(w?.days) ? w.days : Array.isArray(w?.workout_days) ? w.workout_days : [];
    return ds.map((d: any, i: number) => d?.title || d?.name || `Day ${i + 1}`);
  })();
  /** Persist the coach's chosen weekdays so the canonical scheduler uses them. */
  const persistDays = async (days: Weekday[]) => {
    const longDays = days.map((d) => GUARD_WEEKDAY_LABEL[d]);
    // One server call: saves the days AND re-dates the client's upcoming workouts.
    await saveSchedule({ data: { clientId, frequency: longDays.length, days: longDays } });
    invalidateScheduleQueries(qc, { clientId });
    qc.invalidateQueries({ queryKey: ["assign-client-availability", clientId] });
    qc.invalidateQueries({ queryKey: ["client", clientId] });
  };

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
    // Maxes gate — block assignment when client has no active 1RM/TM.
    if (!hasAnyMax) {
      setShowMaxesGate(true);
      return;
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
        {showMaxesGate ? (
          <MaxesGate
            clientId={clientId}
            clientName={(clients as any[]).find((c) => c.id === clientId)?.full_name ?? "this client"}
            templateName={template.name}
            notifying={notifying}
            onCancel={() => setShowMaxesGate(false)}
            onSaved={async () => {
              await refetchMaxes();
              toast.success("Max saved");
              setShowMaxesGate(false);
            }}
            onNotifyAndContinue={async () => {
              try {
                setNotifying(true);
                const res = await notifyMissingMaxesFn({ data: { clientId, templateName: template.name } });
                const chans = (res?.channels ?? []) as string[];
                if (chans.length === 0) {
                  toast.warning("Logged a support alert. Email/SMS could not be sent — check sender settings.");
                } else {
                  toast.success(`Notified via ${chans.join(", ")}`);
                }
                setShowMaxesGate(false);
                // Skip validation issues check too — coach already acknowledged.
                await runAssignment();
              } catch (e: any) {
                toast.error(e?.message ?? "Could not notify");
              } finally {
                setNotifying(false);
              }
            }}
          />
        ) : pendingIssues ? (
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
          <Button
            onClick={() => (guard.status === "no_program" ? submit() : setGuardOpen(true))}
            disabled={!!conflict || !clientId}
          >
            Assign to client
          </Button>
        </DialogFooter>
        </>
        )}
        {clientId && guard.status !== "no_program" && (
          <AvailabilityGuardDialog
            open={guardOpen}
            onOpenChange={setGuardOpen}
            guard={guard}
            clientId={clientId}
            clientName={(clients as any[]).find((c) => c.id === clientId)?.full_name ?? null}
            workoutTitles={firstWeekTitles}
            onConfirm={async (days) => {
              setGuardOpen(false);
              if (guard.status !== "ok") await persistDays(days);
              await submit();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------- Maxes gate (blocks assign when client has no 1RM / TM) -------
function MaxesGate({
  clientId, clientName, templateName, notifying,
  onCancel, onSaved, onNotifyAndContinue,
}: {
  clientId: string;
  clientName: string;
  templateName: string;
  notifying: boolean;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onNotifyAndContinue: () => void | Promise<void>;
}) {
  const COMMON_LIFTS = [
    "Competition Squat",
    "Competition Bench Press",
    "Competition Deadlift",
    "Overhead Press",
    "Front Squat",
    "Romanian Deadlift",
  ];
  type Row = { lift: string; oneRm: string; tm: string };
  // Start on the client's own unit; a coach choice afterwards wins.
  const { unit: clientUnit, ready: unitReady } = useClientWeightUnit(clientId);
  const [unit, setUnitState] = useState<"kg" | "lb">("lb");
  const unitTouched = useRef(false);
  const setUnit = (u: "kg" | "lb") => {
    unitTouched.current = true;
    setUnitState(u);
  };
  useEffect(() => {
    if (unitReady && !unitTouched.current) setUnitState(clientUnit);
  }, [unitReady, clientUnit]);
  const [rows, setRows] = useState<Row[]>([
    { lift: "Competition Squat", oneRm: "", tm: "" },
    { lift: "Competition Bench Press", oneRm: "", tm: "" },
    { lift: "Competition Deadlift", oneRm: "", tm: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  const addRow = () =>
    setRows((rs) => [...rs, { lift: "", oneRm: "", tm: "" }]);

  const save = async () => {
    const filled = rows
      .map((r) => ({
        lift: r.lift.trim(),
        one_rm: r.oneRm ? Number(r.oneRm) : null,
        training_max: r.tm ? Number(r.tm) : null,
      }))
      .filter((r) => r.lift && (r.one_rm != null || r.training_max != null));
    if (filled.length === 0) {
      return toast.error("Enter a 1RM or Training Max for at least one lift");
    }
    const seen = new Set<string>();
    for (const r of filled) {
      const key = r.lift.toLowerCase();
      if (seen.has(key)) return toast.error(`Duplicate lift: ${r.lift}`);
      seen.add(key);
    }
    try {
      setSaving(true);
      for (const r of filled) {
        await upsertClientMax({
          client_id: clientId,
          lift: r.lift,
          one_rm: r.one_rm,
          training_max: r.training_max,
          unit,
          source: "manual",
          active: true,
          manual_override: false,
          rounding_mode: "nearest",
          rounding_step: unit === "kg" ? 2.5 : 5,
        } as any);
      }
      await onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save maxes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Set 1RM / Training Max for {clientName}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p>
          <span className="font-semibold">{clientName}</span> has no 1RM or Training Max
          on file. Percentage-based prescriptions in{" "}
          <span className="font-semibold">"{templateName}"</span> won't calculate until at
          least one is added.
        </p>
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Lifts</div>
          <div className="flex items-center gap-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Unit</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as "kg" | "lb")}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
          {rows.map((r, i) => {
            const isCustom = r.lift !== "" && !COMMON_LIFTS.includes(r.lift);
            return (
              <div key={i} className="rounded-md border border-border bg-secondary/30 p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Select
                      value={isCustom ? "__custom__" : r.lift || undefined}
                      onValueChange={(v) => updateRow(i, { lift: v === "__custom__" ? "" : v })}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Pick lift" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_LIFTS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        <SelectItem value="__custom__">Custom lift…</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustom && (
                      <Input
                        className="mt-2"
                        value={r.lift}
                        onChange={(e) => updateRow(i, { lift: e.target.value })}
                        placeholder="Custom lift name"
                      />
                    )}
                  </div>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => removeRow(i)}
                      aria-label="Remove lift"
                    >
                      ×
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">1RM</Label>
                    <Input inputMode="decimal" value={r.oneRm} onChange={(e) => updateRow(i, { oneRm: e.target.value })} placeholder="e.g. 200" />
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Training Max</Label>
                    <Input inputMode="decimal" value={r.tm} onChange={(e) => updateRow(i, { tm: e.target.value })} placeholder="e.g. 180" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
          + Add another lift
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Enter every lift the program uses. Leave a row's 1RM/TM blank to skip it, or use
          "Skip & notify me" and we'll email + SMS you a reminder.
        </p>
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving || notifying}>Back</Button>
        <Button
          variant="secondary"
          onClick={onNotifyAndContinue}
          disabled={saving || notifying}
        >
          {notifying ? "Notifying…" : "Skip & notify me"}
        </Button>
        <Button onClick={save} disabled={saving || notifying}>
          {saving ? "Saving…" : "Save maxes"}
        </Button>
      </DialogFooter>
    </>
  );
}