/**
 * Home's "Nutrition roadmaps": who needs the coach (a draft or change to
 * approve, a real risk), then who's off plan, with how many are on schedule
 * in one line. Each row opens that athlete's roadmap. Hidden when no coached
 * athlete has a roadmap.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Route } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import { STATUS_TONE } from "@/lib/nutrition-roadmap/view";
import { STATUS_LABEL } from "@/lib/nutrition-roadmap/types";
import { useRoadmapBoard } from "@/components/nutrition-roadmap/roadmap-queries";

const FIRST_ROWS = 4;

export function RoadmapBoardCard() {
  const q = useRoadmapBoard();
  const [expanded, setExpanded] = useState(false);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const attention = rows.filter((r) => r.needsCoach || r.status === "needs_attention" || r.status === "behind");
  const onPlan = rows.filter((r) => !attention.includes(r) && (r.status === "on_track" || r.status === "ahead")).length;
  const other = rows.length - attention.length - onPlan;
  if (!attention.length && !onPlan) return null;
  const shown = expanded ? attention : attention.slice(0, FIRST_ROWS);
  const more = attention.length - shown.length;
  return (
    <Card className="p-4" data-roadmap-board>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <Route className="h-4 w-4 text-muted-foreground" aria-hidden />
          Nutrition roadmaps
        </h2>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {onPlan} on schedule{attention.length ? ` · ${attention.length} to look at` : ""}{other ? ` · ${other} waiting on weigh-ins` : ""}
      </p>
      {shown.length > 0 && (
        <ul className="mt-1 divide-y divide-border">
          {shown.map((r) => (
            <li key={r.clientId}>
              <Link
                to="/admin/clients/$id"
                params={{ id: r.clientId }}
                search={{ tab: "nutrition" } as any}
                hash="roadmap"
                className="flex min-h-12 items-center gap-3 py-2"
                data-roadmap-board-row={r.status ?? "none"}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{r.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {r.waiting === "first" ? "First roadmap to approve" : r.waiting === "change" ? "A change to approve" : r.decision || r.headline || ""}
                  </span>
                </span>
                {r.status && <StatusChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusChip>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 min-h-10 w-full rounded-lg text-[14px] font-semibold text-muted-foreground hover:text-foreground">
          Show {more} more
        </button>
      )}
    </Card>
  );
}
