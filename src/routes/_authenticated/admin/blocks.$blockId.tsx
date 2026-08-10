import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClientNameLink } from "@/components/clients/client-name-link";
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
  listClientBlocks,
} from "@/lib/pl-programs";
import { deriveBlockStatuses, blockStatusTone } from "@/lib/block-status";
import { cloneBlocksForRowsFn } from "@/lib/exercise-blocks.functions";
import type { ExerciseRef } from "@/components/program-builder";
import {
  StructureCanvas,
  appendRowToFirstDay,
} from "@/routes/_authenticated/admin/program-library_.$templateId";
import { BlockWarmupPanel } from "@/components/block-warmup-panel";
import { AutoSchedulePanel } from "@/components/auto-schedule-panel";
import { usePersistentUndoStack } from "@/lib/persistent-undo";
import { useScrollRestoration } from "@/lib/scroll-restore";
import { ClientBuilderIdentityHeader, ClientBuilderStickyChip } from "@/components/builder-identity-header";
import { BlockSwitcher } from "@/components/block-switcher";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/blocks/$blockId")({
  component: BlockEditor,
  // Surface the actual error inline instead of the router's generic
  // "Something went wrong loading this page" fallback. Coaches reporting
  // "the block won't open" need the underlying message + a working
  // back-to-clients link — not a bare Try again button.
  errorComponent: BlockEditorErrorFallback,
});

function BlockEditorErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  // eslint-disable-next-line no-console
  console.error("[block-editor] route error", error);
  return (
    <div className="mx-auto max-w-lg space-y-3 p-8 text-center">
      <h2 className="text-lg font-semibold">Couldn't open this block</h2>
      <p className="text-sm text-muted-foreground">
        {error?.message ?? "The block editor failed to load."}
      </p>
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          to="/admin/clients"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to clients
        </Link>
      </div>
    </div>
  );
}

// ---------- Tree ↔ payload adapters ----------

const ROW_FIELDS = [
  "exercise_id","exercise_name_override","sets","reps_text","rpe","rir",
  "percentage","percentage_basis","load_kg","load_lb","rest_seconds",
  "tempo","time_profile","notes",
  "manual_override","override_of_pct","load_unit","card_color",
  // Time-vs-reps prescription. Without these, toggling the Reps/Time
  // pill in the builder updates local state but the next save drops
  // measurement_type and duration_seconds, so the toggle silently reverts
  // back to reps on reload. The *_backup columns preserve the last value
  // entered in the inactive mode so flipping back restores it.
  "measurement_type","duration_seconds","tracking_type",
  "reps_text_backup","duration_seconds_backup",
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
            subtitle: d.subtitle ?? "",
            focus: d.focus ?? "",
            notes: d.notes ?? "",
            scheduled_date: d.scheduled_date ?? null,
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
async function applyPayloadDiff(blockId: string, originalTree: any, current: any, clientId?: string | null) {
  deduplicateDbIds(current);
  const original = treeToPayload(originalTree);
  const origWeeks: any[] = original.weeks_data;
  const curWeeks: any[] = current.weeks_data ?? [];

  // Slice 3 containment: collect every paste mapping
  // (source row id from the in-memory clipboard → freshly inserted dest row id)
  // so attached pl_exercise_blocks survive copy/paste. The mapping is applied
  // once at the very end via a single atomic two-pass RPC. Any per-row
  // `_sourceDbId` is cleared after a successful clone so re-saving never
  // duplicates blocks (idempotency: clone runs exactly once per paste).
  const blockCloneMappings: Array<{ source_row_id: string; dest_row_id: string; carrier: any }> = [];

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
        // Do NOT pre-seed the row's `title` with a generated "Day N" string —
        // Day labels are derived from position at render time. Preserve any
        // real coach-typed title only if it looks non-generic; otherwise keep
        // it NULL so the label stays clean on reload.
        const seedTitle = (cd.title ?? "").trim();
        const created = await addDayFn(cw._dbId, wantDayIdx, seedTitle || null);
        cd._dbId = created.id;
        od = { _dbId: created.id, day_index: created.day_index, title: created.title, subtitle: "", focus: "", notes: "", rows: [] };
        if (cd.subtitle || cd.focus || cd.notes || cd.scheduled_date) {
          await updateDay(created.id, {
            subtitle: cd.subtitle || null,
            focus: cd.focus || null,
            notes: cd.notes || null,
            scheduled_date: cd.scheduled_date || null,
          });
        }
      } else {
        const dPatch: any = {};
        if ((cd.title ?? "") !== (od?.title ?? "")) dPatch.title = cd.title || null;
        if ((cd.subtitle ?? "") !== (od?.subtitle ?? "")) dPatch.subtitle = cd.subtitle || null;
        if ((cd.focus ?? "") !== (od?.focus ?? "")) dPatch.focus = cd.focus || null;
        if ((cd.notes ?? "") !== (od?.notes ?? "")) dPatch.notes = cd.notes || null;
        if (wantDayIdx !== od?.day_index) dPatch.day_index = wantDayIdx;
        if (Object.keys(dPatch).length) await updateDay(cd._dbId, dPatch);
        // Training Date writes go through the canonical schedule sync
        // (instance-first + legacy mirror) so the editor, Schedule Manager,
        // and calendar can never desync. A direct pl_days write is IGNORED by
        // the calendar whenever an instance exists — that was the desync bug.
        if ((cd.scheduled_date ?? null) !== (od?.scheduled_date ?? null)) {
          if (clientId) {
            await syncProgramDaySchedule({
              data: { clientId, dayId: cd._dbId, newDate: cd.scheduled_date || null },
            });
          } else {
            await updateDay(cd._dbId, { scheduled_date: cd.scheduled_date || null });
          }
        }
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
          // If this row came from a copy/paste of a persisted source
          // row, queue a block clone for it. The clone runs after the
          // whole tree has been materialized so backoffs / refs that
          // point at sibling-copied rows resolve through the same map.
          if (cr._sourceDbId && typeof cr._sourceDbId === "string") {
            blockCloneMappings.push({
              source_row_id: cr._sourceDbId,
              dest_row_id: ins.id,
              carrier: cr,
            });
          }
        }
      }
    }
  }

  // Atomic two-pass block clone. SECURITY DEFINER + transactional, so a
  // single failure rolls back the entire block-copy step. The
  // pl_guard_block_save trigger still fires for each insert: pasting a
  // multi-block prescription into a client-visible program is rejected
  // with the slice-3 message, exactly as required.
  if (blockCloneMappings.length) {
    await cloneBlocksForRowsFn({
      data: {
        mappings: blockCloneMappings.map(({ source_row_id, dest_row_id }) => ({
          source_row_id,
          dest_row_id,
        })),
      },
    });
    // Idempotency: strip _sourceDbId now that the clone has succeeded.
    // A later save() with the same in-memory payload will see no
    // mappings and skip the RPC entirely.
    for (const m of blockCloneMappings) {
      delete (m.carrier as any)._sourceDbId;
    }
  }
}

function BlockEditor() {
  const { blockId } = Route.useParams();
  const qc = useQueryClient();

  const { data: tree, isLoading, error: treeError, refetch: refetchTree } = useQuery({
    queryKey: ["pl-block-tree", blockId],
    queryFn: () => getBlockTree(blockId),
    retry: 2,
  });
  // Surface the underlying error in the console so a coach who reports
  // "block won't open" can share the exact failure. Previously the block
  // page silently stuck on "Loading block…" whenever the tree fetch failed.
  useEffect(() => {
    if (treeError) {
      // eslint-disable-next-line no-console
      console.error("[block-editor] getBlockTree failed", { blockId, error: treeError });
    }
  }, [blockId, treeError]);
  const clientIdFromTree = tree?.block?.client_id ?? null;
  // Load the client identity + (optional) parent Program (prep) so the
  // header can show whose plan is being edited without any guessing.
  // Scoped per-block to avoid cross-client leakage when navigating routes.
  const { data: clientRow } = useQuery({
    queryKey: ["pl-block-client", blockId, clientIdFromTree],
    enabled: !!clientIdFromTree,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, status")
        .eq("id", clientIdFromTree as string)
        .maybeSingle();
      return data;
    },
  });
  const prepIdFromTree = (tree?.block as any)?.prep_id ?? null;
  const { data: prepRow } = useQuery({
    queryKey: ["pl-block-prep", blockId, prepIdFromTree],
    enabled: !!prepIdFromTree,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pl_preps")
        .select("id, title, client_id")
        .eq("id", prepIdFromTree)
        .maybeSingle();
      return data;
    },
  });
  const { data: exercises = [] } = useQuery<ExerciseRef[]>({
    queryKey: ["exercises-min"],
    queryFn: async () =>
      ((await supabase
        .from("exercises")
        .select("id, name, muscle_group, category, tags, equipment, exercise_category, is_competition_lift, competition_lift_type")
        .eq("archived", false)
        .limit(10000)
        .order("name")).data ?? []) as any,
    staleTime: 5 * 60_000,
  });
  // Sibling blocks for this client — shared cache key with BlockSwitcher —
  // used to derive the ONE canonical active block and per-block statuses so
  // the header + pills never show a stale/conflicting "Active" badge.
  const { data: siblingBlocks = [] } = useQuery({
    queryKey: ["pl-blocks", clientIdFromTree],
    queryFn: () => listClientBlocks(clientIdFromTree as string),
    enabled: !!clientIdFromTree,
    staleTime: 30_000,
  });
  const blockStatusMap = useMemo(() => deriveBlockStatuses(siblingBlocks as any[]), [siblingBlocks]);
  const canonicalActiveBlock = useMemo(
    () => (siblingBlocks as any[]).find((b) => blockStatusMap.get(b.id) === "Active") ?? null,
    [siblingBlocks, blockStatusMap],
  );

  const [name, setName] = useState<string>("");
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const originalTreeRef = useRef<any>(null);
  // Track WHICH block the editor is currently hydrated for. A boolean
  // "hydrated once" ref caused the block-tab switcher bug: switching to
  // a different block updated the URL param and refetched the new tree,
  // but this effect saw hydratedRef.current === true and refused to
  // rehydrate, so the editor kept rendering the previously-opened block.
  const hydratedBlockIdRef = useRef<string | null>(null);

  // Durable per-block undo/redo. Baseline = the block's server `updated_at`;
  // mismatches drop stale history without applying it. See persistent-undo.
  const undoStack = usePersistentUndoStack({
    scope: `block:${blockId}`,
    baseline: (tree?.block as any)?.updated_at ?? null,
    enabled: hydratedBlockIdRef.current === blockId,
  });
  const lastPushTs = useRef(0);

  // When the route param changes (block tab click, back/forward, deep link),
  // synchronously reset per-block editor state so we never briefly show the
  // previous block's rows as though they belonged to the new one. The
  // hydration effect below then rehydrates from the freshly-fetched tree.
  useEffect(() => {
    if (hydratedBlockIdRef.current && hydratedBlockIdRef.current !== blockId) {
      hydratedBlockIdRef.current = null;
      originalTreeRef.current = null;
      setPayload(null);
      setName("");
      setDirty(false);
    }
  }, [blockId]);

  useEffect(() => {
    if (tree && hydratedBlockIdRef.current !== tree.block.id) {
      originalTreeRef.current = tree;
      setName(tree.block.name ?? "");
      setPayload(treeToPayload(tree));
      setDirty(false);
      hydratedBlockIdRef.current = tree.block.id;
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

  // ── Canonical schedule status per day (editor ↔ calendar sync) ──
  // The calendar treats pl_scheduled_workouts instances as the source of
  // truth and pl_days.scheduled_date as a legacy fallback. These queries +
  // the resolver tell the editor what the calendar ACTUALLY shows per day.
  const editorDays = useMemo(() => {
    const out: Array<{ id: string; scheduled_date: string | null }> = [];
    for (const w of payload?.weeks_data ?? []) {
      for (const d of w.days ?? []) {
        if (d._dbId) out.push({ id: d._dbId, scheduled_date: d.scheduled_date ?? null });
      }
    }
    return out;
  }, [payload]);
  const editorDayIds = useMemo(() => editorDays.map((d) => d.id), [editorDays]);
  const { data: schedInstances = [] } = useQuery({
    queryKey: ["block-schedule-instances", blockId],
    enabled: !!clientIdFromTree && editorDayIds.length > 0,
    queryFn: async () =>
      ((
        await supabase
          .from("pl_scheduled_workouts")
          .select("id, source_day_id, scheduled_date")
          .eq("client_id", clientIdFromTree as string)
          .in("source_day_id", editorDayIds)
      ).data ?? []) as any[],
    staleTime: 15_000,
  });
  const { data: dayCompletions = [] } = useQuery({
    queryKey: ["block-day-completions", blockId],
    enabled: editorDayIds.length > 0,
    queryFn: async () =>
      ((
        await supabase
          .from("pl_day_completions")
          .select("day_id, scheduled_workout_id, completed_at")
          .in("day_id", editorDayIds)
      ).data ?? []) as any[],
    staleTime: 15_000,
  });
  const dayStatusMap = useMemo(
    () =>
      buildProgramScheduleStatus({
        days: editorDays,
        instances: schedInstances,
        completions: dayCompletions,
      }),
    [editorDays, schedInstances, dayCompletions],
  );
  const scheduleSummary = useMemo(
    () => summarizeProgramSchedule(dayStatusMap.values()),
    [dayStatusMap],
  );

  // One-click repair for a "Calendar Issue" badge: aligns the legacy mirror
  // to the canonical instance date. Updates both the server snapshot and the
  // local editor value so no phantom diff remains for the next save.
  const fixCalendarIssue = async (dayId: string) => {
    if (!clientIdFromTree) return;
    try {
      const res = await reconcileDayScheduleMirror({
        data: { clientId: clientIdFromTree, dayId },
      });
      if (!res.ok) {
        toast.error("No scheduled calendar entry found for this day.");
        return;
      }
      toast.success(`Aligned to the calendar date (${res.date}).`);
      setPayload((p: any) => {
        if (!p) return p;
        return {
          ...p,
          weeks_data: (p.weeks_data ?? []).map((w: any) => ({
            ...w,
            days: (w.days ?? []).map((d: any) =>
              d._dbId === dayId ? { ...d, scheduled_date: res.date } : d,
            ),
          })),
        };
      });
      if (originalTreeRef.current) {
        for (const w of originalTreeRef.current.weeks ?? []) {
          for (const d of w.days ?? []) {
            if (d.id === dayId) d.scheduled_date = res.date;
          }
        }
      }
      invalidateScheduleQueries(qc, { clientId: clientIdFromTree, blockId });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't fix this calendar issue.");
    }
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
    await applyPayloadDiff(blockId, originalTreeRef.current, payload, clientIdFromTree ?? null);
    // Refresh just the snapshot used for future diffs. Do NOT replace `payload`
    // here — that would re-render the entire builder mid-edit and bounce the
    // coach's scroll position / blur the active input.
    const fresh = await getBlockTree(blockId);
    if (fresh) originalTreeRef.current = fresh;
    // Invalidate sibling caches but skip the tree query — refetching it would
    // overwrite our in-memory payload via the hydration effect on the next mount.
    qc.invalidateQueries({ queryKey: ["pl-block-summary", blockId] });
    qc.invalidateQueries({ queryKey: ["client-assigned-programs"] });
    invalidateScheduleQueries(qc, { clientId: clientIdFromTree, blockId });
    setDirty(false);
  };

  const autosaveValue = useMemo(() => ({ name, payload }), [name, payload]);
  const autosave = useAutosave({
    key: `pl-block:${blockId}:editor`,
    value: autosaveValue,
    delay: 8000,
    enabled: hydratedBlockIdRef.current === blockId && dirty,
    onSave: async () => { await persist(); },
  });

  const save = async () => {
    // Safety guard: never let a stale save land on a different block than
    // the one currently loaded in the editor. If the hydrated block id
    // doesn't match the route param, skip — the next render will hydrate
    // the correct block and the coach can save there.
    if (hydratedBlockIdRef.current !== blockId) return;
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

  // Restore the coach's vertical scroll for this block. Scoped per
  // user + block id, gated on hydration so the saved position is meaningful.
  useScrollRestoration({
    key: `block:${blockId}`,
    ready: !!tree && !!payload,
  });

  if (treeError) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-8 text-center">
        <h2 className="text-lg font-semibold">Couldn't load this block</h2>
        <p className="text-sm text-muted-foreground">
          {(treeError as any)?.message ?? "The block data didn't load. This is usually a temporary connection issue."}
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => refetchTree()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            to="/admin/clients"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Back to clients
          </Link>
        </div>
      </div>
    );
  }
  if (!isLoading && tree === null) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-8 text-center">
        <h2 className="text-lg font-semibold">Block not found</h2>
        <p className="text-sm text-muted-foreground">
          This block has been deleted, or you don't have access to it.
        </p>
        <div className="flex justify-center">
          <Link
            to="/admin/clients"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Back to clients
          </Link>
        </div>
      </div>
    );
  }
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
  const clientName = clientRow?.full_name ?? "Loading client…";
  const programName = prepRow?.title ?? null;
  const editingStatus = blockStatusMap.get(blockId) ?? (tree.block as any).status ?? null;
  const editingNonActive =
    !!canonicalActiveBlock && canonicalActiveBlock.id !== blockId && !!editingStatus;

  return (
    <div className="space-y-2 p-2 md:p-3">
      <ClientBuilderIdentityHeader
        clientId={clientId}
        clientName={clientName}
        programName={programName}
        blockName={name || tree.block.name || "Block"}
        blockStatus={(tree.block as any).status ?? null}
        totalWeeks={totalWeeks}
        unsaved={dirty}
      />
      {/* Canonical status context: which block is active vs which is being
          edited, so stale DB statuses can't confuse the coach. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>
          Current active block:{" "}
          <span className="font-semibold text-foreground">
            {canonicalActiveBlock?.name ?? "None active"}
          </span>
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          Editing block:{" "}
          <span className="font-semibold text-foreground">{name || tree.block.name || "Block"}</span>
          {editingStatus && (
            <Badge variant="outline" className={`text-[10px] ${blockStatusTone(editingStatus)}`}>
              {editingStatus}
            </Badge>
          )}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          Scheduled:{" "}
          <span
            className={`font-semibold ${
              scheduleSummary.missingCount > 0 || scheduleSummary.issueCount > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
            }`}
          >
            {scheduleSummary.scheduledCount}/{scheduleSummary.totalDays}
          </span>
          {scheduleSummary.missingCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
              {scheduleSummary.missingCount} missing date{scheduleSummary.missingCount === 1 ? "" : "s"}
            </Badge>
          )}
          {scheduleSummary.issueCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
              {scheduleSummary.issueCount} calendar issue{scheduleSummary.issueCount === 1 ? "" : "s"}
            </Badge>
          )}
        </span>
      </div>
      {editingNonActive && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          You're editing a {String(editingStatus).toLowerCase()} block — this is not {clientName}'s active block yet.
          The active block is "{canonicalActiveBlock!.name}". Nothing here changes what the client trains from until
          this block is scheduled and becomes active. Editing is safe.
        </div>
      )}
      <div className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur md:-mx-3 md:px-3">
        <ClientNameLink clientId={clientId}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Back to client"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </ClientNameLink>
        <ClientBuilderStickyChip
          clientId={clientId}
          clientName={clientName}
          blockName={name || tree.block.name || "Block"}
        />
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          className="h-7 max-w-xs text-sm font-bold bg-builder-canvas"
          placeholder="Block name"
        />
        <span className="hidden md:inline text-[11px] text-muted-foreground whitespace-nowrap">
          block · {totalWeeks}w · {totalDays}d · {totalRows} rows
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
          {!dirty && autosave.savedAt ? (
            <span className="hidden text-[10px] text-muted-foreground md:inline">
              Saved to {clientName}'s Program
            </span>
          ) : null}
          <ActionButton
            onAction={save}
            loadingLabel="Saving…"
            successLabel="Saved"
            successToast={`Saved to ${clientName}'s Program`}
            icon={<Save className="h-3.5 w-3.5" />}
            size="sm"
            className="h-7 text-xs"
          >
            {dirty ? "Save now" : "Saved"}
          </ActionButton>
        </div>
      </div>
      <BlockSwitcher
        clientId={clientId}
        currentBlockId={blockId}
        statusMap={blockStatusMap}
        hasUnsavedChanges={dirty}
        currentBlockName={name || tree.block.name || "this block"}
        onBeforeNavigate={save}
        onDiscardUnsaved={() => {
          // Rehydrate from the last-loaded server snapshot so unsaved
          // local edits are dropped without touching the database. The
          // hydration effect will re-run for the new blockId on navigate.
          if (originalTreeRef.current) {
            setPayload(treeToPayload(originalTreeRef.current));
            setName(originalTreeRef.current.block?.name ?? "");
          }
          setDirty(false);
        }}
      />

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
        dayScheduleStatus={dayStatusMap}
        onFixCalendarIssue={fixCalendarIssue}
      />

      <AutoSchedulePanel blockId={blockId} />
      <BlockWarmupPanel blockId={blockId} />
    </div>
  );
}