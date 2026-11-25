/**
 * Cleo Autopilot on the coach's dashboard (Nov 25 2026): a card that says the
 * answer ("2 need you · 3 to approve · 1 updated · 8 on track") and opens the
 * exception dashboard full screen (`?layer=autopilot`): Requires attention,
 * Awaiting approval, Automatically updated, Missing information, On track,
 * each client's decision with its evidence, what it changes before → after,
 * the draft it became, and Approve / Edit / Reject / Defer / Roll back /
 * Pause / Open client / Open chat; Approve selected for several at once. The
 * autonomy settings (global, per client) are a sheet from it. Hidden when
 * Autopilot has nothing on record. Named for what it does ("Coaching
 * updates"), never badged as AI.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gauge, Settings2, Pause, Play, Check, X, Clock, Undo2, ExternalLink, MessageCircle, Pencil, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import { FullScreenPage } from "@/components/full-screen-page";
import {
  decideAutopilotFn,
  getAutopilotBoardFn,
  getAutopilotSettingsFn,
  runAutopilotNowFn,
  saveAutopilotSettingsFn,
  type AutopilotBoard,
  type BoardRow,
} from "@/lib/autopilot/autopilot.functions";
import { BUCKETS, BUCKET_LABEL, CATEGORY_LABEL, DOMAINS, DOMAIN_WORD, MODE_LABEL, type Bucket, type Domain, type Mode } from "@/lib/autopilot/types";
import { OUTCOME_LABEL } from "@/lib/autopilot/outcome";
import { cn } from "@/lib/utils";

export const AUTOPILOT_LAYER = "autopilot" as const;
const BOARD_KEY = ["autopilot", "board"] as const;

export function useAutopilotBoard() {
  const read = useServerFn(getAutopilotBoardFn);
  return useQuery({ queryKey: BOARD_KEY, queryFn: () => read() as Promise<AutopilotBoard>, staleTime: 60_000, retry: 1 });
}

const BUCKET_TONE: Record<Bucket, "neutral" | "done" | "attention" | "error"> = {
  requires_attention: "error",
  awaiting_approval: "attention",
  auto_updated: "done",
  missing_info: "attention",
  on_track: "neutral",
};

/** The dashboard card: the answer in one line; tap for the full page. */
export function AutopilotBoardCard({ onOpen }: { onOpen: () => void }) {
  const q = useAutopilotBoard();
  const b = q.data;
  if (!b?.available || !b.rows.length) return null;
  const c = b.counts;
  const parts = [
    c.requires_attention ? `${c.requires_attention} need you` : null,
    c.awaiting_approval ? `${c.awaiting_approval} to approve` : null,
    c.missing_info ? `${c.missing_info} missing info` : null,
    c.auto_updated ? `${c.auto_updated} updated` : null,
    c.on_track ? `${c.on_track} on track` : null,
  ].filter(Boolean);
  return (
    <Card className="p-0" data-autopilot-card>
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
        <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">Coaching updates</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {parts.join(" · ")}
            {b.globalPaused ? " · paused" : ""}
          </span>
        </span>
        {c.requires_attention > 0 && <StatusChip tone="error">{c.requires_attention}</StatusChip>}
      </button>
    </Card>
  );
}

/** The exception dashboard, full screen. */
export function AutopilotBoardPage({ open, onBack }: { open: boolean; onBack: () => void }) {
  const q = useAutopilotBoard();
  const qc = useQueryClient();
  const decide = useServerFn(decideAutopilotFn);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<{ clientId: string | null; name: string } | null>(null);
  const rows = q.data?.rows ?? [];
  const groups = useMemo(() => BUCKETS.map((b) => ({ bucket: b, rows: rows.filter((r) => r.bucket === b) })).filter((g) => g.rows.length), [rows]);

  const act = async (ids: string[], action: "approve" | "reject" | "defer" | "rollback") => {
    setBusy(ids.join(","));
    try {
      const out: any = await decide({ data: { ids, action } });
      const res = (out?.results ?? []) as Array<{ status: string; published?: string[]; waiting?: string | null; errors?: string[] }>;
      const published = res.reduce((n, r) => n + (r.published?.length ?? 0), 0);
      const waiting = res.find((r) => r.waiting)?.waiting;
      const errs = res.flatMap((r) => r.errors ?? []);
      if (action === "approve") {
        if (published) toast.success(`Published ${published} change${published === 1 ? "" : "s"}`);
        else if (waiting === "active_workout") toast("Approved: it publishes after their workout");
        else toast("Approved: it publishes once the draft is ready");
      } else toast.success(action === "reject" ? "Rejected" : action === "defer" ? "Deferred a week" : "Rolled back");
      if (errs.length) toast.error(errs[0]);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["autopilot"] });
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work");
    } finally {
      setBusy(null);
    }
  };

  const approvable = rows.filter((r) => r.status === "open" && Object.values(r.domains).some((d) => d.draft && !d.published));
  return (
    <FullScreenPage
      open={open}
      id="autopilot-board"
      title="Coaching updates"
      subtitle={q.data?.globalPaused ? "Autopilot is paused for everyone" : "Weekly assessments for your coaching clients"}
      onBack={onBack}
      actions={
        <Button size="sm" variant="outline" className="h-9" onClick={() => setSettingsFor({ clientId: null, name: "Everyone" })}>
          <Settings2 className="mr-1.5 h-4 w-4" /> Settings
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-24" data-autopilot-board>
        {selected.size > 0 && (
          <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-border bg-background/95 p-2 backdrop-blur">
            <span className="flex-1 text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" disabled={!!busy} onClick={() => act([...selected], "approve")}>
              <Check className="mr-1 h-4 w-4" /> Approve {selected.size}
            </Button>
          </div>
        )}
        {!rows.length && <p className="text-sm text-muted-foreground">Nothing assessed yet. Assessments run after each weekly check-in, or once a week when one is missed.</p>}
        {groups.map((g) => (
          <section key={g.bucket} data-autopilot-bucket={g.bucket}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">{BUCKET_LABEL[g.bucket]}</h2>
              <span className="text-[13px] text-muted-foreground">{g.rows.length}</span>
              {g.bucket === "awaiting_approval" && approvable.length > 1 && (
                <button
                  type="button"
                  className="ml-auto text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(new Set(approvable.filter((r) => r.bucket === "awaiting_approval").map((r) => r.id)))}
                >
                  Select all
                </button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {g.rows.map((r) => (
                <DecisionRow
                  key={r.id}
                  row={r}
                  busy={!!busy && busy.includes(r.id)}
                  selectable={approvable.some((a) => a.id === r.id)}
                  selected={selected.has(r.id)}
                  onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })}
                  onAct={(a) => act([r.id], a)}
                  onSettings={() => setSettingsFor({ clientId: r.clientId, name: r.name })}
                />
              ))}
            </ul>
          </section>
        ))}
        {q.data && q.data.cost30.calls > 0 && (
          <p className="text-[12px] text-muted-foreground" data-autopilot-cost>
            Last 30 days: {q.data.cost30.calls} model calls for {q.data.cost30.clients} clients
            {q.data.cost30.tokens ? ` · ${Math.round(q.data.cost30.tokens / 1000)}k tokens` : ""}
            {q.data.cost30.usd ? ` · about $${q.data.cost30.usd.toFixed(2)}` : ""}
          </p>
        )}
      </div>
      {settingsFor && <AutopilotSettingsSheet clientId={settingsFor.clientId} name={settingsFor.name} onClose={() => setSettingsFor(null)} />}
    </FullScreenPage>
  );
}

function domainLine(d: BoardRow["domains"][Domain]): string {
  if (d.change === "hold") return d.summary;
  const ba = d.before || d.after ? ` (${d.before ?? "now"} → ${d.after ?? "drafting"})` : "";
  return `${d.summary}${ba}`;
}

function draftWords(d: BoardRow["domains"][Domain]): string | null {
  if (d.rolledBack) return "Rolled back";
  if (d.published) return "Published";
  if (d.draftError) return d.draftError;
  if (d.routing?.shadowWouldPublish) return "Draft (shadow: would have published)";
  if (d.draft) return "Draft ready to review";
  if (d.change === "propose" && d.routing?.action !== "none") return "Writing the draft…";
  return d.routing?.action === "none" && d.change !== "hold" ? d.routing.why : null;
}

function DecisionRow({
  row: r,
  busy,
  selectable,
  selected,
  onSelect,
  onAct,
  onSettings,
}: {
  row: BoardRow;
  busy: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onAct: (a: "approve" | "reject" | "defer" | "rollback") => void;
  onSettings: () => void;
}) {
  const qc = useQueryClient();
  const reassess = useServerFn(runAutopilotNowFn);
  const [running, setRunning] = useState(false);
  const changed = DOMAINS.filter((d) => r.domains[d] && r.domains[d].change !== "hold");
  const published = DOMAINS.some((d) => r.domains[d]?.published && !r.domains[d]?.rolledBack);
  const open = ["open", "approved", "deferred"].includes(r.status);
  const firstTab: Domain = changed[0] ?? "training";
  return (
    <li className="space-y-2 p-3" data-autopilot-row={r.category}>
      <div className="flex items-start gap-3">
        {selectable && <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} aria-label={`Select ${r.name}`} className="mt-1" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{r.name}</span>
            <StatusChip tone={BUCKET_TONE[r.bucket]}>{CATEGORY_LABEL[r.category]}</StatusChip>
            {r.paused && <StatusChip>Paused</StatusChip>}
            {r.status === "deferred" && <StatusChip>Deferred</StatusChip>}
          </div>
          <p className="mt-0.5 text-[14px]">{r.headline}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{r.rationale}</p>
        </div>
      </div>
      <ul className="space-y-1 pl-0.5 text-[13px]">
        {DOMAINS.map((d) => {
          const s = r.domains[d];
          if (!s) return null;
          const status = draftWords(s);
          return (
            <li key={d} className="flex gap-2">
              <span className="w-[72px] shrink-0 text-muted-foreground">{DOMAIN_WORD[d]}</span>
              <span className="min-w-0 flex-1">
                {domainLine(s)}
                {status && <span className={cn("block text-[12px]", s.draftError ? "text-destructive" : "text-muted-foreground")}>{status}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {r.protections.length > 0 && (
        <p className="text-[12px] text-warning">Needs you: {r.protections.map((p) => p.text).join(" · ")}</p>
      )}
      {r.missing.length > 0 && <p className="text-[12px] text-muted-foreground">Missing: {r.missing.join(" · ")}</p>}
      <p className="text-[12px] text-muted-foreground">
        {r.expected ? `Expected: ${r.expected} · ` : ""}
        {r.reassessOn ? `Reassess ${r.reassessOn}` : ""}
        {r.outcome ? ` · Outcome: ${OUTCOME_LABEL[r.outcome.verdict as keyof typeof OUTCOME_LABEL] ?? r.outcome.verdict} (${r.outcome.text})` : ""}
        {r.cost.calls ? ` · ${r.cost.calls} call${r.cost.calls === 1 ? "" : "s"}` : ""}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {open && changed.some((d) => r.domains[d].draft && !r.domains[d].published) && (
          <Button size="sm" className="h-9" disabled={busy} onClick={() => onAct("approve")}>
            <Check className="mr-1 h-4 w-4" /> Approve
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-9" asChild>
          <Link to="/admin/clients/$id" params={{ id: r.clientId }} search={{ tab: firstTab } as any}>
            <Pencil className="mr-1 h-4 w-4" /> Edit
          </Link>
        </Button>
        {open && changed.length > 0 && (
          <>
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => onAct("reject")}>
              <X className="mr-1 h-4 w-4" /> Reject
            </Button>
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => onAct("defer")}>
              <Clock className="mr-1 h-4 w-4" /> Defer
            </Button>
          </>
        )}
        {published && r.status !== "rolled_back" && (
          <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => onAct("rollback")}>
            <Undo2 className="mr-1 h-4 w-4" /> Roll back
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-9" onClick={onSettings}>
          {r.paused ? <Play className="mr-1 h-4 w-4" /> : <Pause className="mr-1 h-4 w-4" />} {r.paused ? "Resume" : "Pause"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              await reassess({ data: { clientId: r.clientId } });
              await qc.invalidateQueries({ queryKey: ["autopilot"] });
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't reassess");
            } finally {
              setRunning(false);
            }
          }}
        >
          <RefreshCw className={cn("mr-1 h-4 w-4", running && "animate-spin")} /> Reassess
        </Button>
        <Button size="sm" variant="ghost" className="h-9" asChild>
          <Link to="/admin/clients/$id" params={{ id: r.clientId }}>
            <ExternalLink className="mr-1 h-4 w-4" /> Open client
          </Link>
        </Button>
        <Button size="sm" variant="ghost" className="h-9" asChild>
          <Link to="/admin/communication" search={{ tab: "messages", client: r.clientId } as any}>
            <MessageCircle className="mr-1 h-4 w-4" /> Open chat
          </Link>
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */

type ModeChoice = Mode | "inherit";

export function AutopilotSettingsSheet({ clientId, name, onClose }: { clientId: string | null; name: string; onClose: () => void }) {
  const read = useServerFn(getAutopilotSettingsFn);
  const save = useServerFn(saveAutopilotSettingsFn);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["autopilot", "settings", clientId ?? "global"], queryFn: () => read({ data: { clientId } }) as Promise<any>, retry: 1 });
  const row = q.data ? (clientId ? q.data.client : q.data.global) : null;
  const [draft, setDraft] = useState<any>(null);
  const v =
    draft ??
    (q.data
      ? {
          modes: Object.fromEntries(DOMAINS.map((d) => [d, (row?.[`mode_${d}`] as Mode | null) ?? (clientId ? "inherit" : "draft")])) as Record<Domain, ModeChoice>,
          locked: (row?.locked_domains ?? []) as Domain[],
          nutritionKcal: row?.ranges?.nutrition_kcal ?? "",
          cardioMinutes: row?.ranges?.cardio_minutes ?? "",
          paused: !!row?.paused,
          pausedUntil: row?.paused_until ?? "",
          shadow: row?.shadow == null ? (clientId ? "inherit" : "on") : row.shadow ? "on" : "off",
        }
      : null);
  const set = (patch: any) => setDraft({ ...v, ...patch });
  const [saving, setSaving] = useState(false);
  const canEdit = clientId ? true : !!q.data?.canEditGlobal;

  const submit = async () => {
    if (!v) return;
    setSaving(true);
    try {
      const num = (x: any) => (x === "" || x == null ? null : Math.max(0, Math.round(Number(x))));
      await save({
        data: {
          clientId,
          modes: Object.fromEntries(DOMAINS.map((d) => [d, v.modes[d] === "inherit" ? null : v.modes[d]])) as any,
          locked: v.locked,
          ranges: { nutrition_kcal: num(v.nutritionKcal), cardio_minutes: num(v.cardioMinutes) },
          paused: v.paused,
          pausedUntil: v.pausedUntil || null,
          shadow: v.shadow === "inherit" ? null : v.shadow === "on",
        },
      });
      toast.success("Autopilot settings saved");
      await qc.invalidateQueries({ queryKey: ["autopilot"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const choices: ModeChoice[] = clientId ? ["inherit", "draft", "smart", "advanced"] : ["draft", "smart", "advanced"];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Autopilot · {name}</SheetTitle>
        </SheetHeader>
        {!v ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5 p-4" data-autopilot-settings>
            <p className="text-[13px] text-muted-foreground">
              Draft Only puts every change in its builder for you. Smart publishes small routine nutrition and cardio steps inside the ranges below; Advanced allows up to the engine's own step. Training, pain, health, weight-class and competition decisions always wait for you.
            </p>
            {DOMAINS.map((d) => (
              <div key={d} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{DOMAIN_WORD[d]}</span>
                  <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    Lock
                    <Switch
                      disabled={!canEdit}
                      checked={v.locked.includes(d)}
                      onCheckedChange={(on) => set({ locked: on ? [...v.locked, d] : v.locked.filter((x: Domain) => x !== d) })}
                      aria-label={`Lock ${DOMAIN_WORD[d]}`}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {choices.map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={!canEdit || (d === "training" && m !== "draft" && m !== "inherit")}
                      onClick={() => set({ modes: { ...v.modes, [d]: m } })}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-[13px] font-medium disabled:opacity-40",
                        v.modes[d] === m ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
                      )}
                    >
                      {m === "inherit" ? "Follow everyone's" : MODE_LABEL[m as Mode]}
                    </button>
                  ))}
                </div>
                {d === "training" && <p className="text-[12px] text-muted-foreground">Training changes are always drafts for you to approve.</p>}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-[13px]">
                <span className="text-muted-foreground">Calories a day, at most</span>
                <Input inputMode="numeric" disabled={!canEdit} value={v.nutritionKcal} placeholder="100" onChange={(e) => set({ nutritionKcal: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
              </label>
              <label className="space-y-1 text-[13px]">
                <span className="text-muted-foreground">Cardio min a week, at most</span>
                <Input inputMode="numeric" disabled={!canEdit} value={v.cardioMinutes} placeholder="15" onChange={(e) => set({ cardioMinutes: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </label>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-semibold">Shadow mode</span>
              <p className="text-[12px] text-muted-foreground">On: what Smart or Advanced would publish stays a draft, marked "would have published", so you can check it first.</p>
              <div className="flex flex-wrap gap-1.5">
                {(clientId ? ["inherit", "on", "off"] : ["on", "off"]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => set({ shadow: s })}
                    className={cn("min-h-9 rounded-full border px-3 text-[13px] font-medium", v.shadow === s ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
                  >
                    {s === "inherit" ? "Follow everyone's" : s === "on" ? "On" : "Off"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{clientId ? `Pause for ${name}` : "Pause for everyone"}</span>
              <Switch disabled={!canEdit} checked={v.paused} onCheckedChange={(on) => set({ paused: on })} aria-label="Pause" />
            </div>
            <label className="block space-y-1 text-[13px]">
              <span className="text-muted-foreground">…or paused until</span>
              <Input type="date" disabled={!canEdit} value={v.pausedUntil} onChange={(e) => set({ pausedUntil: e.target.value })} />
            </label>
            {!canEdit && <p className="text-[12px] text-muted-foreground">Only an admin changes everyone's settings.</p>}
            <Button className="h-11 w-full" disabled={!canEdit || saving} onClick={submit}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
