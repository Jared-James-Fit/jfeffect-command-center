/**
 * Competition handling in account management (Nov 26 2026): every athlete a
 * coach is handling at a meet, by where it stands (Invited, Onboarding,
 * Preparing, Ready, Completed, Cancelled), with the account it's on (coaching,
 * member, no login yet), the meet, and the payment. One folded row until it's
 * opened; nothing when nobody's ever been handled. Every card is the same
 * ClientRow rendered by the parent. Handling is a service on the athlete's
 * permanent account, so the account itself stays where it is in its own list.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Trophy } from "lucide-react";
import { listClientsDirectoryFn, type DirectoryRow } from "@/lib/clients-directory.functions";
import { readWholeDirectory } from "@/lib/clients-directory-starred";
import { listHandlingFn } from "@/lib/competition/handling.functions";
import { HANDLING_FILTERS, HANDLING_WORD, matchesFilter, type HandlingStatus } from "@/lib/competition/handling";
import { cn } from "@/lib/utils";

export function HandlingDirectory({ search = "", lifecycle, renderClientRow, starredOnly }: {
  search?: string;
  lifecycle: "active" | "archived" | "deactivated";
  renderClientRow: (row: DirectoryRow) => ReactNode;
  starredOnly?: ReadonlySet<string>;
}) {
  const read = useServerFn(listHandlingFn);
  const q = useQuery({ queryKey: ["competition-handling-list"], queryFn: () => read({ data: { limit: 200 } }), staleTime: 60_000 });
  const readDirectory = useServerFn(listClientsDirectoryFn);
  const directory = useQuery({
    queryKey: ["clients-directory", "handling", lifecycle],
    enabled: !!q.data?.rows?.length,
    queryFn: () => readWholeDirectory((page, size) => readDirectory({ data: {
      coachingType: "Competition Handling", lifecycle, page, size, separateNutrition: false,
      search: "", flags: [], match: "any", sort: "name", coachId: null,
    } })),
    staleTime: 10_000,
  });
  const byClient = useMemo(() => new Map((directory.data?.rows ?? []).map(r => [r.id, r])), [directory.data]);
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("jf:handling-directory-open");
      if (stored === "true" || stored === "false") setOpen(stored === "true");
    } catch { /* Private browsing: use the default. */ }
  }, []);
  const [filter, setFilter] = useState<HandlingStatus | "active">("active");
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => ((q.data?.rows ?? []) as any[])
    .filter((r) => (!starredOnly || starredOnly.has(r.client_id)) && (!directory.data || byClient.has(r.client_id)))
    .filter((r) => !needle || [r.athlete, r.meet, byClient.get(r.client_id)?.email].some((v) => String(v ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => String(a.meetDate ?? "9999").localeCompare(String(b.meetDate ?? "9999"))), [q.data, needle, byClient, directory.data, starredOnly]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of HANDLING_FILTERS) c[f.key] = new Set(rows.filter((r) => matchesFilter(r.status, f.key)).map(r => r.client_id)).size;
    return c;
  }, [rows]);
  if (!rows.length) return null;
  const shown = [...new Set(rows.filter((r) => matchesFilter(r.status, filter)).map(r => r.client_id))];
  const expanded = !!needle || (open ?? counts.active > 0);
  const summary = (["invited", "onboarding", "preparing", "ready"] as const)
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${HANDLING_WORD[k].toLowerCase()}`)
    .join(" · ");
  return (
    <section className="rounded-2xl border border-border bg-card" data-handling-directory>
      <button type="button" aria-expanded={expanded} onClick={() => {
        const next = !expanded;
        setOpen(next);
        try { window.localStorage.setItem("jf:handling-directory-open", String(next)); } catch { /* optional */ }
      }} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="text-[14.5px] font-medium">Competition handling</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">{summary || "Nothing active"}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded ? (
        <div className="border-t border-border px-2 pb-2">
          <div className="flex gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {HANDLING_FILTERS.filter((f) => f.key === "active" || counts[f.key] > 0 || f.key === filter).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-[12.5px]",
                  filter === f.key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
                )}
                data-handling-filter={f.key}
              >
                {f.label} {counts[f.key] ?? 0}
              </button>
            ))}
          </div>
          {directory.isError ? (
            <button type="button" className="px-2 py-3 text-sm" onClick={() => directory.refetch()}>Couldn't load clients · Retry</button>
          ) : !directory.data ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading clients…</p>
          ) : shown.length ? (
            <ul className="space-y-2">
              {shown.map(id => byClient.get(id)).filter((r): r is DirectoryRow => !!r).map(renderClientRow)}
            </ul>
          ) : (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">Nobody here.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
