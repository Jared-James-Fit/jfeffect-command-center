import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  listTaskDefinitions,
  listClientOverrides,
  upsertTaskDefinition,
  upsertTaskOverride,
  resetTaskOverride,
  type TaskDefinition,
  type TaskOverride,
} from "@/lib/action-centre.functions";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQ = ["weekly", "biweekly", "monthly", "custom_days", "daily", "manual"] as const;

type SchedShape = {
  enabled: boolean;
  frequency: (typeof FREQ)[number];
  interval_days: number | null;
  due_day_of_week: number | null;
  due_time_local: string;
  tz_mode: "client" | "coach" | "fixed";
  fixed_tz: string | null;
};

function baseFromDef(d: TaskDefinition): SchedShape {
  return {
    enabled: d.enabled,
    frequency: d.frequency,
    interval_days: d.interval_days,
    due_day_of_week: d.due_day_of_week,
    due_time_local: d.due_time_local?.slice(0, 5) ?? "23:59",
    tz_mode: d.tz_mode,
    fixed_tz: d.fixed_tz,
  };
}

function mergeOverride(d: TaskDefinition, o: TaskOverride | undefined): SchedShape {
  const base = baseFromDef(d);
  if (!o) return base;
  const pick = <K extends keyof SchedShape>(k: K, ov: unknown): SchedShape[K] =>
    (ov === null || ov === undefined ? base[k] : (ov as SchedShape[K]));
  return {
    enabled: pick("enabled", o.enabled),
    frequency: pick("frequency", o.frequency as any),
    interval_days: pick("interval_days", o.interval_days),
    due_day_of_week: pick("due_day_of_week", o.due_day_of_week),
    due_time_local: pick("due_time_local", o.due_time_local?.slice(0, 5)),
    tz_mode: pick("tz_mode", o.tz_mode as any),
    fixed_tz: pick("fixed_tz", o.fixed_tz),
  };
}

function ScheduleForm({
  value,
  onChange,
  disabled,
}: {
  value: SchedShape;
  onChange: (v: SchedShape) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof SchedShape>(k: K, v: SchedShape[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Enabled</Label>
          <div className="text-xs text-muted-foreground">Task appears in client Action Centre</div>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={disabled} />
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Frequency</Label>
        <Select value={value.frequency} onValueChange={(v) => set("frequency", v as any)} disabled={disabled}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FREQ.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {(value.frequency === "weekly" || value.frequency === "biweekly") && (
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Due day</Label>
          <Select
            value={String(value.due_day_of_week ?? 6)}
            onValueChange={(v) => set("due_day_of_week", Number(v))}
            disabled={disabled}
          >
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOW.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {value.frequency === "custom_days" && (
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Interval (days)</Label>
          <Input
            type="number" min={1} max={365}
            value={value.interval_days ?? 7}
            onChange={(e) => set("interval_days", Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            className="mt-1"
            disabled={disabled}
          />
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Due time (24h)</Label>
        <Input
          type="time"
          value={value.due_time_local}
          onChange={(e) => set("due_time_local", e.target.value || "23:59")}
          className="mt-1"
          disabled={disabled}
        />
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time zone</Label>
        <Select value={value.tz_mode} onValueChange={(v) => set("tz_mode", v as any)} disabled={disabled}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="client">Client local</SelectItem>
            <SelectItem value="coach">Coach (UTC)</SelectItem>
            <SelectItem value="fixed">Fixed IANA</SelectItem>
          </SelectContent>
        </Select>
        {value.tz_mode === "fixed" && (
          <Input
            placeholder="America/New_York"
            value={value.fixed_tz ?? ""}
            onChange={(e) => set("fixed_tz", e.target.value || null)}
            className="mt-2"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function DefinitionCard({ def }: { def: TaskDefinition }) {
  const qc = useQueryClient();
  const save = useServerFn(upsertTaskDefinition);
  const [draft, setDraft] = useState<SchedShape>(() => baseFromDef(def));
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseFromDef(def)), [draft, def]);

  const m = useMutation({
    mutationFn: () => save({ data: { task_type: def.task_type, ...draft } }),
    onSuccess: () => {
      toast.success(`${def.title} schedule saved`);
      qc.invalidateQueries({ queryKey: ["admin-task-defs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-bold">{def.title}</div>
          <div className="text-xs text-muted-foreground">{def.task_type}</div>
        </div>
        <Button size="sm" onClick={() => m.mutate()} disabled={!dirty || m.isPending}>
          {m.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
      <div className="mt-4">
        <ScheduleForm value={draft} onChange={setDraft} disabled={m.isPending} />
      </div>
    </Card>
  );
}

function OverrideCard({
  def, override, clientId,
}: {
  def: TaskDefinition;
  override: TaskOverride | undefined;
  clientId: string;
}) {
  const qc = useQueryClient();
  const save = useServerFn(upsertTaskOverride);
  const reset = useServerFn(resetTaskOverride);
  const hasOverride = !!override;
  const [enabled, setEnabled] = useState(hasOverride);
  const [draft, setDraft] = useState<SchedShape>(() => mergeOverride(def, override));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-client-overrides", clientId] });

  const saveM = useMutation({
    mutationFn: () => save({ data: { clientId, task_type: def.task_type, ...draft } }),
    onSuccess: () => { toast.success(`${def.title} override saved`); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const resetM = useMutation({
    mutationFn: () => reset({ data: { clientId, task_type: def.task_type } }),
    onSuccess: () => {
      toast.success(`${def.title} reset to default`);
      setEnabled(false);
      setDraft(baseFromDef(def));
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Reset failed"),
  });

  return (
    <Card className={cn("p-4", hasOverride && "border-primary/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold">{def.title}</div>
            {hasOverride && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                Custom
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{def.task_type}</div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Override</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>
      {enabled && (
        <>
          <div className="mt-4">
            <ScheduleForm value={draft} onChange={setDraft} disabled={saveM.isPending} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
              {saveM.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Save override
            </Button>
            {hasOverride && (
              <Button size="sm" variant="outline" onClick={() => resetM.mutate()} disabled={resetM.isPending}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to default
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

export function AdminCoachingSchedules() {
  const listDefs = useServerFn(listTaskDefinitions);
  const listOvers = useServerFn(listClientOverrides);
  const [clientId, setClientId] = useState<string>("");
  const [clientQuery, setClientQuery] = useState("");

  const { data: defs = [], isLoading: loadingDefs } = useQuery({
    queryKey: ["admin-task-defs"],
    queryFn: () => listDefs({ data: undefined as any }),
    staleTime: 30_000,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients-lite", clientQuery],
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name").order("full_name").limit(50);
      if (clientQuery.trim()) q = q.ilike("full_name", `%${clientQuery.trim()}%`);
      const { data } = await q;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
    staleTime: 30_000,
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["admin-client-overrides", clientId],
    enabled: !!clientId,
    queryFn: () => listOvers({ data: { clientId } }),
  });

  const overrideByType = useMemo(() => {
    const m = new Map<string, TaskOverride>();
    for (const o of overrides) m.set(o.task_type, o);
    return m;
  }, [overrides]);

  return (
    <div className="space-y-8 p-4 pb-24 md:p-6">
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-black">Global defaults</h2>
          <p className="text-xs text-muted-foreground">Every client uses these unless a per-client override exists.</p>
        </div>
        {loadingDefs ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {defs.map((d) => <DefinitionCard key={d.id} def={d} />)}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-black">Per-client overrides</h2>
          <p className="text-xs text-muted-foreground">Tune schedules for a specific athlete. Reset to fall back to defaults.</p>
        </div>
        <Card className="p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
            <Input
              placeholder="Search clients"
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
            />
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </Card>
        {clientId ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {defs.map((d) => (
              <OverrideCard key={d.id} def={d} override={overrideByType.get(d.task_type)} clientId={clientId} />
            ))}
          </div>
        ) : (
          <Card className="mt-3 p-6 text-center text-sm text-muted-foreground">
            Select a client to edit their overrides.
          </Card>
        )}
      </section>
    </div>
  );
}