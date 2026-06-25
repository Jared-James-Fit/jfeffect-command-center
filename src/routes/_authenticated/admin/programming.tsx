import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ProgramLibrary, AssignDialog } from "./program-library";
import { ExercisesAdmin } from "./exercises";
import { CardioDashboard } from "./cardio-targets";
import { WarmupProtocolsAdmin } from "./warmup-protocols";
import { AdminRecipes } from "./recipes";
import { ProgramFinder, type FinderItem } from "@/components/programs/program-finder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTemplates, listTemplateAssignments, deletePrep, deleteBlock, setBlockEndDate, setPrepEndDate } from "@/lib/pl-programs";
import { supabase } from "@/integrations/supabase/client";
import { validateTemplatePayload } from "@/lib/pl-template-validation";
import { Button } from "@/components/ui/button";
import { UserPlus, Users, Trash2, Pencil, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

type TabKey = "programs" | "browse" | "exercises" | "cardio" | "warmups" | "recipes";
const TABS: { value: TabKey; label: string }[] = [
  { value: "programs", label: "Programs" },
  { value: "browse", label: "List" },
  { value: "exercises", label: "Exercises" },
  { value: "cardio", label: "Cardio" },
  { value: "warmups", label: "Warm-Ups" },
  { value: "recipes", label: "Recipes" },
];
const LAST_TAB_KEY = "jf-admin-programming-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

export const Route = createFileRoute("/_authenticated/admin/programming")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s }; } catch {}
    }
    return { tab: "programs" };
  },
  component: ProgrammingWorkspace,
  pendingComponent: ProgrammingSkeleton,
});

function ProgrammingSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="h-10 w-48 animate-pulse rounded bg-muted" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="h-72 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

function ProgrammingWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/programming", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Programming" subtitle="Programs, exercises, cardio, warm-ups, and recipes." />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "programs" && <ProgramLibrary embedded />}
        {tab === "browse" && <AdminProgramBrowser />}
        {tab === "exercises" && <ExercisesAdmin embedded />}
        {tab === "cardio" && <CardioDashboard embedded />}
        {tab === "warmups" && <WarmupProtocolsAdmin embedded />}
        {tab === "recipes" && <AdminRecipes embedded />}
      </div>
    </>
  );
}

function AdminProgramBrowser() {
  const [assignTpl, setAssignTpl] = useState<any | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-finder-templates"],
    queryFn: () => listTemplates({ type: "all", style: "all", includeArchived: true } as any),
  });
  // Distinct template IDs that have at least one active client assignment.
  const { data: assignedClientCounts } = useQuery({
    queryKey: ["admin-finder-assignments"],
    queryFn: async () => {
      const map = new Map<string, number>();
      const [preps, blocks] = await Promise.all([
        supabase.from("pl_preps").select("source_template_id, client_id").eq("archived", false),
        supabase.from("pl_blocks").select("source_template_id, client_id").eq("archived", false),
      ]);
      const bump = (rows: any[] | null) => {
        for (const r of rows ?? []) {
          const id = r?.source_template_id;
          if (!id) continue;
          map.set(id, (map.get(id) ?? 0) + 1);
        }
      };
      bump(preps.data as any);
      bump(blocks.data as any);
      return Object.fromEntries(map);
    },
    staleTime: 60_000,
  });
  // Templates published to the membership library.
  const { data: membershipSet } = useQuery({
    queryKey: ["admin-finder-membership"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_template_shares")
        .select("template_id, destination, status")
        .eq("destination", "membership")
        .not("status", "in", "(removed,rejected)");
      const set = new Set<string>();
      for (const r of (data ?? []) as any[]) if (r?.template_id) set.add(r.template_id);
      return set;
    },
    staleTime: 60_000,
  });
  const items: FinderItem[] = useMemo(() => (data ?? []).map((t: any) => {
    const issues = (() => { try { return validateTemplatePayload(t); } catch { return []; } })();
    return {
      id: t.id,
      title: t.name,
      trainingStyle: t.training_style,
      level: t.difficulty ?? t.training_focus,
      weeks: t.weeks,
      daysPerWeek: t.days_per_week,
      goal: t.goal ?? t.training_focus,
      tags: t.tags ?? null,
      description: t.description ?? null,
      notes: t.notes ?? null,
      templateType: t.template_type ?? null,
      archived: !!t.archived,
      validationOk: Array.isArray(issues) ? issues.length === 0 : true,
      assignedClientCount: (assignedClientCounts as any)?.[t.id] ?? 0,
      membershipPublished: !!(membershipSet as Set<string> | undefined)?.has(t.id),
      raw: t,
    } as FinderItem;
  }), [data, assignedClientCounts, membershipSet]);
  return (
    <div className="p-3 sm:p-4 md:p-6">
      <ProgramFinder
        items={items}
        loading={isLoading}
        showAdminFilters
        loadPayload={async (it) => {
          const { data } = await supabase.from("pl_templates").select("payload").eq("id", it.id).maybeSingle();
          return (data as any)?.payload ?? null;
        }}
        renderActions={(it) => (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setAssignTpl(it.raw ?? { id: it.id, name: it.title })}>
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Assign to client
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/admin/program-library/$templateId" params={{ templateId: it.id }}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit in builder
                </Link>
              </Button>
              {it.membershipPublished && (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                  In Membership Library
                </span>
              )}
            </div>
            <AssignedClientsPanel templateId={it.id} />
          </div>
        )}
      />
      <AssignDialog template={assignTpl} onClose={() => setAssignTpl(null)} />
    </div>
  );
}

function AssignedClientsPanel({ templateId }: { templateId: string }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const canUnassign = role === "admin" || role === "coach";
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["pl-template-assignments", templateId],
    queryFn: () => listTemplateAssignments(templateId),
    enabled: !!templateId,
    staleTime: 0,
  });
  const active = (assignments as any[]).filter((a) => !a.archived);
  const uniqueClientCount = new Set(active.map((a: any) => a.clientId)).size;

  const unassign = async (a: any) => {
    if (!confirm(`Unassign "${a.label}" from ${a.clientName ?? "this client"}? This deletes the assignment.`)) return;
    setBusyId(a.id);
    try {
      if (a.kind === "prep") await deletePrep(a.id);
      else await deleteBlock(a.id);
      toast.success("Unassigned");
      qc.invalidateQueries({ queryKey: ["pl-template-assignments", templateId] });
      qc.invalidateQueries({ queryKey: ["admin-finder-assignments"] });
      qc.invalidateQueries({ queryKey: ["pl-preps", a.clientId] });
      qc.invalidateQueries({ queryKey: ["pl-blocks", a.clientId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to unassign");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Assigned to {uniqueClientCount} client{uniqueClientCount === 1 ? "" : "s"} · {active.length} active assignment{active.length === 1 ? "" : "s"}
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : active.length === 0 ? (
        <div className="text-xs text-muted-foreground">Not yet assigned to any client.</div>
      ) : (
        <ul className="space-y-1">
          {active.map((a: any) => (
            <li key={`${a.kind}-${a.id}`} className="flex items-center justify-between gap-2 text-xs">
              <Link
                to="/admin/client-programs/$clientId"
                params={{ clientId: a.clientId }}
                className="truncate text-foreground hover:underline"
              >
                {a.clientName ?? "Unknown client"}
              </Link>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="truncate text-[10px] text-muted-foreground">
                  {a.kind === "prep" ? "Prep" : "Block"} · {a.label}
                </span>
                <EndDateEditor
                  assignment={a}
                  canEdit={canUnassign}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["pl-template-assignments", templateId] });
                    qc.invalidateQueries({ queryKey: ["pl-preps", a.clientId] });
                    qc.invalidateQueries({ queryKey: ["pl-blocks", a.clientId] });
                  }}
                />
                {canUnassign && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    disabled={busyId === a.id}
                    onClick={() => unassign(a)}
                    title="Unassign"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EndDateEditor({
  assignment,
  canEdit,
  onSaved,
}: {
  assignment: any;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(assignment.endDate ?? "");
  const [saving, setSaving] = useState(false);
  const label = assignment.endDate
    ? `Ends ${assignment.endDate}`
    : "Set end date";
  const save = async (next: string | null) => {
    setSaving(true);
    try {
      if (assignment.kind === "prep") await setPrepEndDate(assignment.id, next);
      else await setBlockEndDate(assignment.id, next);
      toast.success(next ? "End date updated" : "End date cleared");
      onSaved();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update end date");
    } finally {
      setSaving(false);
    }
  };
  if (!canEdit) {
    return (
      <span className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <CalendarIcon className="mr-1 inline h-3 w-3" />
        {assignment.endDate ?? "No end date"}
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(assignment.endDate ?? ""); }}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-1.5 text-[10px]"
          title={assignment.startDate ? `Starts ${assignment.startDate}` : undefined}
        >
          <CalendarIcon className="h-3 w-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 pointer-events-auto" align="end">
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">
            {assignment.startDate ? `Starts ${assignment.startDate}` : "No start date"}
          </div>
          <div>
            <Label className="text-xs">End date</Label>
            <Input
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={assignment.startDate ?? undefined}
            />
          </div>
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={saving || !assignment.endDate}
              onClick={() => save(null)}
            >
              Clear
            </Button>
            <Button size="sm" disabled={saving || !value} onClick={() => save(value)}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}