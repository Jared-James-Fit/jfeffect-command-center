/**
 * The client's Cardio tab (Nov 23 2026): its own coaching system beside
 * Nutrition, connected to nutrition and training through one client read. The
 * overview first (what's planned, what's done, the recovery and performance
 * read, quality, charts, history), the builder one tap away, and Cleo docked
 * beside both. The coach's draft lives here and is saved as they go; nothing
 * reaches the client until they publish. Before the workspace's tables exist
 * on a database, the classic cardio editor stands in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { CleoDockFrame, DockBrief, useCleoDock } from "@/components/program-ai/cleo-dock";
import { PlanIntelligence } from "@/components/plan-quality/plan-intelligence";
import { CardioTargetsPanel } from "@/components/cardio-targets-panel";
import { CardioOverview } from "@/components/cardio/cardio-overview";
import { CardioBuilder, type PublishInput } from "@/components/cardio/cardio-builder";
import { CardioCleoPanel } from "@/components/cardio/cardio-cleo-panel";
import { discardCardioDraftFn, getCardioWorkspaceFn, publishCardioPlanFn, restoreCardioVersionFn, saveCardioDraftFn } from "@/lib/cardio/cardio.functions";
import { cleanPlan, daysWords, sessionLine, type CardioPlan } from "@/lib/cardio/plan";
import { scoreCardioPlan } from "@/lib/cardio/quality";
import { prefillPlanAiChange } from "@/lib/weight-management/handoff";
import type { CardioWorkspaceView } from "@/lib/cardio/types";
import type { SpeedUnit } from "@/lib/weight-management/units";

export const cardioWorkspaceKey = (clientId: string) => ["cardio-workspace", clientId] as const;

/** Undo / Redo over the draft; quick edits to the same field fold into one step. */
function useDraftHistory(initial: CardioPlan) {
  const [state, setState] = useState<{ past: CardioPlan[]; present: CardioPlan; future: CardioPlan[] }>({ past: [], present: initial, future: [] });
  const last = useRef<{ tag: string; at: number } | null>(null);
  const set = useCallback((next: CardioPlan, tag = "edit") => {
    const now = Date.now();
    const fold = last.current && last.current.tag === tag && now - last.current.at < 900 && tag !== "edit";
    last.current = { tag, at: now };
    setState((s) => ({ past: fold ? s.past : [...s.past, s.present].slice(-60), present: next, future: [] }));
  }, []);
  const reset = useCallback((p: CardioPlan) => {
    last.current = null;
    setState({ past: [], present: p, future: [] });
  }, []);
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  return { plan: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function CardioWorkspace({ clientId }: { clientId: string }) {
  const read = useServerFn(getCardioWorkspaceFn);
  const q = useQuery({ queryKey: cardioWorkspaceKey(clientId), queryFn: () => read({ data: { clientId } }), staleTime: 30_000 });
  if (q.isLoading) {
    return (
      <div className="space-y-4" data-cardio-loading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-[14px]">
        <p className="font-medium">Couldn't load their cardio.</p>
        <p className="mt-1 text-muted-foreground">{(q.error as any)?.message ?? "Try again in a moment."}</p>
        <button type="button" className="mt-2 cursor-pointer text-[13px] font-medium underline-offset-2 hover:underline" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!q.data.available) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-border px-3 py-2 text-[13px] text-muted-foreground">The cardio builder is being set up on this database. Until then, edit cardio here.</p>
        <CardioTargetsPanel clientId={clientId} />
      </div>
    );
  }
  return <Workspace view={q.data} refetch={() => q.refetch()} />;
}

function Workspace({ view, refetch }: { view: CardioWorkspaceView; refetch: () => Promise<unknown> }) {
  const clientId = view.clientId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cleo = useCleoAccess();
  const dock = useCleoDock();
  const save = useServerFn(saveCardioDraftFn);
  const discard = useServerFn(discardCardioDraftFn);
  const publish = useServerFn(publishCardioPlanFn);
  const restore = useServerFn(restoreCardioVersionFn);

  const startPlan = useMemo(() => view.draft?.plan ?? view.pending?.plan ?? view.live, [view]);
  const liveQuality = useMemo(() => scoreCardioPlan(view.live, view.scoreCtx), [view]);
  const history = useDraftHistory(startPlan);
  const [mode, setMode] = useState<"overview" | "builder">("overview");
  const [unit, setUnit] = useState<SpeedUnit>(view.speedUnit);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(view.draft?.effectiveDate ?? view.pending?.effective ?? null);
  const [note, setNote] = useState(view.draft?.note ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(view.draft ? "saved" : "idle");
  const [publishing, setPublishing] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [source, setSource] = useState<"coach" | "cleo" | "restore">("coach");
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const dirty = useRef(false);

  // a fresh read (after publishing, restoring) starts the draft from it
  const seenBase = useRef(view.baseHash + (view.draft?.updatedAt ?? ""));
  useEffect(() => {
    const key = view.baseHash + (view.draft?.updatedAt ?? "");
    if (key === seenBase.current || dirty.current) return;
    seenBase.current = key;
    history.reset(view.draft?.plan ?? view.pending?.plan ?? view.live);
    setEffectiveDate(view.draft?.effectiveDate ?? view.pending?.effective ?? null);
    setNote(view.draft?.note ?? "");
  }, [view, history]);

  const setPlan = useCallback(
    (next: CardioPlan, tag?: string) => {
      dirty.current = true;
      history.set(next, tag);
    },
    [history],
  );

  // the draft is saved as the coach goes (never reaching the client)
  useEffect(() => {
    if (!dirty.current) return;
    setSaveState("saving");
    const t = window.setTimeout(async () => {
      try {
        await save({ data: { clientId, sessions: history.plan.sessions as any, effectiveDate, note: note || null, baseHash: view.baseHash } });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [history.plan, effectiveDate, note, clientId, save, view.baseHash]);

  // ⌘Z / ⇧⌘Z in the builder (never while typing in a box)
  useEffect(() => {
    if (mode !== "builder") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, history]);

  const refresh = async () => {
    dirty.current = false;
    await refetch();
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["weight-management", clientId] });
    qc.invalidateQueries({ queryKey: ["cal-client-cardio", clientId] });
    qc.invalidateQueries({ queryKey: ["client-cardio-resolved", clientId] });
    qc.invalidateQueries({ queryKey: ["week-sched-data"] });
    qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
  };

  const ask = (text?: string) => {
    dock.ask(text);
  };

  const draftScore = useMemo(() => (view.draft ? scoreCardioPlan(history.plan, view.scoreCtx).score : null), [view.draft, view.scoreCtx, history.plan]);

  const onPublish = async (x: PublishInput) => {
    setPublishing(true);
    try {
      const quality = scoreCardioPlan(history.plan, view.scoreCtx);
      const res = await publish({
        data: {
          clientId,
          sessions: history.plan.sessions as any,
          effectiveDate: x.effectiveDate,
          note: x.note || null,
          source,
          restoredFrom,
          baseHash: view.baseHash,
          quality: { score: quality.score, confidence: quality.confidence },
          notify: x.notify,
        },
      });
      if (res.unchanged) toast("Nothing to publish: the draft is the plan in force.");
      else
        toast.success(
          `${res.scheduled ? `Cardio plan scheduled from ${res.effective}` : "Cardio plan is live"}${res.messaged ? ` · ${view.firstName} got a message` : ""}`,
        );
      setSource("coach");
      setRestoredFrom(null);
      setMode("overview");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  };

  const onDiscard = async () => {
    if (!confirm("Discard this draft? The plan in force stays exactly as it is.")) return;
    try {
      await discard({ data: { clientId } });
      dirty.current = false;
      history.reset(view.pending?.plan ?? view.live);
      setNote("");
      setEffectiveDate(view.pending?.effective ?? null);
      setSaveState("idle");
      setMode("overview");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't discard the draft");
    }
  };

  const onRestore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      const r = await restore({ data: { clientId, versionId } });
      dirty.current = false;
      history.set(cleanPlan(r.plan.sessions, view.ctx), "restore");
      setNote(`Restored from version ${r.versionNo}`);
      setSource("restore");
      setRestoredFrom(versionId);
      setMode("builder");
      toast.success(`Version ${r.versionNo} is on your draft. Review it, then publish.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't restore that version");
    } finally {
      setRestoring(null);
    }
  };

  const cleoPanel = (
    <CleoDockFrame dock={dock} name={cleo ? "Cleo" : "Adjust cardio"} subtitle={`Cardio · ${view.firstName}`} branded={cleo}>
      <DockBrief dock={dock} />
      <CardioCleoPanel
        scorePlan={(p) => scoreCardioPlan(p, view.scoreCtx).score}
        clientId={clientId}
        firstName={view.firstName}
        draft={history.plan}
        seed={dock.seed}
        history={view.proposals}
        onApply={(plan) => {
          setPlan(plan, "cleo");
          setSource("cleo");
          setMode("builder");
        }}
        onNutritionNote={(n) => {
          navigate({ to: "/admin/clients/$id", params: { id: clientId }, search: { tab: "nutrition" } as any }).then(() => window.setTimeout(() => prefillPlanAiChange(clientId, n), 400));
        }}
      />
    </CleoDockFrame>
  );

  return (
    <div className="min-w-0 space-y-4" data-builder-page data-cardio-workspace>
      {mode === "overview" && (
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Cardio</h2>
          <span className="text-[13px] text-muted-foreground">{view.wmHeadline}</span>
        </div>
      )}
      {mode === "overview" && (
        <PlanIntelligence
          domain="cardio"
          clientKey={clientId}
          quality={liveQuality}
          cleo={cleo}
          draft={view.draft ? { score: draftScore, label: "Draft" } : null}
          onOptimize={(q) => dock.optimize({ domain: "cardio", what: "cardio plan", quality: q })}
          onAskCleo={() => dock.ask()}
        />
      )}
      {mode === "overview" ? (
        <CardioOverview
          view={view}
          onEdit={() => setMode("builder")}
          onAsk={(a) => {
            ask(a);
          }}
          onRestore={(id) => void onRestore(id)}
          restoring={restoring}
          legacy={view.programs.length ? <CardioTargetsPanel clientId={clientId} /> : undefined}
        />
      ) : (
        <CardioBuilder
          view={view}
          plan={history.plan}
          setPlan={setPlan}
          undo={history.undo}
          redo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          unit={unit}
          setUnit={setUnit}
          effectiveDate={effectiveDate}
          setEffectiveDate={(d) => {
            dirty.current = true;
            setEffectiveDate(d);
          }}
          note={note}
          setNote={(n) => {
            dirty.current = true;
            setNote(n);
          }}
          saveState={saveState}
          onBack={() => setMode("overview")}
          onDiscard={() => void onDiscard()}
          onPublish={onPublish}
          publishing={publishing}
          dock={dock}
          onAskCleo={(a) => ask(a)}
        />
      )}
      {cleoPanel}
    </div>
  );
}

/**
 * The Clients list's quick look at cardio: what's in force and one tap to the Cardio tab, where it's
 * changed (drafted, reviewed and published with its history), never edited live from a list.
 */
export function CardioQuickView({ clientId }: { clientId: string }) {
  const read = useServerFn(getCardioWorkspaceFn);
  const q = useQuery({ queryKey: cardioWorkspaceKey(clientId), queryFn: () => read({ data: { clientId } }), staleTime: 30_000 });
  if (q.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const view = q.data;
  return (
    <div className="space-y-3" data-cardio-quick-view>
      {view?.live.sessions.length ? (
        <ul className="space-y-2">
          {view.live.sessions.map((s) => (
            <li key={s.key} className="rounded-xl border border-border px-3 py-2.5">
              <p className="text-[14px] font-medium">{sessionLine(s, view.speedUnit)}</p>
              <p className="text-[12px] text-muted-foreground">{daysWords(s, view.ctx)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted-foreground">No cardio set.</p>
      )}
      {view && <p className="text-[13px] text-muted-foreground">{view.read.primary.title}</p>}
      <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "cardio" } as any} className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-[14px] font-medium hover:bg-muted">
        Open the Cardio tab
      </Link>
    </div>
  );
}
