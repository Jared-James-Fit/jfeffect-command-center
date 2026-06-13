import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { ActionButton } from "@/components/action-button";
import {
  getBlockTree, updateBlock, addWeek as addWeekFn, deleteWeek, addDay as addDayFn, updateDay,
  deleteDay, updateRow, deleteRow,
} from "@/lib/pl-programs";
import type { ExerciseRef } from "@/components/program-builder";
import {
  StructureCanvas,
  appendRowToFirstDay,
} from "@/routes/_authenticated/admin/program-library_.$templateId";
import { BlockWarmupPanel } from "@/components/block-warmup-panel";
import { AutoSchedulePanel } from "@/components/auto-schedule-panel";
import { usePersistentUndoStack } from "@/lib/persistent-undo";
import { useScrollRestoration } from "@/lib/scroll-restore";

export const Route = createFileRoute("/_authenticated/admin/blocks/$blockId")({ component: BlockEditor });

// ---------- Tree ↔ payload adapters ----------

const ROW_FIELDS = [
  "exercise_id","exercise_name_override","sets","reps_text","rpe","rir",
  "percentage","percentage_basis","load_kg","load_lb","rest_seconds",
  "tempo","time_profile","notes",
  "manual_override","override_of_pct","load_unit","card_color",
] as const;

function treeToPayload(tree: any) {
  const weeks = (tree.weeks ?? []).slice().sort((a: any, b: any) => a.week_index - b.week_index);
  return {
    weeks_data: weeks.map((w: any) => {
      const days = (tree.days ?? [])
        .filter((d: any) => d.week_id === w.id)
        .slice()
        .sort((a: any, b: any) => a.day_index - b.day_index);
      return {
        _dbId: w.id,
        week_index: w.week_index,
        notes: w.notes ?? "",
        days: days.map((d: any) => {
          const rows = (tree.rows ?? [])
            .filter((r: any) => r.day_id === d.id)
            .slice()
            .sort((a: any, b: any) => a.sort_order - b.sort_order);
          return {
            _dbId: d.id,
            day_index: d.day_index,
            title: d.title ?? "",
            focus: d.focus ?? "",
            notes: d.notes ?? "",
            rows: rows.map((r: any) => {
              const out: any = { _dbId: r.id, sort_order: r.sort_order };
              for (const k of ROW_FIELDS) out[k] = r[k];
              return out;
            }),
          };
        }),
      };
    }),
  };
}

/** Strip any duplicate _dbIds so duplicates are treated as fresh inserts. */
function deduplicateDbIds(payload: any) {
  const seenW = new Set<string>();
  const seenD = new Set<string>();
  const seenR = new Set<string>();
  for (const w of payload.weeks_data ?? []) {
    if (w._dbId && seenW.has(w._dbId)) delete w._dbId;
    if (w._dbId) seenW.add(w._dbId);
    for (const d of w.days ?? []) {
      if (d._dbId && seenD.has(d._dbId)) delete d._dbId;
      if (d._dbId) seenD.add(d._dbId);
      for (const r of d.rows ?? []) {
        if (r._dbId && seenR.has(r._dbId)) delete r._dbId;
        if (r._dbId) seenR.add(r._dbId);
      }
    }
  }
}

/**
 * Non-destructive diff + apply. Preserves DB ids (and the per-row completion
 * history) whenever possible. Mutates `current` so newly-inserted entities get
 * their fresh `_dbId` attached.
 */
async function applyPayloadDiff(blockId: string, originalTree: any, current: any) {
  deduplicateDbIds(current);
  const original = treeToPayload(originalTree);
  const origWeeks: any[] = original.weeks_data;
  const curWeeks: any[] = current.weeks_data ?? [];

  // Delete weeks the user removed
  const keepWeekIds = new Set(curWeeks.filter((w) => w._dbId).map((w) => w._dbId));
  for (const ow of origWeeks) {
    if (!keepWeekIds.has(ow._dbId)) await deleteWeek(ow._dbId);
  }

  for (let i = 0; i < curWeeks.length; i++) {
    const cw = curWeeks[i];
    const wantIdx = i + 1;
    let ow = cw._dbId ? origWeeks.find((o) => o._dbId === cw._dbId) : undefined;

    if (!cw._dbId) {
      const created = await addWeekFn(blockId);
      cw._dbId = created.id;
      // addWeek seeds a default day — remove it so we apply the user's own days below.
      await supabase.from("pl_days").delete().eq("week_id", created.id);
      ow = { _dbId: created.id, week_index: created.week_index, notes: "", days: [] };
    }

    // Update week metadata if changed
    const wPatch: any = {};
    if ((cw.notes ?? "") !== (ow?.notes ?? "")) wPatch.notes = cw.notes || null;
    if (wantIdx !== ow?.week_index) wPatch.week_index = wantIdx;
    if (Object.keys(wPatch).length) {
      await supabase.from("pl_weeks").update(wPatch).eq("id", cw._dbId);
    }

    // DAYS within this week
    const owDays: any[] = ow?.days ?? [];
    const cwDays: any[] = cw.days ?? [];
    const keepDayIds = new Set(cwDays.filter((d) => d._dbId).map((d) => d._dbId));
    for (const od of owDays) {
      if (!keepDayIds.has(od._dbId)) await deleteDay(od._dbId);
    }

    for (let j = 0; j < cwDays.length; j++) {
      const cd = cwDays[j];
      const wantDayIdx = j + 1;
      let od = cd._dbId ? owDays.find((o) => o._dbId === cd._dbId) : undefined;

      if (!cd._dbId) {
        const created = await addDayFn(cw._dbId, wantDayIdx, cd.title || `Day ${wantDayIdx}`);
        cd._dbId = created.id;
        od = { _dbId: created.id, day_index: created.day_index, title: created.title, focus: "", notes: "", rows: [] };
        if (cd.focus || cd.notes) {
          await updateDay(created.id, { focus: cd.focus || null, notes: cd.notes || null });
        }
      } else {
        const dPatch: any = {};
        if ((cd.title ?? "") !== (od?.title ?? "")) dPatch.title = cd.title || null;
        if ((cd.focus ?? "") !== (od?.focus ?? "")) dPatch.focus = cd.focus || null;
        if ((cd.notes ?? "") !== (od?.notes ?? "")) dPatch.notes = cd.notes || null;
        if (wantDayIdx !== od?.day_index) dPatch.day_index = wantDayIdx;
        if (Object.keys(dPatch).length) await updateDay(cd._dbId, dPatch);
      }

      // ROWS within this day
      const odRows: any[] = od?.rows ?? [];
      const cdRows: any[] = cd.rows ?? [];
      const keepRowIds = new Set(cdRows.filter((r) => r._dbId).map((r) => r._dbId));
      for (const orr of odRows) {
        if (!keepRowIds.has(orr._dbId)) await deleteRow(orr._dbId);
      }

      for (let k = 0; k < cdRows.length; k++) {
        const cr = cdRows[k];
        const desired: any = { sort_order: k };
        for (const f of ROW_FIELDS) desired[f] = cr[f] ?? null;
        if (!desired.time_profile) desired.time_profile = "accessory_compound";

        if (cr._dbId) {
          const orr = odRows.find((o) => o._dbId === cr._dbId);
          const patch: any = {};
          for (const [k2, v] of Object.entries(desired)) {
            if ((orr as any)?.[k2] !== v) patch[k2] = v;
          }
          if (Object.keys(patch).length) await updateRow(cr._dbId, patch);
        } else {
          const { data: ins, error } = await supabase
            .from("pl_exercise_rows")
            .insert({ day_id: cd._dbId, ...desired })
            .select("id")
            .single();
          if (error) throw error;
          cr._dbId = ins.id;
        }
      }
    }
  }
}

function BlockEditor() {
  const { blockId } = Route.useParams();
  const qc = useQueryClient();

  const { data: tree, isLoading } = useQuery({
    queryKey: ["pl-block-tree", blockId],
    queryFn: () => getBlockTree(blockId),
  });
  const { data: exercises = [] } = useQuery<ExerciseRef[]>({
    queryKey: ["exercises-min"],
    queryFn: async () =>
      ((await supabase
        .from("exercises")
        .select("id, name, muscle_group, category, tags, equipment, exercise_category, is_competition_lift, competition_lift_type")
        .order("name")).data ?? []) as any,
  });

  const [name, setName] = useState<string>("");
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const originalTreeRef = useRef<any>(null);
  const hydratedRef = useRef(false);

  // Durable per-block undo/redo. Baseline = the block's server `updated_at`;
  // mismatches drop stale history without applying it. See persistent-undo.
  const undoStack = usePersistentUndoStack({
    scope: `block:${blockId}`,
    baseline: (tree?.block as any)?.updated_at ?? null,
    enabled: hydratedRef.current,
  });
  const lastPushTs = useRef(0);

  useEffect(() => {
    if (tree && !hydratedRef.current) {
      originalTreeRef.current = tree;
      setName(tree.block.name ?? "");
      setPayload(treeToPayload(tree));
      hydratedRef.current = true;
    }
  }, [tree]);

  const setP = (next: any, opts?: { skipHistory?: boolean }) => {
    if (!opts?.skipHistory && payload != null) {
      const now = Date.now();
      if (now - lastPushTs.current > 600) {
        undoStack.pushSnapshot(JSON.stringify(payload));
      }
      lastPushTs.current = now;
    }
    setPayload(next);
    setDirty(true);
  };
  const undo = () => {
    if (payload == null) return;
    const prev = undoStack.undo(JSON.stringify(payload));
    if (!prev) return;
    setPayload(JSON.parse(prev));
    setDirty(true);
    lastPushTs.current = 0;
  };
  const redo = () => {
    if (payload == null) return;
    const next = undoStack.redo(JSON.stringify(payload));
    if (!next) return;
    setPayload(JSON.parse(next));
    setDirty(true);
    lastPushTs.current = 0;
  };

  const persist = async () => {
    if (!payload) return;
    // Update name first
    if (tree?.block && name !== tree.block.name) {
      await updateBlock(blockId, { name });
    }
    // Apply structural diff. `applyPayloadDiff` mutates `payload` in place to
    // attach fresh _dbIds to any newly-inserted weeks/days/rows, so we don't
    // need to swap the payload reference afterwards — keeping the same object
    // identity preserves scroll position, input focus, and prevents the editor
    // from re-rendering every cell after autosave.
    await applyPayloadDiff(blockId, originalTreeRef.current, payload);
    // Refresh just the snapshot used for future diffs. Do NOT replace `payload`
    // here — that would re-render the entire builder mid-edit and bounce the
    // coach's scroll position / blur the active input.
    const fresh = await getBlockTree(blockId);
    if (fresh) originalTreeRef.current = fresh;
    // Invalidate sibling caches but skip the tree query — refetching it would
    // overwrite our in-memory payload via the hydration effect on the next mount.
    qc.invalidateQueries({ queryKey: ["pl-block-summary", blockId] });
    qc.invalidateQueries({ queryKey: ["client-assigned-programs"] });
    setDirty(false);
  };

  const autosaveValue = useMemo(() => ({ name, payload }), [name, payload]);
  const autosave = useAutosave({
    key: `pl-block:${blockId}:editor`,
    value: autosaveValue,
    delay: 8000,
    enabled: hydratedRef.current && dirty,
    onSave: async () => { await persist(); },
  });

  const save = async () => {
    // Manual save: if there are pending autosave changes, flush() will run
    // the autosave's onSave (which already calls persist()) exactly once.
    // Otherwise nothing is pending and we still want to persist current
    // local state (e.g. just clicked Save without typing). Never do both —
    // that would issue two full persist() flows and race the IDs returned
    // from the first insert against the second.
    if (autosave.hasPending()) {
      await autosave.flush();
    } else {
      await persist();
    }
  };

  if (isLoading || !tree || !payload) {
    return <div className="p-8 text-sm text-muted-foreground">Loading block…</div>;
  }

  const clientId = tree.block.client_id;
  const totalWeeks = payload.weeks_data?.length ?? 0;
  const totalDays = (payload.weeks_data ?? []).reduce((n: number, w: any) => n + (w.days?.length ?? 0), 0);
  const totalRows = (payload.weeks_data ?? []).reduce((n: number, w: any) =>
    n + (w.days ?? []).reduce((m: number, d: any) => m + (d.rows?.length ?? 0), 0), 0);

  const canUndo = undoStack.canUndo;
  const canRedo = undoStack.canRedo;

  return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur md:-mx-3 md:px-3">
        <Link
          to="/admin/clients/$id"
          params={{ id: clientId }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Client
        </Link>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          className="h-7 max-w-xs text-sm font-bold"
          placeholder="Block name"
        />
        <span className="hidden md:inline text-[11px] text-muted-foreground whitespace-nowrap">
          block · {totalWeeks}w · {totalDays}d · {totalRows} rows
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
          <ActionButton
            onAction={save}
            loadingLabel="Saving…"
            successLabel="Saved"
            successToast="Block saved"
            icon={<Save className="h-3.5 w-3.5" />}
            size="sm"
            className="h-7 text-xs"
          >
            {dirty ? "Save now" : "Saved"}
          </ActionButton>
        </div>
      </div>

      <StructureCanvas
        type="block"
        payload={payload}
        setP={(next: any, opts?: { skipHistory?: boolean }) => {
          // StructureCanvas calls setP with whole payload object — keep our wrapper signature.
          setP(next, opts);
        }}
        exercises={exercises as any[]}
        appendRowToFirstDay={appendRowToFirstDay}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        clientId={clientId}
        blockId={blockId}
      />

      <AutoSchedulePanel blockId={blockId} />
      <BlockWarmupPanel blockId={blockId} />
    </div>
  );
}