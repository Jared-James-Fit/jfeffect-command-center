/**
 * Competition handling in account management (Nov 26 2026): every athlete a
 * coach is handling at a meet, by where it stands (Invited, Onboarding,
 * Preparing, Ready, Completed, Cancelled), with the account it's on (coaching,
 * member, no login yet), the meet, and the payment. One folded row until it's
 * opened; nothing when nobody's ever been handled. A row opens the athlete's
 * Competition tab on that meet. Handling is a service on the athlete's
 * permanent account, so the account itself stays where it is in its own list.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { listHandlingFn } from "@/lib/competition/handling.functions";
import { HANDLING_FILTERS, HANDLING_WORD, PAYMENT_WORD, matchesFilter, type HandlingStatus } from "@/lib/competition/handling";
import { cn } from "@/lib/utils";
import { dayWords } from "./prep-ui";

export function HandlingDirectory({ search = "" }: { search?: string }) {
  const read = useServerFn(listHandlingFn);
  const q = useQuery({ queryKey: ["competition-handling-list"], queryFn: () => read({ data: { limit: 200 } }), staleTime: 60_000 });
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
    .filter((r) => !needle || [r.athlete, r.meet].some((v) => String(v ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => String(a.meetDate ?? "9999").localeCompare(String(b.meetDate ?? "9999"))), [q.data, needle]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of HANDLING_FILTERS) c[f.key] = rows.filter((r) => matchesFilter(r.status, f.key)).length;
    return c;
  }, [rows]);
  if (!rows.length) return null;
  const shown = rows.filter((r) => matchesFilter(r.status, filter));
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
          {shown.length ? (
            <ul className="divide-y divide-border">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/clients/$id"
                    params={{ id: r.client_id }}
                    search={{ tab: "competition", competition: r.competition_id }}
                    className="flex items-center gap-2 px-2 py-2.5 hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-[14px] font-medium">{r.athlete}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">
                        {[r.meet, r.meetDate ? dayWords(r.meetDate) : null, r.account].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[12px]">
                      <span className="block font-medium">{HANDLING_WORD[r.status as HandlingStatus]}</span>
                      <span className="block text-muted-foreground">{PAYMENT_WORD[r.payment as keyof typeof PAYMENT_WORD] ?? ""}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">Nobody here.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
