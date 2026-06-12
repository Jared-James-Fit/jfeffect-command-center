import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { listCrmContacts, listCoachOptions } from "@/lib/crm.functions";
import { format } from "date-fns";
import { Search, X } from "lucide-react";

const searchSchema = z.object({
  q: z.string().optional(),
  scope: z.enum(["all","prospects","active","applicants"]).optional(),
  lifecycle_stage: z.string().optional(),
  lead_temperature: z.enum(["hot","warm","cold"]).optional(),
  source: z.string().optional(),
  call_booked: z.enum(["true","false"]).optional(),
  assigned_coach_id: z.string().optional(),
  overdue: z.enum(["true","false"]).optional(),
});

export const Route = createFileRoute("/_authenticated/admin/crm/contacts/")({
  validateSearch: (s: any) => searchSchema.parse(s ?? {}),
  component: ContactsList,
});

const STAGES = ["lead","applicant","call_booked","qualified","follow_up","won","active_client","paused","lost","disqualified"];

function ContactsList() {
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const fetchList = useServerFn(listCrmContacts);
  const fetchCoaches = useServerFn(listCoachOptions);

  const filters: any = {
    search: search.q || "",
    scope: search.scope || "all",
    lifecycle_stage: search.lifecycle_stage,
    lead_temperature: search.lead_temperature,
    source: search.source,
    call_booked: search.call_booked,
    assigned_coach_id: search.assigned_coach_id,
    overdue: search.overdue,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["crm","contacts", filters],
    queryFn: () => fetchList({ data: filters }),
  });
  const { data: coachData } = useQuery({ queryKey: ["crm","coaches"], queryFn: () => fetchCoaches() });

  const rows = data?.contacts ?? [];
  function setSearch(patch: any) {
    nav({ search: (prev: any) => ({ ...prev, ...patch }), replace: true });
  }
  function clearFilters() {
    nav({ search: {} as any, replace: true });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="CRM Contacts" subtitle="Leads, applicants, prospects, and active coaching clients." />

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
            options={[["all","All contacts"],["prospects","Prospects"],["applicants","Applicants"],["active","Active clients"]]} />
          <FilterSelect label="Stage" value={search.lifecycle_stage} onChange={(v) => setSearch({ lifecycle_stage: v })}
            options={STAGES.map((s) => [s, s.replace(/_/g," ")])} />
          <FilterSelect label="Temp" value={search.lead_temperature} onChange={(v) => setSearch({ lead_temperature: v as any })}
            options={[["hot","Hot"],["warm","Warm"],["cold","Cold"]]} />
          <FilterSelect label="Call booked" value={search.call_booked} onChange={(v) => setSearch({ call_booked: v as any })}
            options={[["true","Yes"],["false","No"]]} />
          <FilterSelect label="Overdue" value={search.overdue} onChange={(v) => setSearch({ overdue: v as any })}
            options={[["true","Follow-up overdue"]]} />
          <FilterSelect label="Coach" value={search.assigned_coach_id} onChange={(v) => setSearch({ assigned_coach_id: v })}
            options={(coachData?.coaches ?? []).map((c: any) => [c.id, c.full_name])} />
          <Button size="sm" variant="ghost" onClick={clearFilters}><X className="mr-1 h-3 w-3" />Clear</Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Stage</Th><Th>Temp</Th><Th>Score</Th>
              <Th>Source</Th><Th>Call</Th><Th>Follow-up</Th><Th>Coach</Th><Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={11} className="p-6 text-center text-sm text-muted-foreground">
                No contacts match these filters. Adjust filters or wait for new applications to come in.
              </td></tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                <Td><Link to="/admin/crm/contacts/$id" params={{ id: r.id }} className="font-medium hover:underline">
                  {r.full_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                  {r.lifecycle_stage === "active_client" && <Badge className="ml-2 bg-emerald-500/15 text-emerald-500" variant="outline">Active</Badge>}
                </Link></Td>
                <Td className="text-xs">{r.email}</Td>
                <Td className="text-xs">{r.phone ?? "—"}</Td>
                <Td><Badge variant="outline" className="capitalize">{(r.lifecycle_stage ?? "—").replace(/_/g," ")}</Badge></Td>
                <Td><TempBadge t={r.lead_temperature} /></Td>
                <Td>{r.lead_score ?? "—"}</Td>
                <Td className="text-xs">{r.source ?? "—"}</Td>
                <Td>{r.call_booked ? "✓" : "—"}</Td>
                <Td className="text-xs">{r.next_follow_up_at ? format(new Date(r.next_follow_up_at), "MMM d") : "—"}</Td>
                <Td className="text-xs">{r.coaches?.full_name ?? "—"}</Td>
                <Td className="text-xs">{format(new Date(r.created_at), "MMM d")}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Th({ children }: any) { return <th className="px-3 py-2">{children}</th>; }
function Td({ children, className }: any) { return <td className={`px-3 py-2 ${className ?? ""}`}>{children}</td>; }
function TempBadge({ t }: { t: string | null }) {
  if (!t) return <span>—</span>;
  const tone = t === "hot" ? "bg-red-500/15 text-red-500" : t === "warm" ? "bg-amber-500/15 text-amber-500" : "bg-sky-500/15 text-sky-500";
  return <Badge variant="outline" className={`capitalize ${tone}`}>{t}</Badge>;
}
function FilterSelect({ label, value, onChange, options }: any) {
  return (
    <Select value={value ?? "_any"} onValueChange={(v) => onChange(v === "_any" ? undefined : v)}>
      <SelectTrigger className="w-[160px]"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="_any">{label}: Any</SelectItem>
        {options.map(([v, l]: any) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}