import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { listCrmContacts, listCoachOptions } from "@/lib/crm.functions";
import { LeadDetailDrawer } from "@/components/admin/lead-detail-drawer";
import {
  LEAD_STAGES, leadStage, displayLeadSource, displayLeadName, leadScoreDisplay,
  nextActionDisplay, lastMeaningfulContact, NO_FOLLOW_UP, type LeadStageKey,
} from "@/lib/crm-display";
import { LEAD_SCORE_DISCLAIMER } from "@/lib/lead-score-display";
import { format, formatDistanceToNow } from "date-fns";
import { Search, X, ChevronLeft, ChevronRight, Info } from "lucide-react";

/** Displayed stage → canonical lifecycle_stage values (server-side filter). */
const STAGE_TO_LIFECYCLE: Record<LeadStageKey, string[]> = {
  new: ["lead", "applicant", "new"],
  contacted: ["contacted", "call_booked", "follow_up", "nurture"],
  qualified: ["qualified"],
  offer_sent: ["offer_sent", "proposal_sent", "proposal"],
  won: ["won", "active_client"],
  lost: ["lost", "disqualified", "churned"],
};

const searchSchema = z.object({
  q: z.string().optional(),
  scope: z.enum(["all", "prospects", "active", "applicants"]).optional(),
  stage: z.enum(["new", "contacted", "qualified", "offer_sent", "won", "lost"]).optional(),
  lifecycle_stage: z.string().optional(),
  lead_temperature: z.enum(["hot", "warm", "cold"]).optional(),
  source: z.string().optional(),
  call_booked: z.enum(["true", "false"]).optional(),
  assigned_coach_id: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  sort: z.enum(["full_name", "created_at", "lead_score", "next_follow_up_at", "last_contacted_at"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).optional(),
  open: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/crm/contacts/")({
  validateSearch: (s: any) => searchSchema.parse(s ?? {}),
  component: LeadsList,
});

function LeadsList() {
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const fetchList = useServerFn(listCrmContacts);
  const fetchCoaches = useServerFn(listCoachOptions);
  const [openId, setOpenId] = useState<string | null>(search.open ?? null);

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? 50;
  const sort = search.sort ?? "created_at";
  const dir = search.dir ?? "desc";

  const filters: any = {
    search: search.q || "",
    scope: search.scope || "all",
    stage_in: search.stage ? STAGE_TO_LIFECYCLE[search.stage] : undefined,
    lifecycle_stage: search.lifecycle_stage,
    lead_temperature: search.lead_temperature,
    source: search.source,
    call_booked: search.call_booked,
    assigned_coach_id: search.assigned_coach_id,
    overdue: search.overdue,
    sort,
    dir,
    page,
    pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["crm", "contacts", filters],
    queryFn: () => fetchList({ data: filters }),
  });
  const { data: coachData } = useQuery({ queryKey: ["crm", "coaches"], queryFn: () => fetchCoaches() });

  // Stage counts across the whole filtered set (one lightweight head query per stage
  // is avoided by counting the current page plus the server total for the active stage).
  const rows = data?.contacts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function setSearch(patch: any) {
    nav({ search: (prev: any) => ({ ...prev, ...patch, page: undefined }), replace: true });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        subtitle="Sales pipeline — applications and prospects. Active coaching is managed separately."
        actions={<Link to="/admin/crm"><Button size="sm" variant="outline">Dashboard</Button></Link>}
      />

      <div className="flex flex-wrap gap-1 px-1">
        <StageChip active={!search.stage} label="All" count={total} onClick={() => setSearch({ stage: undefined })} />
        {LEAD_STAGES.map((s) => (
          <StageChip
            key={s.key}
            active={search.stage === s.key}
            label={s.label}
            count={search.stage === s.key ? total : undefined}
            onClick={() => setSearch({ stage: s.key })}
          />
        ))}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, email, phone, Instagram…"
              className="pl-7"
              defaultValue={search.q ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                clearTimeout((window as any).__crmSearchT);
                (window as any).__crmSearchT = setTimeout(() => setSearch({ q: v || undefined }), 250);
              }}
            />
          </div>
          <FilterSelect label="Scope" value={search.scope} onChange={(v) => setSearch({ scope: v })}
            options={[["all", "All contacts"], ["prospects", "Prospects"], ["applicants", "Applicants"], ["active", "Active clients"]]} />
          <FilterSelect label="Overdue" value={search.overdue} onChange={(v) => setSearch({ overdue: v as any })}
            options={[["true", "Follow-up overdue"]]} />
          <FilterSelect label="Coach" value={search.assigned_coach_id} onChange={(v) => setSearch({ assigned_coach_id: v })}
            options={(coachData?.coaches ?? []).map((c: any) => [c.id, c.full_name])} />
          <FilterSelect label="Sort" value={search.sort} onChange={(v) => setSearch({ sort: v as any })}
            options={[["created_at", "Newest"], ["lead_score", "Lead score"], ["next_follow_up_at", "Follow-up"], ["last_contacted_at", "Last contact"], ["full_name", "Name"]]} />
          <Button size="sm" variant="ghost" onClick={() => nav({ search: {} as any, replace: true })}>
            <X className="mr-1 h-3 w-3" />Clear
          </Button>
        </div>
      </Card>

      <Card className="divide-y divide-border">
        {isLoading && <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No leads match these filters.
          </div>
        )}
        {rows.map((r: any) => (
          <LeadRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </Card>

      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>{total.toLocaleString()} leads</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1}
            onClick={() => nav({ search: (p: any) => ({ ...p, page: page - 1 }), replace: true })}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span>Page {page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages}
            onClick={() => nav({ search: (p: any) => ({ ...p, page: page + 1 }), replace: true })}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <LeadDetailDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function LeadRow({ r, onOpen }: { r: any; onOpen: () => void }) {
  const stage = leadStage(r.lifecycle_stage);
  const score = leadScoreDisplay(r.lead_score);
  const next = nextActionDisplay({ next_follow_up_at: r.next_follow_up_at });
  const last = lastMeaningfulContact(r);
  const service = (r.coaching_type || r.recommended_offer || "").trim();
  const goal = (r.goals || "").trim();

  return (
    <button type="button" onClick={onOpen} className="block w-full px-3 py-3 text-left hover:bg-muted/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{displayLeadName(r)}</span>
        <Badge variant="outline">{stage.label}</Badge>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Lead Score {score.label} <Info className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <div>{score.reason}</div>
              <div className="mt-1 opacity-80">{LEAD_SCORE_DISCLAIMER}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {r.coaches?.full_name && (
          <span className="text-xs text-muted-foreground">Owner: {r.coaches.full_name}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{displayLeadSource(r.source)}</span>
        {service && <span>· {service}</span>}
        {goal && <span className="truncate max-w-[220px]">· {goal}</span>}
        <span>
          · {last.at
            ? `${last.kind === "contacted" ? "Contacted" : "Applied"} ${formatDistanceToNow(new Date(last.at), { addSuffix: true })}`
            : "No contact yet"}
        </span>
        <span className={next.isSet ? "" : "italic"}>
          · {next.isSet
            ? `${next.label}${next.dueAt ? ` · ${format(new Date(next.dueAt), "MMM d")}` : ""}`
            : NO_FOLLOW_UP}
        </span>
      </div>
    </button>
  );
}

function StageChip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}{typeof count === "number" ? ` · ${count}` : ""}
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value?: string; onChange: (v: string | undefined) => void; options: any[];
}) {
  return (
    <Select value={value ?? "_all"} onValueChange={(v) => onChange(v === "_all" ? undefined : v)}>
      <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="_all">{label}: any</SelectItem>
        {options.map(([v, l]: any) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
