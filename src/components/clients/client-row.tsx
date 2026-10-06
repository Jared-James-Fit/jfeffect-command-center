import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useOpenClientProfile } from "@/lib/open-client-profile";
import { Button } from "@/components/ui/button";
import {
  ChevronRight, MoreHorizontal, CalendarDays, Dumbbell,
  Apple, HeartPulse, CheckCircle2, AlertCircle, Plus, Eye, ArrowRight, Clock, AlertTriangle, Upload,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BADGE_TONE, ACTION_ICON, actionStyle, rowBadges } from "./clients-status";
import { Tip } from "./tip";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import type { DirectoryNextAction } from "@/lib/clients-directory.functions";
import { format, parseISO, differenceInDays, formatDistanceToNow } from "date-fns";
import { QuickActionsMenu, ClientMoreMenu } from "./quick-actions";
import { ClientQuickSheet, type QuickPanelKind } from "./client-quick-sheet";
import { AssignProgramDialog } from "./assign-program-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Plain-English hover text for the big primary button, by what it does. */
const ACTION_HINT: Record<string, string> = {
  open: "Open this client's full profile: training, nutrition, messages, billing and more.",
  setup: "Open this client's profile to finish setting up their account.",
  payment: "Open their billing to fix a missed payment or set up a payment link.",
  review: "Go to check-in reviews to review what this client submitted.",
  assign: "Assign a training program to this client.",
  next_phase: "Build this client's next training block so they don't run out of program.",
  nutrition: "Update this client's nutrition plan.",
  cardio: "Update this client's cardio plan.",
};

function fmtRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  try {
    const s = start ? format(parseISO(start), "MMM d") : "?";
    const e = end ? format(parseISO(end), "MMM d") : "?";
    return `${s} → ${e}`;
  } catch { return null; }
}

function blockProgress(start: string | null, end: string | null) {
  if (!start || !end) return null;
  try {
    const s = parseISO(start); const e = parseISO(end); const t = new Date();
    const total = Math.max(1, differenceInDays(e, s) + 1);
    const elapsed = Math.max(0, differenceInDays(t, s) + 1);
    const pct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    const left = Math.max(0, differenceInDays(e, t));
    const totalWeeks = Math.max(1, Math.ceil(total / 7));
    const week = Math.max(1, Math.min(totalWeeks, Math.floor(Math.max(0, differenceInDays(t, s)) / 7) + 1));
    return { pct, left, week, totalWeeks };
  } catch { return null; }
}

export function ClientRow({ r, onArchive }: { r: DirectoryRow; onArchive?: (r: DirectoryRow) => void }) {
  const badges = rowBadges(r);
  const urgent = r.priority <= 3;
  const prog = blockProgress(r.block_start, r.block_end);
  const range = fmtRange(r.block_start, r.block_end);
  // For non-urgent next-actions (missing program, next phase, nutrition,
  // cardio, setup), the "Program"/"Nutrition"/"Cardio" status pills already
  // handle the specific assign flow. The big primary button should always
  // just open the client so admins have one consistent CTA per row.
  const effectiveAction: DirectoryNextAction =
    r.next_action.kind === "payment" || r.next_action.kind === "review"
      ? r.next_action
      : { kind: "open", label: "Open Client" };
  const actionTarget = primaryActionTarget(effectiveAction, r.id);
  const { role } = useAuth();
  const navigate = useNavigate();
  const impersonation = useClientImpersonation();
  const canPov = role === "admin" || role === "coach";
  const [povBusy, setPovBusy] = useState(false);

  const enterPov = async () => {
    if (povBusy) return;
    setPovBusy(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("user_id, full_name")
        .eq("id", r.id)
        .single();
      if (error) throw error;
      const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin/clients";
      impersonation.start(
        { id: r.id, user_id: data?.user_id ?? null, full_name: data?.full_name ?? r.full_name },
        returnTo,
      );
      if (!data?.user_id) {
        toast.message("Entering POV preview — client account isn't set up yet, so personal data will be empty.");
      }
      // Use window.location.href instead of navigate() to force a full page reload.
      // This ensures the sessionStorage/localStorage POV state is read on mount
      // and the React context is fully initialized before the portal renders.
      // Using navigate() causes a race condition where the portal renders before
      // the impersonation context state update propagates.
      if (typeof window !== "undefined") {
        window.location.href = "/portal";
      } else {
        navigate({ to: "/portal" });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enter POV");
      setPovBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <li
        className={cn(
          "group relative grid gap-3 rounded-xl border border-border bg-card p-4 transition",
          "hover:border-primary/30 hover:bg-accent/20",
          // desktop 5-area grid: identity | status | program | action | open.
          // Only activate the compressed grid at true desktop widths — iPad
          // and other tablet widths keep the stacked/wrapping layout so
          // badges, program pills, and action buttons never overlap.
          "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto] xl:items-center",
        )}
      >
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar
            src={r.profile_picture_url}
            name={r.full_name ?? "Client"}
            size={44}
            className="shrink-0"
          />
          <div className="min-w-0">
            <ClientNameLink
              clientId={r.id}
              className="block truncate text-sm font-semibold hover:underline"
            >
              {r.full_name || "(no name)"}
            </ClientNameLink>
            <div className="truncate text-xs text-muted-foreground">{r.email || "—"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {r.coaching_type && (
                <Tip text="The type of coaching package this client is on.">
                  <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5">
                    {r.coaching_type}
                  </span>
                </Tip>
              )}
              {r.coach_name && (
                <Tip text="The coach responsible for this client.">
                  <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5">
                    Coach · {r.coach_name}
                  </span>
                </Tip>
              )}
              {/* Last active — show with color coding based on recency */}
              {r.last_active_at ? (
                <Tip text={`Last used the app ${format(parseISO(r.last_active_at), "MMM d, yyyy h:mm a")}. Turns amber after 7 days and red after 14 days without activity.`}>
                  <span
                    className={[
                      "rounded-full border px-1.5 py-0.5",
                      (r.days_inactive ?? 0) >= 14
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : (r.days_inactive ?? 0) >= 7
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                        : "border-border bg-muted/40",
                    ].join(" ")}
                  >
                    Active {formatDistanceToNow(parseISO(r.last_active_at), { addSuffix: true })}
                  </span>
                </Tip>
              ) : r.last_login_at ? (
                <Tip text={`Last signed in ${format(parseISO(r.last_login_at), "MMM d, yyyy h:mm a")}.`}>
                  <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5">
                    Signed in {formatDistanceToNow(parseISO(r.last_login_at), { addSuffix: true })}
                  </span>
                </Tip>
              ) : null}
              {/* Missed workouts badge */}
              {r.f_missed_workouts && r.missed_workouts_count > 0 && (
                <Tip text={`${r.missed_workouts_count} scheduled workouts in the last 14 days weren't completed.`}>
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-600 font-medium">
                    {r.missed_workouts_count} missed
                  </span>
                </Tip>
              )}
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((b, i) => {
            const Icon = b.icon;
            return (
              <Tip key={i} text={b.hint}>
                <span
                  className={cn(
                    "inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    BADGE_TONE[b.tone],
                  )}
                >
                  {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                  {b.label}
                </span>
              </Tip>
            );
          })}
        </div>

                {/* Program summary */}
        <div className="min-w-0 space-y-1.5">
          <AssignmentStatusStrip r={r} prog={prog} range={range} />
        </div>
        {/* Last signed in — always shown, falls back to 'Never signed in' */}
        <Tip text="The last time this client opened the app.">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            <span>
              {r.last_active_at
                ? `Last seen ${formatDistanceToNow(parseISO(r.last_active_at), { addSuffix: true })}`
                : r.last_login_at
                ? `Signed in ${formatDistanceToNow(parseISO(r.last_login_at), { addSuffix: true })}`
                : "Never signed in"}
            </span>
          </div>
        </Tip>
        {/* Next best action */}
        <div className="flex items-center justify-end gap-1.5">
          {canPov && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={enterPov}
                  disabled={povBusy}
                  aria-label={`Enter ${r.full_name ?? "client"} POV`}
                  className="h-11 w-11 border border-warning/50 bg-warning/15 text-warning shadow-sm hover:bg-warning/25 xl:h-10 xl:w-10"
                >
                  <Eye className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">See the app exactly as this client sees it (their home screen, workouts, nutrition and messages).</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="sm" className={cn("h-9 min-w-[8rem]", actionStyle(effectiveAction, urgent))}>
                {actionTarget}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">{ACTION_HINT[effectiveAction.kind] ?? effectiveAction.label}</TooltipContent>
          </Tooltip>

          <QuickActionsMenu r={r} />

          <ClientMoreMenu
            r={r}
            onArchive={onArchive}
            tip="More options: schedule a workout, assign programs, download reports, mark payment status, archive."
            trigger={
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More client actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />

          <Tip text="Open this client's profile.">
            <ClientNameLink
              clientId={r.id}
              ariaLabel={`Open ${r.full_name ?? "client"}`}
              className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground xl:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </ClientNameLink>
          </Tip>
        </div>
      </li>
    </TooltipProvider>
  );
}

/* ---------- Assignment Status Strip ---------- */

function StatusPill({
  ok,
  icon: Icon,
  label,
  detail,
  assignLabel,
  onClick,
  okHint,
  missingHint,
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string | null;
  assignLabel: string;
  onClick: () => void;
  /** Plain-English hover text when assigned. */
  okHint: string;
  /** Plain-English hover text when missing. */
  missingHint: string;
}) {
  if (ok) {
    return (
      <Tip text={okHint}>
        <button
          type="button"
          onClick={onClick}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <Icon className="h-3 w-3 shrink-0 opacity-80" />
          <span className="truncate">{detail ?? label}</span>
        </button>
      </Tip>
    );
  }
  return (
    <Tip text={missingHint}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive transition hover:bg-destructive/20"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{assignLabel}</span>
        <Plus className="h-3 w-3 shrink-0" />
      </button>
    </Tip>
  );
}

function AssignmentStatusStrip({
  r,
  prog,
  range,
}: {
  r: DirectoryRow;
  prog: { pct: number; left: number; week: number; totalWeeks: number } | null;
  range: string | null;
}) {
  const hasProgram = !!r.block_id;
  // Nutrition/cardio targets are often assigned open-ended (no end_date),
  // so `nut_end`/`card_end` may be null even when an active plan exists.
  // Rely on the missing-flags from the RPC, which already treat a null
  // end_date as still-active.
  const hasNutrition = !r.f_missing_nutrition;
  const hasCardio = !r.f_missing_cardio;
  const [sheet, setSheet] = useState<QuickPanelKind | null>(null);
  const [assignProgramOpen, setAssignProgramOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill
          ok={hasProgram}
          icon={Dumbbell}
          label="Program"
          detail={
            hasProgram && prog
              ? `${r.block_name ?? "Program"} · Week ${prog.week}/${prog.totalWeeks}`
              : r.block_name
          }
          assignLabel="Assign Program"
          okHint={`Their current training block${prog ? `, week ${prog.week} of ${prog.totalWeeks}` : ""}. Click to view their schedule.`}
          missingHint="No training program is running for this client right now. Click to assign one."
          onClick={() => (hasProgram ? setSheet("program-view") : setAssignProgramOpen(true))}
        />
        <StatusPill
          ok={hasNutrition}
          icon={Apple}
          label="Nutrition"
          detail={hasNutrition ? "Nutrition" : null}
          assignLabel="Assign Nutrition"
          okHint="Nutrition targets (calories, protein, meals) are assigned and active. Click to view or edit."
          missingHint="No active nutrition plan for this client. Click to assign one."
          onClick={() => setSheet("nutrition")}
        />
        <StatusPill
          ok={hasCardio}
          icon={HeartPulse}
          label="Cardio"
          detail={hasCardio ? "Cardio" : null}
          assignLabel="Assign Cardio"
          okHint="A cardio plan is assigned and active. Click to view or edit."
          missingHint="No active cardio plan for this client. Click to assign one."
          onClick={() => setSheet("cardio")}
        />
        {hasProgram && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSheet("program-view")}
                aria-label="View training schedule"
                className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">Open this client's training schedule: which workouts are planned on which days.</TooltipContent>
          </Tooltip>
        )}
      </div>
      {hasProgram && (
        <>
          {(range || prog) && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              {range && (
                <Tip text="The start and end dates of their current training block.">
                  <span className="truncate">{range}</span>
                </Tip>
              )}
              {prog && (
                <Tip text="Days left in the current block, and how far through it they are by calendar time (not workouts completed).">
                  <span className="shrink-0">
                    {prog.left}d left · {prog.pct}%
                  </span>
                </Tip>
              )}
            </div>
          )}
          {prog && (
            <Tip text="How far through the current training block they are, by calendar time.">
              <div><Progress value={prog.pct} className="h-1.5" /></div>
            </Tip>
          )}
        </>
      )}
      {r.next_block_id && (
        <Tip text="The next training block already queued for this client, and when it starts. Nothing to do here.">
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-400">
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            Up next: <span className="font-semibold">{r.next_block_name ?? "Next block"}</span>
            {r.next_block_start && (() => {
              try {
                const d = parseISO(r.next_block_start);
                const days = differenceInDays(d, new Date());
                const when = days <= 0 ? "starts today" : `in ${days}d · ${format(d, "MMM d")}`;
                return <span className="ml-1 opacity-80">· {when}</span>;
              } catch { return null; }
            })()}
          </span>
        </div>
        </Tip>
      )}
      {hasProgram && !r.next_block_id && (() => {
        // No next block queued — surface program-end so the coach knows when to upload more.
        const endIso = r.block_end;
        if (!endIso) return null;
        let daysLeft = 0;
        try { daysLeft = differenceInDays(parseISO(endIso), new Date()); } catch { return null; }
        const ended = daysLeft < 0;
        const ending = daysLeft <= 14;
        const tone = ended
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : ending
          ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
          : "border-border bg-muted/40 text-muted-foreground";
        const label = ended
          ? `Program ended ${format(parseISO(endIso), "MMM d")} · upload next block`
          : ending
          ? `Program ends in ${daysLeft}d (${format(parseISO(endIso), "MMM d")}) · no next block`
          : `Program ends ${format(parseISO(endIso), "MMM d")} · no next block queued`;
        return (
          <Tip text={ended
            ? "Their program has ended and nothing is queued. Click to assign or upload the next block."
            : "Nothing is queued after their current block. Click to assign or upload the next block before it ends."}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setAssignProgramOpen(true); }}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition hover:brightness-110",
                tone,
              )}
            >
              {ended || ending ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Upload className="h-3 w-3 shrink-0" />}
              <span className="truncate">{label}</span>
              <Plus className="h-3 w-3 shrink-0" />
            </button>
          </Tip>
        );
      })()}
      <ClientQuickSheet
        kind={sheet}
        clientId={r.id}
        clientName={r.full_name}
        onClose={() => setSheet(null)}
      />
      <AssignProgramDialog
        open={assignProgramOpen}
        onOpenChange={setAssignProgramOpen}
        clientId={r.id}
        clientName={r.full_name}
      />
    </div>
  );
}

/** Map next_action kind to the most useful in-app destination. */
function primaryActionTarget(action: DirectoryNextAction, clientId: string) {
  const IconBase = ACTION_ICON(action.kind);
  const label = (
    <>
      <IconBase className="mr-1.5 h-4 w-4" aria-hidden />
      {action.label}
    </>
  );
  switch (action.kind) {
    case "assign":
    case "next_phase":
      return (
        <Link to="/admin/program-assign/$clientId" params={{ clientId }}>{label}</Link>
      );
    case "nutrition":
      return (
        <ClientNameLink clientId={clientId} tab="nutrition">{label}</ClientNameLink>
      );
    case "cardio":
      return (
        <ClientNameLink clientId={clientId} tab="nutrition">{label}</ClientNameLink>
      );
    case "review":
      return (
        <Link to="/admin/check-in-reviews">{label}</Link>
      );
    case "payment":
      return (
        <ClientNameLink clientId={clientId} tab="billing">{label}</ClientNameLink>
      );
    case "setup":
      return (
        <ClientNameLink clientId={clientId}>{label}</ClientNameLink>
      );
    case "open":
    default:
      return (
        <ClientNameLink clientId={clientId}>{label}</ClientNameLink>
      );
  }
}

export function ClientRowSkeleton() {
  return (
    <li className="grid animate-pulse gap-3 rounded-xl border border-border bg-card p-4 xl:grid-cols-[1.4fr_1fr_1.3fr_auto_auto]">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-44 rounded bg-muted/60" />
        </div>
      </div>
      <div className="h-5 w-24 rounded-full bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-40 rounded bg-muted" />
        <div className="h-1.5 w-full rounded bg-muted/60" />
      </div>
      <div className="h-9 w-32 rounded-md bg-muted" />
      <div className="h-9 w-9 rounded-md bg-muted" />
    </li>
  );
}