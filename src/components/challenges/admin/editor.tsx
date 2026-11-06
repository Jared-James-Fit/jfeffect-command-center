import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Copy, ExternalLink, Loader2, MonitorPlay, MoreHorizontal, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { duplicateChallenge, errorText, setStatus, useChallengeLive } from "@/lib/challenges/api";
import { slugify } from "@/lib/challenges/format";
import type { ChallengeRow, Division } from "@/lib/challenges/types";
import { StatusPill } from "../ui";
import { SetupTab } from "./setup-tab";
import { PrizesTab, UpdatesTab } from "./prizes-tab";
import { ResultsTab } from "./results-tab";
import { PeopleTab } from "./people-tab";
import { InsightsTab, TeamTab } from "./insights-tab";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type EditorTab = "setup" | "prizes" | "updates" | "people" | "results" | "insights" | "team";

const TABS: { id: EditorTab; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "prizes", label: "Prizes" },
  { id: "results", label: "Results" },
  { id: "people", label: "People" },
  { id: "updates", label: "Updates" },
  { id: "insights", label: "Insights" },
  { id: "team", label: "Team" },
];

function useChallengeRow(id: string) {
  return useQuery({
    queryKey: ["challenges", "row", id],
    queryFn: async () => {
      const [c, d, a] = await Promise.all([
        db.from("challenges").select("*").eq("id", id).single(),
        db.from("challenge_divisions").select("id, name, description").eq("challenge_id", id).order("sort").order("created_at"),
        db.from("challenge_prizes").select("id", { count: "exact", head: true }).eq("challenge_id", id),
      ]);
      if (c.error) throw c.error;
      if (d.error) throw d.error;
      const { data: att } = await db.rpc("challenge_console", { p_challenge: id });
      const hasAttempts = !!att?.entries?.some((e: { attempts: { voided: boolean }[] }) => e.attempts.some((x) => !x.voided));
      return { row: c.data as ChallengeRow, divisions: d.data as Division[], prizes: a.count ?? 0, hasAttempts, entries: att?.entries?.length ?? 0 };
    },
  });
}

function Checklist({ row, prizes }: { row: ChallengeRow; prizes: number }) {
  const items = [
    { ok: !!row.activity?.trim(), label: "What people do" },
    { ok: row.rules.length > 0, label: "Rules" },
    { ok: !!row.starts_at, label: "Date and time" },
    { ok: !!row.location_name?.trim(), label: "Venue" },
    { ok: prizes > 0, label: "A prize (optional)" , optional: true },
    { ok: !!row.safety?.trim(), label: "Safety policy (optional)", optional: true },
  ];
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-sm">
          {i.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className={cn("h-4 w-4", i.optional ? "text-muted-foreground" : "text-warning")} />}
          <span className={cn(!i.ok && !i.optional && "font-semibold")}>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function AdminChallengePage({ challengeId, tab, onTab }: { challengeId: string; tab: EditorTab; onTab: (t: EditorTab) => void }) {
  const q = useChallengeRow(challengeId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  useChallengeLive(challengeId);

  if (q.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!q.data) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">This challenge doesn't exist or you don't manage it.</p>
        <Link to="/admin/challenges" className="mt-3 inline-block text-sm font-semibold text-primary">
          All challenges
        </Link>
      </div>
    );
  }
  const { row, divisions, prizes, entries } = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["challenges"] });
  const owner = role === "admin";

  async function go(status: string, confirmText?: string, askReason?: string) {
    if (confirmText && !confirm(confirmText)) return;
    let reason: string | undefined;
    if (askReason) {
      const r = window.prompt(askReason);
      if (!r) return;
      reason = r;
    }
    setBusy(true);
    try {
      await setStatus(row.id, status, reason);
      toast.success(
        { upcoming: "Published", live: "You're live", paused: "Paused", verifying: "Submissions closed", archived: "Archived", completed: "Back in results", draft: "Back to draft", cancelled: "Cancelled" }[status] ?? "Updated",
      );
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(template: boolean) {
    const title = window.prompt(template ? "Template name" : "Name for the new challenge", template ? `${row.title} template` : `${row.title} 2`);
    if (!title) return;
    try {
      const id = await duplicateChallenge(row.id, title, `${slugify(title)}`.slice(0, 60) || `challenge-${Date.now()}`, template);
      toast.success(template ? "Template saved" : "Copy created");
      navigate({ to: "/admin/challenges/$challengeId", params: { challengeId: id } });
    } catch (e) {
      const m = errorText(e);
      toast.error(/unique|duplicate/i.test(m) ? "That web address is taken; rename it." : m);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${row.title}? It has no participants, so it goes for good.`)) return;
    const { error } = await db.from("challenges").delete().eq("id", row.id);
    if (error) return toast.error(errorText(error));
    navigate({ to: "/admin/challenges" });
  }

  const primary = (() => {
    if (row.is_template) return null;
    switch (row.status) {
      case "draft":
        return { label: "Publish", run: () => go("upcoming", "Publish it? The page goes public and people can sign up.") };
      case "upcoming":
        return { label: "Go live", run: () => go("live", "Start the competition? Scores can be recorded and scoring locks.") };
      case "live":
        return { label: "End submissions", run: () => go("verifying", "End submissions and review the results?") };
      case "paused":
        return { label: "Resume", run: () => go("live") };
      case "verifying":
        return { label: "Review results", run: () => onTab("results") };
      case "completed":
        return { label: "Archive", run: () => go("archived") };
      case "archived":
        return { label: "Unarchive", run: () => go("completed") };
      case "cancelled":
        return { label: "Restore as draft", run: () => go("draft") };
    }
  })();

  return (
    <div>
      <PageHeader
        title={row.title}
        backTo="/admin/challenges"
        backLabel="Challenges"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {row.is_template ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Template</span> : <StatusPill status={row.status} className="py-0.5" />}
            <span>/challenges/{row.slug}</span>
            <span>· {entries} registered</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {primary && (
              <Button onClick={primary.run} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {primary.label}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {!row.is_template && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/challenges/$slug" params={{ slug: row.slug }} target="_blank">
                        <ExternalLink className="mr-2 h-4 w-4" /> {row.status === "draft" ? "Preview page" : "Public page"}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/challenges/$slug/console" params={{ slug: row.slug }}>
                        <Timer className="mr-2 h-4 w-4" /> Event console
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/challenges/$slug/live" params={{ slug: row.slug }} target="_blank">
                        <MonitorPlay className="mr-2 h-4 w-4" /> Big screen
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {row.status === "upcoming" && <DropdownMenuItem onClick={() => go("draft", "Unpublish? The page goes private; sign-ups are kept.")}>Unpublish</DropdownMenuItem>}
                    {row.status === "live" && <DropdownMenuItem onClick={() => go("paused")}>Pause</DropdownMenuItem>}
                    {row.status === "verifying" && <DropdownMenuItem onClick={() => go("live")}>Reopen submissions</DropdownMenuItem>}
                    {row.status === "draft" && <DropdownMenuItem onClick={() => go("live", "Publish and start right now?")}>Publish and go live now</DropdownMenuItem>}
                    {!["completed", "archived", "cancelled"].includes(row.status) && (
                      <DropdownMenuItem className="text-destructive" onClick={() => go("cancelled", undefined, "Why is it cancelled? This shows on the public page.")}>
                        Cancel challenge
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                {owner && (
                  <>
                    <DropdownMenuItem onClick={() => duplicate(false)}>
                      <Copy className="mr-2 h-4 w-4" /> New challenge from this
                    </DropdownMenuItem>
                    {!row.is_template && <DropdownMenuItem onClick={() => duplicate(true)}>Save as template</DropdownMenuItem>}
                    {row.status === "draft" && entries === 0 && (
                      <DropdownMenuItem className="text-destructive" onClick={remove}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4 md:px-5">
        {row.status === "draft" && !row.is_template && (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="text-sm font-semibold">Before you publish</div>
            <Checklist row={row} prizes={prizes} />
            <p className="text-xs text-muted-foreground">Drafts are private: only you and this event's staff can open the page.</p>
          </div>
        )}
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={cn("h-10 shrink-0 rounded-lg px-3.5 text-sm font-semibold", tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "setup" && <SetupTab row={row} divisions={divisions} hasAttempts={q.data.hasAttempts} />}
        {tab === "prizes" && <PrizesTab challengeId={row.id} divisions={divisions} />}
        {tab === "updates" && <UpdatesTab challengeId={row.id} />}
        {tab === "results" && <ResultsTab row={row} />}
        {tab === "people" && <PeopleTab challengeId={row.id} slug={row.slug} />}
        {tab === "insights" && <InsightsTab challengeId={row.id} />}
        {tab === "team" && <TeamTab challengeId={row.id} />}
      </div>
    </div>
  );
}
