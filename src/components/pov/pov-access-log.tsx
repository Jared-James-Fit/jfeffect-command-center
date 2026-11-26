import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Eye, Loader2, PenLine, Search, ShieldAlert, ShieldX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  accessLogFn,
  accessSessionFn,
  type AccessEvent,
  type AccessKind,
  type AccessLogPage,
  type AccessLogRow,
} from "@/lib/pov/pov-session.functions";
import { accessStatusWord, changeLines, durationWords, eventWords, roleWord, sourceWord } from "@/lib/pov/access-log-words";

/**
 * The account access record (admin only, server-side: admin_access_log). Every time someone
 * opened an account with View as (who, their role, whose account, when, how long, how it ended,
 * edits switched on, every change with its before and after values, writes stopped while
 * view-only) and every refused attempt. Searchable and filtered by staff member, account, dates
 * and kind; the same rows show one account's history on its profile.
 */

const KIND_CHIPS: Array<{ key: AccessKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "sessions", label: "Views" },
  { key: "edits", label: "Edits on" },
  { key: "changes", label: "Changes" },
  { key: "blocked", label: "Stopped" },
  { key: "denied", label: "Refused" },
  { key: "active", label: "Open now" },
  { key: "interrupted", label: "Interrupted" },
  { key: "expired", label: "Expired" },
  { key: "revoked", label: "Revoked" },
];

const PAGE = 40;

function startOfDayIso(d: string): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
function endOfDayIso(d: string): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  t.setDate(t.getDate() + 1);
  return t.toISOString();
}

/** The whole record with its filters (the admin's Account access page). */
export function AccessLogView({ clientId = null, compact = false }: { clientId?: string | null; compact?: boolean }) {
  const fn = useServerFn(accessLogFn);
  const [kind, setKind] = useState<AccessKind>("all");
  const [search, setSearch] = useState("");
  const [staff, setStaff] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = search.trim();

  const filters = useMemo(
    () => ({
      clientId,
      staffUserId: staff === "all" ? null : staff,
      kind,
      search: q || null,
      from: startOfDayIso(from),
      to: endOfDayIso(to),
    }),
    [clientId, staff, kind, q, from, to],
  );

  const list = useInfiniteQuery({
    queryKey: ["access-log", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fn({ data: { ...filters, limit: PAGE, offset: pageParam as number } }) as Promise<AccessLogPage>,
    getNextPageParam: (last, all) => {
      const seen = all.reduce((n, p) => n + p.rows.length, 0);
      return seen < last.total ? seen : undefined;
    },
    staleTime: 15_000,
  });

  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const staffOptions = list.data?.pages[0]?.staff ?? [];

  return (
    <div className="space-y-3" data-access-log>
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-[minmax(0,1fr)_12rem]")}>
        {!clientId && (
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value.slice(0, 120))}
              placeholder="Search a staff member or an account"
              aria-label="Search the access record"
              className="h-10 pl-9"
            />
          </label>
        )}
        {!compact && (
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger className="h-10" aria-label="Staff member">
              <SelectValue placeholder="Everyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {staffOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="What to show"
      >
        {KIND_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={kind === c.key}
            onClick={() => setKind(c.key)}
            className={cn(
              "h-8 shrink-0 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors",
              kind === c.key ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex-none sm:grid-cols-[9.5rem_9.5rem]">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 min-w-0" aria-label="From" title="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 min-w-0" aria-label="To" title="To" />
          </div>
          {(from || to) && (
            <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => { setFrom(""); setTo(""); }}>
              Any date
            </button>
          )}
          {list.data && <span className="ml-auto tabular-nums">{total} {total === 1 ? "entry" : "entries"}</span>}
        </div>
      )}

      {list.isLoading ? (
        <div className="grid h-24 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading the access record" />
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border p-4 text-sm">
          <p className="font-medium">Couldn't load the access record.</p>
          <p className="mt-0.5 text-muted-foreground">{(list.error as Error)?.message}</p>
          <Button variant="outline" size="sm" className="mt-2 h-9" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : !rows.length ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {kind === "all" && !q && !from && !to && staff === "all"
            ? clientId
              ? "Nobody has opened this account with View as."
              : "Nobody has opened an account with View as yet."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <ul className="space-y-2" data-access-log-rows>
          {rows.map((r) => (
            <AccessRow key={`${r.type}:${r.id}`} row={r} showAccount={!clientId} />
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" className="h-10" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<AccessLogRow["status"], string> = {
  active: "text-success",
  completed: "text-muted-foreground",
  expired: "text-muted-foreground",
  interrupted: "text-amber-700 dark:text-amber-400",
  revoked: "text-amber-700 dark:text-amber-400",
  denied: "text-destructive",
};

function AccessRow({ row, showAccount }: { row: AccessLogRow; showAccount: boolean }) {
  const [open, setOpen] = useState(false);
  const denied = row.type === "denied";
  const when = new Date(row.at);
  return (
    <li className="rounded-xl border bg-card" data-access-row={row.type}>
      <button
        type="button"
        onClick={() => !denied && setOpen((o) => !o)}
        aria-expanded={denied ? undefined : open}
        className={cn("flex w-full items-start gap-3 p-3 text-left", !denied && "cursor-pointer")}
      >
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted" aria-hidden>
          {denied ? <ShieldX className="h-4 w-4 text-destructive" /> : row.edited ? <PenLine className="h-4 w-4" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">
            <span className="font-semibold">{row.staff_name ?? "Someone"}</span>
            <span className="text-muted-foreground"> · {roleWord(row.staff_role)}</span>
          </span>
          <span className="block text-sm leading-snug">
            {denied ? "Refused: " : "Opened "}
            {showAccount ? <span className="font-medium">{row.client_name ?? "an account"}</span> : "this account"}
            {denied && row.source ? <span className="text-muted-foreground"> · {sourceWord(row.source)}</span> : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
            {when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {!denied && row.seconds != null && ` · ${durationWords(row.seconds)}`}
            {!denied && ` · ${row.views ?? 0} page${row.views === 1 ? "" : "s"}`}
            {!denied && (row.changes ?? 0) > 0 && ` · ${row.changes} change${row.changes === 1 ? "" : "s"}`}
            {!denied && (row.blocked ?? 0) > 0 && ` · ${row.blocked} stopped`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("text-xs font-semibold", STATUS_TONE[row.status])} data-access-status={row.status}>
            {accessStatusWord(row.status)}
          </span>
          {!denied && <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />}
        </span>
      </button>
      {open && !denied && <SessionEvents sessionId={row.id} reason={row.reason ?? null} />}
    </li>
  );
}

function SessionEvents({ sessionId, reason }: { sessionId: string; reason: string | null }) {
  const fn = useServerFn(accessSessionFn);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["access-session", sessionId],
    queryFn: () => fn({ data: { sessionId } }) as Promise<AccessEvent[]>,
    staleTime: 15_000,
  });
  if (isLoading) {
    return (
      <div className="grid h-12 place-items-center border-t">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (isError) return <p className="border-t px-3 py-2 text-xs text-destructive">Couldn't load what happened in this view.</p>;
  return (
    <ol className="space-y-1.5 border-t px-3 py-2.5 text-xs" data-access-events>
      {reason && <li className="text-muted-foreground">Noted: “{reason}”</li>}
      {(data ?? []).map((e, i) => {
        const words = eventWords(e);
        const lines = e.kind === "change" ? changeLines(e.detail) : [];
        return (
          <li key={i} className="flex gap-2">
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
              {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("font-medium", e.kind === "blocked" && "text-amber-700 dark:text-amber-400", e.kind === "revoked" && "text-amber-700 dark:text-amber-400")}>
                {e.kind === "blocked" && <ShieldAlert className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />}
                {words.title}
              </span>
              {words.detail && <span className="text-muted-foreground"> · {words.detail}</span>}
              {lines.length > 0 && (
                <span className="mt-0.5 block space-y-0.5">
                  {lines.map((l, j) => (
                    <span key={j} className="block break-words">
                      <span className="text-muted-foreground">{l.field}: </span>
                      {l.from != null && <span className="line-through decoration-muted-foreground/60">{l.from}</span>}
                      {l.from != null && " → "}
                      <span className="font-medium">{l.to}</span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One account's access history, from its profile (admin only). */
export function PovAccessLogDialog({ clientId, name, open, onOpenChange }: { clientId: string; name: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account access</DialogTitle>
          <DialogDescription>
            Every time someone opened {name ? `${name}'s` : "this"} account with View as, what they changed, and every refused attempt.
          </DialogDescription>
        </DialogHeader>
        {open && <AccessLogView clientId={clientId} compact />}
      </DialogContent>
    </Dialog>
  );
}
