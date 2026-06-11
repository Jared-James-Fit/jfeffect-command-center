import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { WarmupPicker, WARMUP_PRIORITY_NOTE, type WarmupMode } from "@/components/warmup-picker";
import { listWarmupProtocols } from "@/lib/warmups";

const sb = supabase as any;

type Day = {
  id: string;
  title: string | null;
  day_index: number;
  week_id: string;
  warmup_mode: string | null;
  warmup_protocol_id: string | null;
};

type Week = { id: string; week_index: number };

/**
 * Block-level warm-up picker + per-day warm-up overrides.
 * Renders inside the block editor (or anywhere a block id is known).
 */
export function BlockWarmupPanel({ blockId }: { blockId: string }) {
  const qc = useQueryClient();

  const { data: block } = useQuery({
    queryKey: ["block-warmup", blockId],
    queryFn: async () =>
      (await sb.from("pl_blocks").select("id, name, warmup_protocol_id").eq("id", blockId).maybeSingle()).data,
  });

  const { data: weeks = [] } = useQuery<Week[]>({
    queryKey: ["block-weeks-warmup", blockId],
    queryFn: async () =>
      ((await sb.from("pl_weeks").select("id, week_index").eq("block_id", blockId).order("week_index")).data ?? []) as Week[],
  });

  const weekIds = useMemo(() => weeks.map((w) => w.id), [weeks]);
  const { data: days = [] } = useQuery<Day[]>({
    queryKey: ["block-days-warmup", blockId, weekIds.join(",")],
    enabled: weekIds.length > 0,
    queryFn: async () =>
      ((await sb
        .from("pl_days")
        .select("id, title, day_index, week_id, warmup_mode, warmup_protocol_id")
        .in("week_id", weekIds)
        .order("day_index")).data ?? []) as Day[],
  });

  const { data: protocols = [] } = useQuery({
    queryKey: ["warmup-protocols-min"],
    queryFn: () => listWarmupProtocols(),
    staleTime: 60_000,
  });
  const protoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of protocols) m.set(p.id, p.name);
    return m;
  }, [protocols]);

  // Block-level state
  const [blockMode, setBlockMode] = useState<WarmupMode>("default");
  const [blockProtocolId, setBlockProtocolId] = useState<string | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);

  useEffect(() => {
    if (!block) return;
    if (block.warmup_protocol_id) {
      setBlockMode("custom");
      setBlockProtocolId(block.warmup_protocol_id);
    } else {
      setBlockMode("default");
      setBlockProtocolId(null);
    }
  }, [block?.warmup_protocol_id]);

  const saveBlock = async () => {
    setSavingBlock(true);
    const { error } = await sb
      .from("pl_blocks")
      .update({ warmup_protocol_id: blockMode === "custom" ? blockProtocolId : null })
      .eq("id", blockId);
    setSavingBlock(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Block warm-up saved");
      qc.invalidateQueries({ queryKey: ["block-warmup", blockId] });
    }
  };

  const saveDay = async (dayId: string, mode: WarmupMode, protocolId: string | null) => {
    // Map UI mode to DB warmup_mode value
    const dbMode =
      mode === "block" ? "auto" // we treat "block" as inherit → store as auto; resolver will fall through to block
        : mode === "default" ? "auto"
        : mode;
    const { error } = await sb
      .from("pl_days")
      .update({
        warmup_mode: dbMode,
        warmup_protocol_id: mode === "custom" ? protocolId : null,
      })
      .eq("id", dayId);
    if (error) toast.error(error.message);
    else {
      toast.success("Day warm-up saved");
      qc.invalidateQueries({ queryKey: ["block-days-warmup", blockId] });
    }
  };

  return (
    <Card className="border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <h3 className="font-bold">Warm-Up Settings</h3>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Block-level</div>
        <WarmupPicker
          label="Block Warm-Up Protocol"
          mode={blockMode}
          protocolId={blockProtocolId}
          onChange={({ mode, protocolId }) => {
            setBlockMode(mode);
            setBlockProtocolId(protocolId);
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={saveBlock} disabled={savingBlock || (blockMode === "custom" && !blockProtocolId)}>
            {savingBlock ? "Saving…" : "Save block"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Per-Day Overrides</div>
        {weeks.length === 0 ? (
          <div className="text-xs text-muted-foreground">No weeks yet.</div>
        ) : (
          weeks.map((w) => {
            const dayList = days.filter((d) => d.week_id === w.id);
            return (
              <div key={w.id} className="rounded-md border border-border p-2 space-y-2">
                <div className="text-xs font-bold">Week {w.week_index}</div>
                {dayList.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No days.</div>
                ) : (
                  dayList.map((d) => (
                    <DayRow
                      key={d.id}
                      day={d}
                      protoName={d.warmup_protocol_id ? protoNameById.get(d.warmup_protocol_id) ?? null : null}
                      onSave={saveDay}
                    />
                  ))
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">{WARMUP_PRIORITY_NOTE}</p>
    </Card>
  );
}

function DayRow({
  day,
  protoName,
  onSave,
}: {
  day: Day;
  protoName: string | null;
  onSave: (dayId: string, mode: WarmupMode, protocolId: string | null) => Promise<void>;
}) {
  // Map DB warmup_mode → UI mode
  const initialMode: WarmupMode = day.warmup_protocol_id
    ? "custom"
    : (day.warmup_mode as WarmupMode) === "general"
    ? "general"
    : (day.warmup_mode as WarmupMode) === "powerlifting"
    ? "powerlifting"
    : (day.warmup_mode as WarmupMode) === "none"
    ? "none"
    : "auto";

  const [mode, setMode] = useState<WarmupMode>(initialMode);
  const [protocolId, setProtocolId] = useState<string | null>(day.warmup_protocol_id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const summary =
    mode === "custom" ? `Custom — ${protoName ?? "pick a protocol"}` :
    mode === "general" ? "Default General" :
    mode === "powerlifting" ? "Default Powerlifting" :
    mode === "none" ? "No Warm-Up" :
    mode === "block" ? "Use Block Warm-Up" :
    "Auto-detect";

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-medium">Day {day.day_index} · {day.title ?? `Day ${day.day_index}`}</span>
        <Badge variant="outline" className="text-[10px]">Warm-Up: {summary}</Badge>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <WarmupPicker
            label="Warm-Up Mode"
            mode={mode}
            protocolId={protocolId}
            onChange={(v) => {
              setMode(v.mode);
              setProtocolId(v.protocolId);
            }}
            includeAuto
            includeInheritBlock
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={busy || (mode === "custom" && !protocolId)}
              onClick={async () => {
                setBusy(true);
                await onSave(day.id, mode, protocolId);
                setBusy(false);
              }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save day"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}