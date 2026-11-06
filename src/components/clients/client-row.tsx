import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserAvatar } from "@/components/user-avatar";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { MoreHorizontal, CheckCircle2, Plus, Bell, Loader2, AlertTriangle, ListChecks, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { blockEnd } from "./clients-status";
import { rowMetaLine, rowStatusSummary, type RowAction, type RowStatus } from "./row-status";
import { StatusTip } from "./status-tip";
import { adminRemindAgreement } from "@/lib/coaching-agreement.functions";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { format, parseISO, differenceInDays } from "date-fns";
import { ClientMoreMenu } from "./quick-actions";
import { ClientQuickSheet, type QuickPanelKind } from "./client-quick-sheet";
import { AssignProgramDialog } from "./assign-program-dialog";
import { useAuth } from "@/lib/auth";
import { useEnterClientPov, clientWorkoutHref } from "@/components/clients/use-enter-client-pov";
import { toast } from "sonner";
import { markClientReviewsReviewed, refreshReviewQueries } from "@/lib/checkin-review";

/** Buttons inside a status explanation. The first is the main one. */
const actionClass = (primary: boolean) =>
  cn(buttonVariants({ variant: primary ? "default" : "secondary", size: "sm" }), "h-10 w-full text-sm");

/** Amber = needs the coach, red = failing or overdue. */
const CHIP_TONE: Record<RowStatus["tone"], string> = {
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};
const DOT_TONE: Record<RowStatus["tone"], string> = {
  warn: "bg-amber-500",
  danger: "bg-destructive",
};
/** The chip looks small; the button around it is a full 40px tap. */
const CHIP_BUTTON = "inline-flex min-h-10 max-w-full shrink-0 cursor-pointer items-center";
const CHIP = "inline-flex h-7 max-w-full items-center gap-1 truncate rounded-full border px-2.5 text-xs font-medium";

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

/** One-tap "this is handled": closes everything Review Due counts for the client. */
function MarkReviewedButton({ r, primary, close }: { r: DirectoryRow; primary: boolean; close: () => void }) {
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: () => markClientReviewsReviewed(r.id),
    onSuccess: (n) => {
      toast.success(n > 0 ? `Marked reviewed for ${r.full_name ?? "the client"}` : "Nothing was waiting");
      refreshReviewQueries(queryClient);
      close();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't mark this reviewed"),
  });
  return (
    <button type="button" className={actionClass(primary)} disabled={mark.isPending} onClick={() => mark.mutate()}>
      {mark.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
      Mark reviewed
    </button>
  );
}

/** The buttons a status explanation offers, by kind. */
function ChipActions({
  r, actions, isAdmin, close, onAssign,
}: { r: DirectoryRow; actions: RowAction[]; isAdmin: boolean; close: () => void; onAssign: () => void }) {
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
            return <Link key={a} to="/admin/messages" search={{ client: r.id }} className={cls} onClick={close}>Open check-in</Link>;
          case "mark_reviewed":
            return <MarkReviewedButton key={a} r={r} primary={i === 0} close={close} />;
          case "program":
            return <Link key={a} to="/admin/program-assign/$clientId" params={{ clientId: r.id }} className={cls} onClick={close}>Build next block</Link>;
          case "assign_program":
            return (
              <button key={a} type="button" className={cls} onClick={() => { close(); onAssign(); }}>
                Assign program
              </button>
            );
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

function nextBlockWhen(iso: string | null) {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return differenceInDays(d, new Date()) <= 0 ? "starts today" : format(d, "MMM d");
  } catch { return null; }
}

/**
 * One client in the Clients list: photo and name, one plain line of facts, at most one status chip
 * (the most important thing waiting on the coach, "+N" for the rest), the program's dates and
 * progress, then View Profile, Workout (client view on today's workout, to log or move it in a
 * session) and ⋯ (which holds every other action, View as client included).
 */
export function ClientRow({ r, onArchive, showCoach = false }: { r: DirectoryRow; onArchive?: (r: DirectoryRow) => void; showCoach?: boolean }) {
  const { primary, more } = rowStatusSummary(r);
  const meta = rowMetaLine(r, { showCoach, primary });
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const pov = useEnterClientPov();
  const enterPov = () => pov.enter(r.id, { fallbackName: r.full_name });
  // Mid-session: straight into today's workout as the client sees it (the same
  // way in as a session's "Open …'s workout"). Only with a program to open.
  const canOpenWorkout = pov.canPov && !!(r.block_id || r.next_block_id);
  const openWorkout = () => pov.enter(r.id, { to: clientWorkoutHref(), fallbackName: r.full_name });
  const [sheet, setSheet] = useState<QuickPanelKind | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const openAssign = () => setAssignOpen(true);

  return (
    <li
      className={cn(
        "group relative grid gap-3 rounded-2xl border border-border bg-card p-4 transition-colors",
        "hover:border-foreground/20",
        // desktop 4-area grid: identity | status | program | actions. Only at true desktop widths;
        // tablets keep the stacked layout so nothing overlaps.
        "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] xl:items-center",
      )}
    >
      {/* Identity: photo, name, one plain line of facts */}
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar src={r.profile_picture_url} name={r.full_name ?? "Client"} size={40} className="shrink-0" />
        <div className="min-w-0">
          <ClientNameLink clientId={r.id} className="block truncate text-[15px] font-semibold leading-snug hover:underline">
            {r.full_name || "(no name)"}
          </ClientNameLink>
          {meta && <div className="truncate text-xs text-muted-foreground" data-row-meta>{meta}</div>}
        </div>
      </div>

      {/* The one status that needs the coach most, then "+N" for the rest */}
      {primary || more.length ? (
        <div className="-my-1.5 flex min-w-0 items-center gap-1.5" data-row-status>
          {primary && <StatusChip r={r} s={primary} isAdmin={isAdmin} onAssign={openAssign} />}
          {more.length > 0 && <MoreStatuses r={r} statuses={more} />}
        </div>
      ) : (
        <div className="hidden xl:block" aria-hidden />
      )}

      {/* Program: what's running, its dates and how far through */}
      <ProgramSummary r={r} onSchedule={() => setSheet("program-view")} onAssign={openAssign} />

      {/* View Profile is the way in, Workout the way into today's session; everything else is in ⋯ */}
      <div className="flex items-center justify-end gap-1.5 max-xl:w-full">
        <Button asChild variant="secondary" size="sm" className="h-10 min-w-[7rem] flex-1 font-semibold xl:flex-none">
          <ClientNameLink clientId={r.id}>View Profile</ClientNameLink>
        </Button>
        {canOpenWorkout && (
          <Button
            variant="secondary"
            size="sm"
            className="h-10 min-w-[7rem] flex-1 font-semibold xl:flex-none"
            disabled={pov.busy}
            onClick={openWorkout}
            aria-label={`Open ${r.full_name ?? "the client"}'s workout for today, as they see it`}
          >
            {pov.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Dumbbell className="h-4 w-4" aria-hidden />}
            Workout
          </Button>
        )}
        <ClientMoreMenu
          r={r}
          onArchive={onArchive}
          onViewAsClient={pov.canPov ? enterPov : undefined}
          viewAsBusy={pov.busy}
          onAssignProgram={openAssign}
          onOpenPanel={setSheet}
          trigger={
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="More client actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
        />
      </div>

      <ClientQuickSheet kind={sheet} clientId={r.id} clientName={r.full_name} onClose={() => setSheet(null)} />
      <AssignProgramDialog open={assignOpen} onOpenChange={setAssignOpen} clientId={r.id} clientName={r.full_name} />
    </li>
  );
}

/** The row's one chip. "No program" is the way to assign one; anything else explains itself on a tap. */
function StatusChip({ r, s, isAdmin, onAssign }: { r: DirectoryRow; s: RowStatus; isAdmin: boolean; onAssign: () => void }) {
  if (s.id === "no_program") {
    return (
      <button type="button" onClick={onAssign} className={CHIP_BUTTON} aria-label={`No program. Assign one to ${r.full_name ?? "this client"}`}>
        <span className={cn(CHIP, CHIP_TONE[s.tone])}>
          {s.label}
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
      </button>
    );
  }
  return (
    <StatusTip
      title={s.label}
      body={s.hint}
      next={s.next}
      icon={s.tone === "danger" ? AlertTriangle : undefined}
      tone={s.tone}
      footer={s.actions?.length ? (close) => <ChipActions r={r} actions={s.actions!} isAdmin={isAdmin} close={close} onAssign={onAssign} /> : undefined}
      className={CHIP_BUTTON}
    >
      <span className={cn(CHIP, CHIP_TONE[s.tone])}>{s.label}</span>
    </StatusTip>
  );
}

/** "+2": what else applies, one tap away, with the profile to deal with it. */
function MoreStatuses({ r, statuses }: { r: DirectoryRow; statuses: RowStatus[] }) {
  return (
    <StatusTip
      title="Also needs you"
      label={`${statuses.length} more: ${statuses.map((s) => s.label).join(", ")}`}
      icon={ListChecks}
      body={
        <span className="mt-1 block space-y-2">
          {statuses.map((s) => (
            <span key={s.id} className="flex items-start gap-2">
              <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT_TONE[s.tone])} />
              <span className="min-w-0">
                <span className="block font-semibold text-foreground">{s.label}</span>
                <span className="block">{s.hint}</span>
              </span>
            </span>
          ))}
        </span>
      }
      footer={(close) => <ClientNameLink clientId={r.id} className={actionClass(true)} onClick={close}>Open profile</ClientNameLink>}
      className={cn(CHIP_BUTTON, "px-1 text-xs font-semibold text-muted-foreground hover:text-foreground")}
    >
      +{statuses.length}
    </StatusTip>
  );
}

/* ---------- Program ---------- */

function ProgramSummary({ r, onSchedule, onAssign }: { r: DirectoryRow; onSchedule: () => void; onAssign: () => void }) {
  const hasProgram = !!r.block_id;
  const prog = blockProgress(r.block_start, r.block_end);
  const range = fmtRange(r.block_start, r.block_end);
  const end = hasProgram ? blockEnd(r.block_end, r.next_block_id) : null;
  const nextWhen = nextBlockWhen(r.next_block_start);

  if (!hasProgram && !r.next_block_id) return <div className="hidden xl:block" aria-hidden />;

  return (
    <div className="min-w-0 space-y-1.5" data-row-program>
      {hasProgram && (
        <>
          <button
            type="button"
            onClick={onSchedule}
            className="block w-full truncate text-left text-[13px] font-medium hover:underline"
            aria-label={`Open ${r.full_name ?? "the client"}'s training schedule`}
          >
            {r.block_name ?? "Program"}
            {prog && <span className="text-muted-foreground"> · Week {prog.week} of {prog.totalWeeks}</span>}
          </button>
          {(range || end) && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{range}</span>
              {end?.needsNext ? (
                // Ending (or ended) with nothing after it: said where the dates are, with the fix one tap away.
                <button
                  type="button"
                  onClick={onAssign}
                  className={cn(
                    "-my-2 inline-flex shrink-0 items-center gap-0.5 py-2 font-semibold hover:underline",
                    end.state === "ended" ? "text-destructive" : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {end.label} · Next block
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              ) : end ? (
                <span className="shrink-0 tabular-nums">{end.state === "today" ? "Last day" : end.label}</span>
              ) : null}
            </div>
          )}
          {prog && (
            <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Block progress" aria-valuenow={prog.pct} aria-valuemin={0} aria-valuemax={100}>
              <span
                className={cn(
                  "block h-full rounded-full",
                  end?.needsNext ? (end.state === "ended" ? "bg-destructive" : "bg-amber-500") : "bg-foreground/60",
                )}
                style={{ width: `${prog.pct}%` }}
              />
            </span>
          )}
        </>
      )}
      {r.next_block_id && (
        <p className="truncate text-xs text-muted-foreground">
          Next: <span className="font-medium text-foreground">{r.next_block_name ?? "Next block"}</span>
          {nextWhen && <> · {nextWhen}</>}
        </p>
      )}
    </div>
  );
}

export function ClientRowSkeleton() {
  return (
    <li className="grid animate-pulse gap-3 rounded-2xl border border-border bg-card p-4 xl:grid-cols-[1.4fr_1fr_1.3fr_auto]">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-44 rounded bg-muted/60" />
        </div>
      </div>
      <div className="h-6 w-28 rounded-full bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-40 rounded bg-muted" />
        <div className="h-1.5 w-full rounded bg-muted/60" />
      </div>
      <div className="h-10 w-32 rounded-lg bg-muted" />
    </li>
  );
}
