import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import {
  fetchMediaTasks, STATUS_LABELS, type StatusLabel,
} from "@/lib/media-tasks";
import { supabase } from "@/integrations/supabase/client";

export function WorkBoardView() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["media-tasks"], queryFn: () => fetchMediaTasks() });

  const cols = useMemo(() => {
    const m: Record<StatusLabel, typeof tasks> = {
      not_started: [], in_progress: [], waiting: [], blocked: [], complete: [],
    };
    for (const t of tasks) {
      const k: StatusLabel = (t.status_label as StatusLabel) || (t.status === "done" ? "complete" : "not_started");
      m[k].push(t);
    }
    return m;
  }, [tasks]);

  async function move(id: string, to: StatusLabel) {
    const patch: any = { status_label: to };
    if (to === "complete") { patch.status = "done"; patch.completed_at = new Date().toISOString(); }
    else { patch.status = "open"; patch.completed_at = null; }
    await (supabase.from("tasks") as any).update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-5 md:grid-cols-3 sm:grid-cols-2">
      {STATUS_LABELS.map((s) => (
        <Card key={s.value} className="border-border p-3" style={{ borderColor: `${s.color}40` }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: s.color }}>{s.label}</span>
            <Badge variant="outline">{cols[s.value].length}</Badge>
          </div>
          <ul className="space-y-2">
            {cols[s.value].map((t) => (
              <li key={t.id} className="rounded border border-border bg-card/70 p-2.5 text-sm">
                <div className="font-medium leading-tight">{t.title}</div>
                {t.assignee_name && <div className="mt-0.5 text-[10px] text-muted-foreground">→ {t.assignee_name}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {STATUS_LABELS.filter((x) => x.value !== s.value).map((to) => (
                    <Button key={to.value} size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => move(t.id, to.value)}>
                      <ArrowRight className="mr-1 h-3 w-3" />{to.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
            {cols[s.value].length === 0 && (
              <li className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">Empty</li>
            )}
          </ul>
        </Card>
      ))}
    </div>
  );
}