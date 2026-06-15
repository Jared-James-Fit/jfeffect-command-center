import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { History, Search, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { WorkoutListCard } from "@/components/workout-list-card";
import { todayLocalISO } from "@/lib/today";

const sb = supabase as any;

/**
 * Read-only history of completed / past blocks. Reuses pl_* tables.
 * Renders summaries first, lazy-loads days when a block is expanded.
 */
export function ClientPreviousBlocks({
  clientId,
  mode = "client",
}: { clientId: string; mode?: "client" | "admin" }) {
  const today = todayLocalISO();

  const { data: blocks = [], isLoading } = useQuery({
    queryKey: ["pl-blocks-history", clientId],
    queryFn: async () => {
      const { data } = await sb
        .from("pl_blocks")
        .select("*")
        .eq("client_id", clientId)
        .or(`status.eq.Completed,end_date.lt.${today}`)
        .order("end_date", { ascending: false, nullsFirst: false });
      return (data ?? []) as any[];
    },
  });

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return blocks;
    return (blocks as any[]).filter((b) =>
      (b.name ?? "").toLowerCase().includes(q) ||
      (b.training_focus ?? "").toLowerCase().includes(q),
    );
  }, [blocks, search]);

  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </Card>
    );
  }

  if ((blocks as any[]).length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <History className="mx-auto mb-2 h-8 w-8 opacity-60" />
        No previous blocks yet. Completed blocks will appear here.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search blocks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Accordion type="multiple" className="space-y-2">
        {filtered.map((b) => (
          <AccordionItem key={b.id} value={b.id} className="rounded-lg border border-border bg-card">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex flex-1 flex-wrap items-center gap-2 text-left">
                <div className="font-bold">{b.name}</div>
                <Badge variant="outline" className="text-[10px]">{b.status}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {b.start_date && format(parseISO(b.start_date), "MMM d, yyyy")}
                  {b.end_date && ` – ${format(parseISO(b.end_date), "MMM d, yyyy")}`}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <BlockHistoryDetail blockId={b.id} clientId={clientId} readonly={false} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function BlockHistoryDetail({ blockId, clientId, readonly }: { blockId: string; clientId: string; readonly: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pl-block-history-detail", blockId, clientId],
    queryFn: async () => {
      const { data: weeks } = await sb.from("pl_weeks").select("*").eq("block_id", blockId).order("week_index");
      const weekIds = (weeks ?? []).map((w: any) => w.id);
      const { data: days } = weekIds.length
        ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index")
        : { data: [] };
      const dayIds = (days ?? []).map((d: any) => d.id);
      const { data: completions } = dayIds.length
        ? await sb.from("pl_day_completions").select("*").in("day_id", dayIds).eq("client_id", clientId)
        : { data: [] };
      return { weeks: weeks ?? [], days: days ?? [], completions: completions ?? [] };
    },
  });
  if (isLoading || !data) {
    return <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>;
  }
  if (data.weeks.length === 0) {
    return <p className="py-3 text-xs italic text-muted-foreground">No weeks in this block.</p>;
  }
  return (
    <div className="space-y-4">
      {data.weeks.map((w: any) => {
        const wDays = data.days.filter((d: any) => d.week_id === w.id);
        return (
          <div key={w.id} className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Week {w.week_index}
            </div>
            {wDays.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No workouts.</p>
            ) : (
              <div className="space-y-2">
                {wDays.map((d: any) => {
                  const completion = data.completions.find((c: any) => c.day_id === d.id) ?? null;
                  return (
                    <WorkoutListCard
                      key={d.id}
                      item={{ day: d, week: w, block: { id: blockId }, completion }}
                      readonly={readonly}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}