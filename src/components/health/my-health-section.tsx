/**
 * Client app → Account → Health & injuries: what's in their health profile
 * (client_health_items they can see: their own and what their coach shared)
 * and a way to add or change their own. Their coach hears about changes
 * (`health_updated`). Read-only in "View as client", and a coach-only item
 * never shows here (RLS hides it from the client; the preview filters it too).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HealthItemSheet, type HealthSheetTarget } from "@/components/health/health-item-sheet";
import { HEALTH_KINDS, type HealthItem } from "@/lib/health/health-profile";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { PREVIEW_ONLY_MESSAGE } from "@/lib/community";

export const myHealthKey = (clientId: string) => ["my-health-items", clientId] as const;

export function useMyHealthItems(clientId: string | null | undefined, preview: boolean) {
  return useQuery({
    queryKey: myHealthKey(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async (): Promise<HealthItem[]> => {
      const { data, error } = await (supabase as any)
        .from("client_health_items")
        .select("*")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      // a coach previewing reads as staff: never show what the client can't see
      return ((data ?? []) as HealthItem[]).filter((i) => !preview || !i.coach_only);
    },
    staleTime: 30_000,
  });
}

/** "2 injuries · 1 medication", or null when nothing's on file. */
export function myHealthSummary(items: HealthItem[]): string | null {
  const live = items.filter((i) => i.status !== "resolved");
  if (!live.length) return null;
  return HEALTH_KINDS.map((k) => {
    const n = live.filter((i) => i.kind === k.kind).length;
    return n ? `${n} ${n === 1 ? k.label.toLowerCase() : k.plural.toLowerCase().replace(" they take", "")}` : null;
  })
    .filter(Boolean)
    .join(" · ");
}

export function MyHealthSection({ clientId, preview }: { clientId: string; preview: boolean }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useMyHealthItems(clientId, preview);
  const [target, setTarget] = useState<HealthSheetTarget>(null);
  const live = items.filter((i) => i.status !== "resolved");
  const refresh = () => void qc.invalidateQueries({ queryKey: myHealthKey(clientId) });

  const open = (t: HealthSheetTarget) => {
    if (preview) return void toast(PREVIEW_ONLY_MESSAGE);
    setTarget(t);
  };

  const setResolved = async (i: HealthItem, on: boolean) => {
    if (preview) return void toast(PREVIEW_ONLY_MESSAGE);
    const { error } = await (supabase as any)
      .from("client_health_items")
      .update(on ? { status: "resolved", resolved_on: new Date().toISOString().slice(0, 10) } : { status: "active", resolved_on: null })
      .eq("id", i.id);
    if (error) return void toast.error(error.message ?? "Couldn't update it");
    refresh();
    fireAppEvent("health_updated", i.id);
    if (on) toast(`${i.label}: marked as ${i.kind === "injury" ? "healed" : "done"}.`, { action: { label: "Undo", onClick: () => void setResolved(i, false) } });
  };

  return (
    <div className="space-y-4" data-my-health>
      <p className="text-[14px] text-muted-foreground">
        Injuries, conditions, medications and supplements. Your coach plans your training, nutrition and supplements around them. Only you and your coach see this.
      </p>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : live.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {live.map((i) => {
            const kind = HEALTH_KINDS.find((k) => k.kind === i.kind);
            const mine = i.source === "client";
            return (
              <li key={i.id} className="flex items-start gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-muted-foreground">{kind?.label}</div>
                  <div className="break-words text-[15px]">
                    {i.label}
                    {i.body_area && !i.label.toLowerCase().includes(i.body_area.toLowerCase()) ? <span className="text-muted-foreground"> · {i.body_area}</span> : null}
                  </div>
                  {i.details ? <div className="line-clamp-3 whitespace-pre-line text-[13px] text-muted-foreground">{i.details}</div> : null}
                  {!mine ? <div className="text-[12px] text-muted-foreground">Added by your coach</div> : null}
                </div>
                {mine && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`More for ${i.label}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => open({ item: i })}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void setResolved(i, true)}>{i.kind === "injury" ? "It's healed" : "Doesn't apply anymore"}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px]">Nothing on file. Add anything your coach should plan around.</p>
      )}

      <Button variant="outline" className="h-11 w-full gap-1.5" onClick={() => open({})} data-my-health-add>
        <Plus className="h-4 w-4" /> Add
      </Button>

      <HealthItemSheet
        clientId={clientId}
        mode="client"
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(id) => {
          refresh();
          if (id) fireAppEvent("health_updated", id);
        }}
      />
    </div>
  );
}
