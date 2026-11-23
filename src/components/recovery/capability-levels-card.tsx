/**
 * The owner's view of what Cleo may do for whom (Settings → AI & Cleo): the
 * three levels, which capabilities each holds, who has them, the way into the
 * coaching queue's settings, and giving a coach automation (a trial, a promo
 * or one account) or taking it back. Nobody else sees it: the database refuses
 * the overview and every grant to anyone without owner controls, two-step
 * sign-in included, and never grants an owner capability. Nothing here sells
 * anything: the paid tier isn't offered, and a grant has no price.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CAPABILITY_FEATURES, LEVEL_COPY, LEVEL_ORDER, grantable } from "@/lib/cleo-capabilities";
import { getCapabilityOverviewFn, grantCapabilityFn, revokeCapabilityFn } from "@/lib/recovery-automation/queue.functions";
import { RecoveryQueueSheet, useRecoveryQueue } from "@/components/recovery/recovery-queue";

const OVERVIEW_KEY = ["cleo-capability-overview"] as const;
const AUTOMATION = CAPABILITY_FEATURES.filter((f) => f.level === "automation" && grantable(f.key));
const SOURCES = [
  { key: "trial", label: "Trial" },
  { key: "promo", label: "Promo" },
  { key: "account", label: "This account" },
] as const;

type Overview = Awaited<ReturnType<typeof getCapabilityOverviewFn>>;

function liveGrants(o: Overview) {
  return o.grants.filter((g) => !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > Date.now()));
}

export function CapabilityLevelsCard() {
  const get = useServerFn(getCapabilityOverviewFn);
  const q = useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => get(), retry: false, staleTime: 60_000 });
  const queue = useRecoveryQueue(!!q.data);
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  const activeGrants = liveGrants(q.data);
  return (
    <Card className="space-y-4 p-4" data-capability-levels>
      <div>
        <h2 className="text-base font-semibold">What Cleo does, by level</h2>
        <p className="text-[13px] text-muted-foreground">Decided by the database for every request and background job. The owner level is yours alone and can't be bought or granted.</p>
      </div>
      <div className="space-y-3">
        {LEVEL_ORDER.map((level) => {
          const copy = LEVEL_COPY[level];
          const who = level === "automation" ? (activeGrants.length ? `${new Set(activeGrants.map((g) => g.user_id)).size} with a grant` : copy.who) : level === "assist" ? `${copy.who} (${q.data.coaches.length})` : copy.who;
          return (
            <div key={level} className="rounded-xl border border-border p-3" data-capability-level={level}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold">{copy.name}</p>
                <p className="text-[12px] text-muted-foreground">{who}</p>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{copy.line}</p>
              <ul className="mt-2 space-y-0.5 text-[13px]">
                {CAPABILITY_FEATURES.filter((f) => f.level === level).map((f) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span>
                    <span className="text-muted-foreground">: {f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <CoachGrants overview={q.data} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-[13px] text-muted-foreground">Your coaching queue: choose what's drafted, what waits for you and what goes by itself, for each kind of update.</p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!queue.data?.enabled}>
          Queue settings
        </Button>
      </div>
      <RecoveryQueueSheet open={open} onOpenChange={setOpen} queue={queue.data} initialTab="settings" />
    </Card>
  );
}

/** Each coach on the team: the automation they have, with a way to give it or take it back. */
function CoachGrants({ overview }: { overview: Overview }) {
  const live = liveGrants(overview);
  if (!overview.coaches.length) {
    return (
      <div className="space-y-1 border-t border-border pt-3" data-capability-grants>
        <p className="text-[15px] font-semibold">Automation for your coaches</p>
        <p className="text-[13px] text-muted-foreground">No other coaches on the team yet. When there are, you can give one automation here for a trial or a promotion, and take it back any time.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-border pt-3" data-capability-grants>
      <div>
        <p className="text-[15px] font-semibold">Automation for your coaches</p>
        <p className="text-[13px] text-muted-foreground">A trial, a promotion or one account. It never includes your voice, your timing or your controls, and it can only reach their own clients.</p>
      </div>
      {overview.coaches.map((c) => (
        <CoachGrantRow key={c.user_id} coach={c} grants={live.filter((g) => g.user_id === c.user_id)} />
      ))}
    </div>
  );
}

function CoachGrantRow({ coach, grants }: { coach: Overview["coaches"][number]; grants: Overview["grants"] }) {
  const qc = useQueryClient();
  const grantFn = useServerFn(grantCapabilityFn);
  const revokeFn = useServerFn(revokeCapabilityFn);
  const [open, setOpen] = useState(false);
  const has = new Set(grants.map((g) => g.feature_key));
  const [picked, setPicked] = useState<string[]>(["automation.approval_queue"]);
  const [source, setSource] = useState<(typeof SOURCES)[number]["key"]>("trial");
  const [ends, setEnds] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const refresh = () => qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
  const give = useMutation({
    mutationFn: async () => {
      const keys = picked.filter((k) => !has.has(k));
      if (!keys.length) throw new Error("They already have those.");
      // the end of the day picked, in the browser's own time
      const expiresAt = ends ? new Date(`${ends}T23:59:59`).toISOString() : null;
      for (const k of keys) await grantFn({ data: { userId: coach.user_id, featureKey: k, source, expiresAt, note: null } });
    },
    onSuccess: () => {
      toast.success(`Given to ${coach.name}`);
      setOpen(false);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't give it"),
  });
  const takeBack = useMutation({
    mutationFn: async () => {
      for (const g of grants) await revokeFn({ data: { grantId: g.id } });
    },
    onSuccess: () => {
      toast.success(`Taken back from ${coach.name}`);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't take it back"),
  });
  const ending = grants.map((g) => g.expires_at).filter(Boolean).sort()[0] ?? null;

  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-capability-coach={coach.user_id}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{coach.name}</p>
          <p className="text-[12px] text-muted-foreground">
            {grants.length
              ? `${grants.map((g) => CAPABILITY_FEATURES.find((f) => f.key === g.feature_key)?.label ?? g.feature_key).join(", ")}${ending ? ` · until ${new Date(ending).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
              : "Assist only"}
          </p>
        </div>
        {grants.length ? (
          <Button size="sm" variant="ghost" onClick={() => takeBack.mutate()} disabled={takeBack.isPending}>
            {takeBack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Take back"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Give automation
          </Button>
        )}
      </div>
      {open && !grants.length && (
        <div className="space-y-2.5 border-t border-border pt-2.5">
          {AUTOMATION.map((f) => (
            <label key={f.key} className="flex items-start gap-2.5 text-[13px]">
              <Checkbox
                checked={picked.includes(f.key)}
                onCheckedChange={(v) => setPicked((p) => (v ? [...new Set([...p, f.key, "automation.approval_queue"])] : f.key === "automation.approval_queue" ? [] : p.filter((k) => k !== f.key)))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{f.label}</span>
                <span className="block text-[12px] text-muted-foreground">{f.description}</span>
              </span>
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value as any)} className="h-9 rounded-lg border border-border bg-background px-2 text-[13px]" aria-label="What it's for">
              {SOURCES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              Until
              <Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className="h-9 w-auto text-[13px]" aria-label="Ends on" />
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => give.mutate()} disabled={give.isPending || !picked.length}>
              {give.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Give it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">It starts asking them first for everything; they choose anything else themselves. Leave the date empty for no end.</p>
        </div>
      )}
    </div>
  );
}
