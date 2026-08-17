import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listClientsDirectoryFn, type DirectoryRow } from "@/lib/clients-directory.functions";
import { COACHING_STATUSES, coachingStatus, topRiskAlert, showPtWidgets, type CoachingStatusKey } from "@/lib/coaching-management";
import { formatDistanceToNow } from "date-fns";
import { Search, AlertTriangle } from "lucide-react";

/**
 * Scan-friendly board over the existing clients-directory RPC. No new data
 * source and no snapshot table: every field is read from the same rows the
 * Clients page uses, and anything the RPC does not supply stays hidden.
 */
export function CoachingManagementBoard() {
  const fetchDirectory = useServerFn(listClientsDirectoryFn);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<CoachingStatusKey | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["coaching-management", q],
    queryFn: () => fetchDirectory({ data: { search: q, size: 100, sort: "attention" } }),
  });

  const rows = (data?.rows ?? []) as DirectoryRow[];

  const mapped = useMemo(
    () =>
      rows.map((r) => {
        const input = {
          client_status: r.client_status,
          account_status: r.account_status,
          payment_status: r.payment_status,
          f_payment_issue: r.f_payment_issue,
          missed_workouts_count: r.missed_workouts_count,
          days_since_workout: r.days_inactive,
          f_new_client: r.f_new_client,
          f_needs_setup: r.f_needs_setup,
        };
        return { row: r, status: coachingStatus(input), alert: topRiskAlert(input) };
      }),
    [rows],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mapped.length };
    for (const m of mapped) c[m.status.key] = (c[m.status.key] ?? 0) + 1;
    return c;
  }, [mapped]);

  const visible = filter === "all" ? mapped : mapped.filter((m) => m.status.key === filter);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-7" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip active={filter === "all"} label="All" count={counts.all} onClick={() => setFilter("all")} />
        {COACHING_STATUSES.map((s) => (
          <Chip key={s.key} active={filter === s.key} label={s.label} count={counts[s.key] ?? 0} onClick={() => setFilter(s.key)} />
        ))}
      </div>

      <Card className="divide-y divide-border">
        {isLoading && <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && visible.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No clients in this view.</div>
        )}
        {visible.map(({ row, status, alert }) => (
          <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3">
            <Link to="/admin/clients/$id" params={{ id: row.id }} className="font-semibold hover:underline">
              {row.full_name ?? row.email ?? "Unnamed client"}
            </Link>
            <Badge variant="outline">{status.label}</Badge>
            {row.coaching_type && <span className="text-xs text-muted-foreground">{row.coaching_type}</span>}
            {alert && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-500" title={alert.detail}>
                <AlertTriangle className="h-3.5 w-3.5" />{alert.label}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {row.last_active_at
                ? `Last active ${formatDistanceToNow(new Date(row.last_active_at), { addSuffix: true })}`
                : "No recent activity"}
            </span>
            {showPtWidgets({ coaching_type: row.coaching_type }) && (
              <Badge variant="outline" className="text-[10px]">PT</Badge>
            )}
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{row.next_action?.label}</span>
              <Link to="/admin/clients/$id" params={{ id: row.id }}>
                <Button size="sm" variant="outline">Open</Button>
              </Link>
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
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
