import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserAvatar } from "@/components/user-avatar";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useOpenClientProfile } from "@/lib/open-client-profile";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ChevronRight, MoreHorizontal, CalendarDays, Dumbbell,
  Apple, HeartPulse, CheckCircle2, AlertCircle, Plus, Eye, ArrowRight, AlertTriangle, Upload,
  Bell, Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BADGE_TONE, ACTION_ICON, actionStyle, lastSeenChip, rowStatusChips, type ChipAction } from "./clients-status";
import { StatusTip } from "./status-tip";
import { adminRemindAgreement } from "@/lib/coaching-agreement.functions";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import type { DirectoryNextAction } from "@/lib/clients-directory.functions";
import { format, parseISO, differenceInDays } from "date-fns";
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

/** Buttons inside a status explanation. The first is the main one. */
const actionClass = (primary: boolean) =>
  cn(buttonVariants({ variant: primary ? "default" : "secondary", size: "sm" }), "h-10 w-full text-sm");

/** One-tap reminder to sign the Coaching Agreement (admins only; the server holds a 24 hour cooldown). */
function RemindButton({ r, primary, close }: { r: DirectoryRow; primary: boolean; close: () => void }) {
  const remindFn = useServerFn(adminRemindAgreement);
  const queryClient = useQueryClient();
  const remind = useMutation({
    mutationFn: () => remindFn({ data: { clientIds: [r.id] } }),
    onSuccess: (res) => {
      if (res.reminded > 0) toast.success(`Reminder sent to ${r.full_name ?? "the client"}`);
      else if (res.skippedRecent > 0) toast.message("Already reminded in the last 24 hours");
      else toast.message("They aren't waiting to sign, so nothing was sent");
      queryClient.invalidateQueries({ queryKey: ["clients-directory"] });
      close();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't send the reminder"),
  });
  return (
    <button type="button" className={actionClass(primary)} disabled={remind.isPending} onClick={() => remind.mutate()}>
      {remind.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Bell aria-hidden />}
      Send reminder
    </button>
  );
}

/** The buttons a status explanation offers, by kind. */
function ChipActions({
  r, actions, isAdmin, close,
}: { r: DirectoryRow; actions: ChipAction[]; isAdmin: boolean; close: () => void }) {
  const shown = actions.filter((a) => a !== "remind" || isAdmin);
  return (
    <>
      {shown.map((a, i) => {
        const cls = actionClass(i === 0);
        switch (a) {
          case "remind":
            return <RemindButton key={a} r={r} primary={i === 0} close={close} />;
          case "billing":
            return <ClientNameLink key={a} clientId={r.id} tab="billing" className={cls} onClick={close}>Open billing</ClientNameLink>;
          case "profile":
            return <ClientNameLink key={a} clientId={r.id} className={cls} onClick={close}>Open profile</ClientNameLink>;
          case "agreement":
            return <ClientNameLink key={a} clientId={r.id} tab="agreements" className={cls} onClick={close}>Open agreement</ClientNameLink>;
          case "reviews":
            return <Link key={a} to="/admin/check-in-reviews" className={cls} onClick={close}>Review check-ins</Link>;
          case "program":
            return <Link key={a} to="/admin/program-assign/$clientId" params={{ clientId: r.id }} className={cls} onClick={close}>Build next block</Link>;
        }
      })}
    </>
  );
}

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

const TAG = "cursor-pointer rounded-full border border-border bg-muted/40 px-1.5 py-1";

/** Last seen turns amber after a week without opening the app and red after two. */
const SEEN_TONE = {
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  muted: "border-border bg-muted/40",
} as const;

export function ClientRow({ r, onArchive }: { r: DirectoryRow; onArchive?: (r: DirectoryRow) => void }) {
  const badges = rowStatusChips(r);
  const seen = lastSeenChip(r);
  // The status row already carries "N Missed" when it fits, so the tag by the name only fills in
  // for the rare card whose status row is full.
  const missedShownAsBadge = badges.some((b) => b.id === "missed");
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
  const isAdmin = role === "admin";
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
          // desktop 4-area grid: identity | status | program | actions.
          // Only activate the compressed grid at true desktop widths — iPad
          // and other tablet widths keep the stacked/wrapping layout so
          // badges, program pills, and action buttons never overlap.
          "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] xl:items-center",
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
                <StatusTip
                  title="Coaching type"
                  body="The type of coaching package this client is on."
                  className={TAG}
                >
                  {r.coaching_type}
                </StatusTip>
              )}
              {r.coach_name && (
                <StatusTip
                  title="Assigned coach"
                  body="The coach responsible for this client."
                  className={TAG}
                >
                  Coach · {r.coach_name}
                </StatusTip>
              )}
              {/* When they last used the app, colour-coded by how long ago */}
              <StatusTip
                title={seen.title}
                body={seen.body}
                className={cn("cursor-pointer rounded-full border px-1.5 py-1", SEEN_TONE[seen.tone])}
              >
                {seen.label}
              </StatusTip>
              {r.f_missed_workouts && r.missed_workouts_count > 0 && !missedShownAsBadge && (
                <StatusTip
                  title="Missed workouts"
                  body={`${r.missed_workouts_count} scheduled workouts in the last 14 days weren't completed. Two or more is flagged.`}
                  tone="warn"
                  className="cursor-pointer rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-amber-600 font-medium"
                >
                  {r.missed_workouts_count} missed
                </StatusTip>
              )}
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((b) => {
            const Icon = b.icon;
            return (
              <StatusTip
                key={b.label}
                title={b.label}
                body={b.hint}
                next={b.next}
                icon={b.icon}
                tone={b.tone}
                footer={
                  b.actions?.length
                    ? (close) => <ChipActions r={r} actions={b.actions!} isAdmin={isAdmin} close={close} />
                    : undefined
                }
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
                  BADGE_TONE[b.tone],
                )}
              >
                {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                {b.label}
              </StatusTip>
            );
          })}
        </div>

                {/* Program summary */}
        <div className="min-w-0 space-y-1.5">
          <AssignmentStatusStrip r={r} prog={prog} range={range} />
        </div>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <ClientNameLink
                clientId={r.id}
                ariaLabel={`Open ${r.full_name ?? "client"}`}
                className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground xl:flex"
              >
                <ChevronRight className="h-5 w-5" />
              </ClientNameLink>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">Open this client's profile.</TooltipContent>
          </Tooltip>
        </div>
      </li>
    </TooltipProvider>
  );
}

/* ---------- Assignment Status Strip ---------- */

type PillTip = { title: string; body: string; next?: string; action: string };

function StatusPill({
  ok,
  icon: Icon,
  label,
  detail,
  assignLabel,
  onAction,
  okTip,
  missingTip,
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string | null;
  assignLabel: string;
  /** What the button inside the explanation does (open the plan, or assign one). */
  onAction: () => void;
  /** The explanation when it's in place. */
  okTip: PillTip;
  /** The explanation when it's missing. */
  missingTip: PillTip;
}) {
  const tip = ok ? okTip : missingTip;
  return (
    <StatusTip
      title={tip.title}
      body={tip.body}
      next={tip.next}
      icon={Icon}
      tone={ok ? "ok" : "danger"}
      footer={(close) => (
        <button
          type="button"
          className={actionClass(true)}
          onClick={() => {
            close();
            onAction();
          }}
        >
          {tip.action}
        </button>
      )}
      className={
        ok
          ? "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
          : "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive transition hover:bg-destructive/20"
      }
    >
      {ok ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <Icon className="h-3 w-3 shrink-0 opacity-80" />
          <span className="truncate">{detail ?? label}</span>
        </>
      ) : (
        <>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <Icon className="h-3 w-3 shrink-0" />
          <span className="truncate">{assignLabel}</span>
          <Plus className="h-3 w-3 shrink-0" />
        </>
      )}
    </StatusTip>
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
  // A block can still be showing (it ended within the last week) with nothing queued after it.
  const programEnded = hasProgram && r.f_missing_program;
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
          okTip={
            programEnded
              ? {
                  title: "Program has ended",
                  body: "Their last training block has finished and nothing is queued after it.",
                  next: "Assign the next block so they have workouts to do.",
                  action: "Assign program",
                }
              : {
                  title: "Training program running",
                  body: `Their current training block${prog ? `, week ${prog.week} of ${prog.totalWeeks}` : ""}.`,
                  action: "View schedule",
                }
          }
          missingTip={{
            title: "No training program",
            body: "No training program is running or queued for this client.",
            next: "Assign one so they have workouts to do.",
            action: "Assign program",
          }}
          onAction={() => (hasProgram && !programEnded ? setSheet("program-view") : setAssignProgramOpen(true))}
        />
        <StatusPill
          ok={hasNutrition}
          icon={Apple}
          label="Nutrition"
          detail={hasNutrition ? "Nutrition" : null}
          assignLabel="Assign Nutrition"
          okTip={{
            title: "Nutrition plan active",
            body: "Nutrition targets (calories, protein, meals) are assigned and showing in their app.",
            action: "View or edit",
          }}
          missingTip={{
            title: "No nutrition plan",
            body: "No active nutrition targets, so they see no calorie or protein goals in the app.",
            next: "Assign targets so they know what to aim for.",
            action: "Assign nutrition",
          }}
          onAction={() => setSheet("nutrition")}
        />
        <StatusPill
          ok={hasCardio}
          icon={HeartPulse}
          label="Cardio"
          detail={hasCardio ? "Cardio" : null}
          assignLabel="Assign Cardio"
          okTip={{
            title: "Cardio plan active",
            body: "A cardio plan is assigned and showing in their app.",
            action: "View or edit",
          }}
          missingTip={{
            title: "No cardio plan",
            body: "No active cardio targets, so they see no cardio goals in the app.",
            next: "Assign one if cardio is part of their coaching.",
            action: "Assign cardio",
          }}
          onAction={() => setSheet("cardio")}
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
                <StatusTip
                  title="Block dates"
                  body="The start and end dates of their current training block."
                  className="min-w-0 cursor-pointer truncate py-1"
                >
                  {range}
                </StatusTip>
              )}
              {prog && (
                <StatusTip
                  title="Time left in the block"
                  body="Days left in the current block, and how far through it they are by calendar time (not workouts completed)."
                  align="end"
                  className="shrink-0 cursor-pointer py-1"
                >
                  {prog.left}d left · {prog.pct}%
                </StatusTip>
              )}
            </div>
          )}
          {prog && (
            <StatusTip
              title="Block progress"
              body="How far through the current training block they are, by calendar time."
              label="Block progress"
              className="block w-full cursor-pointer py-1.5"
            >
              <Progress value={prog.pct} className="h-1.5" />
            </StatusTip>
          )}
        </>
      )}
      {r.next_block_id && (
        <StatusTip
          title="Next block queued"
          body="The next training block is already set up for this client, and this is when it starts. Nothing to do here."
          icon={ArrowRight}
          tone="info"
          className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-400"
        >
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
        </StatusTip>
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
          <StatusTip
            title={ended ? "Program has ended" : "No next block queued"}
            body={ended
              ? "Their program has ended and nothing is queued after it."
              : "Nothing is queued after their current block, so they'll run out of workouts when it ends."}
            next={ended ? "Assign or upload the next block." : "Assign or upload the next block before it ends."}
            icon={ended || ending ? AlertTriangle : Upload}
            tone={ended ? "danger" : ending ? "warn" : "muted"}
            footer={(close) => (
              <button
                type="button"
                className={actionClass(true)}
                onClick={() => {
                  close();
                  setAssignProgramOpen(true);
                }}
              >
                Assign next block
              </button>
            )}
            className={cn(
              "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition hover:brightness-110",
              tone,
            )}
          >
            {ended || ending ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Upload className="h-3 w-3 shrink-0" />}
            <span className="truncate">{label}</span>
            <Plus className="h-3 w-3 shrink-0" />
          </StatusTip>
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
    <li className="grid animate-pulse gap-3 rounded-xl border border-border bg-card p-4 xl:grid-cols-[1.4fr_1fr_1.3fr_auto]">
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
    </li>
  );
}
