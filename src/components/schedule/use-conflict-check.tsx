import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { checkSessionConflicts, type ConflictCheckResult } from "@/lib/schedule.functions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ConflictSlot = { key: string; date: string; start: string; end: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Live double-booking check against app sessions and Google Calendar while the
 * coach picks a time. Debounced so typing a time doesn't fire a request per key.
 */
export function useConflictCheck(opts: {
  slots: ConflictSlot[];
  timezone: string;
  excludeSessionIds?: string[];
  enabled?: boolean;
}) {
  const valid = opts.slots.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.start && s.end && s.end > s.start);
  const key = useMemo(
    () => JSON.stringify({ s: valid, tz: opts.timezone, x: opts.excludeSessionIds ?? [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(valid), opts.timezone, (opts.excludeSessionIds ?? []).join(",")],
  );
  const debouncedKey = useDebounced(key, 400);
  const settled = debouncedKey === key;
  const enabled = (opts.enabled ?? true) && valid.length > 0;
  const q = useQuery<ConflictCheckResult>({
    queryKey: ["schedule-conflicts", debouncedKey],
    enabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => {
      const parsed = JSON.parse(debouncedKey);
      return checkSessionConflicts({
        data: {
          timezone: parsed.tz,
          slots: parsed.s.map((s: ConflictSlot) => ({ ...s, start: s.start.slice(0, 5), end: s.end.slice(0, 5) })),
          excludeSessionIds: parsed.x.length ? parsed.x : undefined,
        },
      });
    },
  });
  const checking = enabled && (!settled || q.isFetching);
  const conflicts = settled && q.data ? q.data.conflicts : [];
  return {
    checking,
    conflicts,
    conflictKeys: new Set(conflicts.map((c) => c.key)),
    googleChecked: q.data?.googleChecked ?? true,
    failed: q.isError,
  };
}

function fmtRange(start: number, end: number) {
  const o: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const d = new Date(start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${d} · ${new Date(start).toLocaleTimeString(undefined, o)}–${new Date(end).toLocaleTimeString(undefined, o)}`;
}

/**
 * The verdict under a time picker: free, or exactly what it clashes with and a
 * deliberate "book anyway" switch. The save button stays off until one of those.
 */
export function ConflictNotice({
  check,
  override,
  onOverride,
  overrideLabel = "Book anyway",
  slotLabel,
}: {
  check: ReturnType<typeof useConflictCheck>;
  override: boolean;
  onOverride: (v: boolean) => void;
  overrideLabel?: string;
  slotLabel?: (key: string) => string;
}) {
  if (check.checking) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your calendar…
      </div>
    );
  }
  if (check.failed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Couldn't check for clashes. Double-check your calendar before saving.
      </div>
    );
  }
  if (!check.conflicts.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {check.googleChecked ? "Free in the app and on Google Calendar." : "Free in the app. Google Calendar isn't connected, so it wasn't checked."}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {check.conflicts.length === 1 && !slotLabel ? "That time is already taken" : `${check.conflicts.length} time${check.conflicts.length === 1 ? "" : "s"} clash`}
      </div>
      <ul className="space-y-1.5 text-xs">
        {check.conflicts.map((c) => (
          <li key={c.key}>
            {slotLabel && <div className="font-semibold">{slotLabel(c.key)}</div>}
            {c.items.map((it) => (
              <div key={`${it.source}:${it.id}`} className="flex min-w-0 items-start gap-1.5 text-foreground/90">
                <span
                  className={cn(
                    "mt-px shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wider",
                    it.source === "google" ? "bg-sky-500/20 text-sky-300" : "bg-violet-500/20 text-violet-300",
                  )}
                >
                  {it.source === "google" ? "Google" : "App"}
                </span>
                <span className="min-w-0 break-words">
                  {it.title} <span className="text-muted-foreground">({fmtRange(it.start, it.end)})</span>
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-destructive/30 pt-2">
        <Label className="text-xs text-muted-foreground">{overrideLabel}</Label>
        <Switch checked={override} onCheckedChange={onOverride} />
      </div>
    </div>
  );
}
