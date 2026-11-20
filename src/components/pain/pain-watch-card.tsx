/**
 * Home's "Pain to look at": coaching clients whose pain wants the coach (a
 * warning sign, severe, a stopped session, getting worse, persistent, changing
 * sessions, the same exercise each time; history.ts `reasons`) with a report
 * since he last looked. One-off, mild reports never make it. A row opens the
 * pain sheet; "Mark reviewed" there keeps it off until something new comes in.
 * Hidden when there's nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { listPainWatchFn, type PainWatchItem } from "@/lib/pain/pain.functions";
import { PainReviewSheet } from "@/components/pain/pain-review-sheet";

export function PainWatchCard() {
  const list = useServerFn(listPainWatchFn);
  const { data } = useQuery({
    queryKey: ["pain-watch"],
    queryFn: () => list(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const [open, setOpen] = useState<string | null>(null);
  const items = (data ?? []) as PainWatchItem[];

  return (
    <>
      {items.length > 0 && (
        <Card className="p-4" data-pain-watch>
          <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
            Pain to look at
          </h2>
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.clientId}>
                <button type="button" onClick={() => setOpen(it.clientId)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left" data-pain-watch-row>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                      {it.redFlag && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Warning sign" />}
                      <span className="truncate">{it.name}</span>
                    </span>
                    {it.areas.map((a) => (
                      <span key={a.region} className="block truncate text-[13px] text-muted-foreground">
                        {a.label} · {a.summary}
                      </span>
                    ))}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <PainReviewSheet clientId={open} onClose={() => setOpen(null)} />
    </>
  );
}
