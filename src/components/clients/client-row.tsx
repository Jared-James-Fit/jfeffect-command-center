import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  ChevronRight, MoreHorizontal, CalendarDays, Dumbbell,
  Apple, HeartPulse, CheckCircle2, AlertCircle, Plus,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BADGE_TONE, ACTION_ICON, actionStyle, rowBadges } from "./clients-status";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import type { DirectoryNextAction } from "@/lib/clients-directory.functions";
import { format, parseISO, differenceInDays } from "date-fns";
import { QuickActionsMenu, ClientMoreMenu } from "./quick-actions";
import { ClientQuickSheet, type QuickPanelKind } from "./client-quick-sheet";
import { AssignProgramDialog } from "./assign-program-dialog";

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
    return { pct, left };
  } catch { return null; }
}

export function ClientRow({ r, onArchive }: { r: DirectoryRow; onArchive?: (r: DirectoryRow) => void }) {
  const badges = rowBadges(r);
  const urgent = r.priority <= 3;
  const prog = blockProgress(r.block_start, r.block_end);
  const range = fmtRange(r.block_start, r.block_end);
  const actionTarget = primaryActionTarget(r.next_action, r.id);

  return (
    <TooltipProvider delayDuration={300}>
      <li
        className={cn(
          "group relative grid gap-3 rounded-xl border border-border bg-card p-4 transition",
          "hover:border-primary/30 hover:bg-accent/20",
          // desktop 5-area grid: identity | status | program | action | open
          "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto] md:items-center",
        )}
      >
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar
            src={r.profile_picture_url}
            name={r.full_name ?? "Client"}
            size={44}
            expandable={false}
            className="shrink-0"
          />
          <div className="min-w-0">
            <Link
              to="/admin/clients/$id"
              params={{ id: r.id }}
              className="block truncate text-sm font-semibold hover:underline"
            >
              {r.full_name || "(no name)"}
            </Link>
            <div className="truncate text-xs text-muted-foreground">{r.email || "—"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {r.coaching_type && (
                <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5">
                  {r.coaching_type}
                </span>
              )}
              {r.coach_name && (
                <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5">
                  Coach · {r.coach_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((b, i) => {
            const Icon = b.icon;
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  BADGE_TONE[b.tone],
                )}
              >
                {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                {b.label}
              </span>
            );
          })}
        </div>

        {/* Program summary */}
        <div className="min-w-0 space-y-1.5">
          <AssignmentStatusStrip r={r} prog={prog} range={range} />
        </div>

        {/* Next best action */}
        <div className="flex items-center justify-end gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="sm" className={cn("h-9 min-w-[8rem]", actionStyle(r.next_action, urgent))}>
                {actionTarget}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{r.next_action.label}</TooltipContent>
          </Tooltip>

          <QuickActionsMenu r={r} />

          <ClientMoreMenu
            r={r}
            onArchive={onArchive}
            trigger={
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More client actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />

          <Link
            to="/admin/clients/$id"
            params={{ id: r.id }}
            aria-label={`Open ${r.full_name ?? "client"}`}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
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
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string | null;
  assignLabel: string;
  onClick: () => void;
}) {
  if (ok) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
        title={`${label}${detail ? ` · ${detail}` : ""}`}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <Icon className="h-3 w-3 shrink-0 opacity-80" />
        <span className="truncate">{detail ?? label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive transition hover:bg-destructive/20"
      title={`No ${label.toLowerCase()} assigned — click to assign`}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{assignLabel}</span>
      <Plus className="h-3 w-3 shrink-0" />
    </button>
  );
}

function AssignmentStatusStrip({
  r,
  prog,
  range,
}: {
  r: DirectoryRow;
  prog: { pct: number; left: number } | null;
  range: string | null;
}) {
  const hasProgram = !!r.block_id;
  const hasNutrition = !!r.nut_end && !r.f_missing_nutrition;
  const hasCardio = !!r.card_end && !r.f_missing_cardio;
  const [sheet, setSheet] = useState<QuickPanelKind | null>(null);
  const [assignProgramOpen, setAssignProgramOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill
          ok={hasProgram}
          icon={Dumbbell}
          label="Program"
          detail={r.block_name}
          assignLabel="Assign Program"
          onClick={() => (hasProgram ? setSheet("program-view") : setAssignProgramOpen(true))}
        />
        <StatusPill
          ok={hasNutrition}
          icon={Apple}
          label="Nutrition"
          detail={hasNutrition ? "Nutrition" : null}
          assignLabel="Assign Nutrition"
          onClick={() => setSheet("nutrition")}
        />
        <StatusPill
          ok={hasCardio}
          icon={HeartPulse}
          label="Cardio"
          detail={hasCardio ? "Cardio" : null}
          assignLabel="Assign Cardio"
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
            <TooltipContent side="top">View schedule</TooltipContent>
          </Tooltip>
        )}
      </div>
      {hasProgram && (
        <>
          {(range || prog) && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              {range && <span className="truncate">{range}</span>}
              {prog && (
                <span className="shrink-0">
                  {prog.left}d left · {prog.pct}%
                </span>
              )}
            </div>
          )}
          {prog && <Progress value={prog.pct} className="h-1.5" />}
        </>
      )}
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
        <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "nutrition" } as any}>{label}</Link>
      );
    case "cardio":
      return (
        <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "cardio" } as any}>{label}</Link>
      );
    case "review":
      return (
        <Link to="/admin/check-in-reviews">{label}</Link>
      );
    case "payment":
      return (
        <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "billing" } as any}>{label}</Link>
      );
    case "setup":
      return (
        <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "account" } as any}>{label}</Link>
      );
    case "open":
    default:
      return (
        <Link to="/admin/clients/$id" params={{ id: clientId }}>{label}</Link>
      );
  }
}

export function ClientRowSkeleton() {
  return (
    <li className="grid animate-pulse gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1.4fr_1fr_1.3fr_auto_auto]">
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