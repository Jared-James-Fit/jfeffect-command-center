import { Link } from "@tanstack/react-router";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { ChevronRight, MoreHorizontal, MessageSquare, Eye, Archive, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BADGE_TONE, ACTION_ICON, actionStyle, rowBadges } from "./clients-status";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { format, parseISO, differenceInDays } from "date-fns";

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
  const ActionIcon = ACTION_ICON(r.next_action.kind);
  const urgent = r.priority <= 3;
  const prog = blockProgress(r.block_start, r.block_end);
  const range = fmtRange(r.block_start, r.block_end);

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
            className="h-11 w-11 shrink-0"
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
          {r.block_name ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium">{r.block_name}</div>
                {prog && (
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {prog.left}d left · {prog.pct}%
                  </div>
                )}
              </div>
              {range && <div className="text-[11px] text-muted-foreground">{range}</div>}
              {prog && <Progress value={prog.pct} className="h-1.5" />}
            </>
          ) : (
            <div className="text-xs italic text-muted-foreground">No active program</div>
          )}
        </div>

        {/* Next best action */}
        <div className="flex items-center justify-end gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="sm" className={cn("h-9 min-w-[8rem]", actionStyle(r.next_action, urgent))}>
                <Link to="/admin/clients/$id" params={{ id: r.id }}>
                  <ActionIcon className="mr-1.5 h-4 w-4" aria-hidden />
                  {r.next_action.label}
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Open this client to {r.next_action.label.toLowerCase()}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More client actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">{r.full_name}</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link to="/admin/clients/$id" params={{ id: r.id }} className="flex items-center gap-2">
                  <Eye className="h-4 w-4" /> Open client
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to="/admin/clients/$id"
                  params={{ id: r.id }}
                  search={{ tab: "messages" } as any}
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" /> Send message
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to="/admin/clients/$id"
                  params={{ id: r.id }}
                  search={{ tab: "basic" } as any}
                  className="flex items-center gap-2"
                >
                  <Pencil className="h-4 w-4" /> Edit client
                </Link>
              </DropdownMenuItem>
              {onArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onArchive(r)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Archive className="mr-2 h-4 w-4" /> Archive client
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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