import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink, MessageSquare, User as UserIcon, LibraryBig } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function initialsOf(name: string | null | undefined) {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function statusTone(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (s === "completed") return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  if (s === "archived") return "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"; // Draft etc.
}

/**
 * Identity header for the client workout builder. Makes it unambiguous
 * which client + Program + Block the coach is editing. Renders a full
 * header that scrolls with the page and a compact sticky bar underneath
 * the admin nav with the same identity in shorthand.
 */
export function ClientBuilderIdentityHeader(props: {
  clientId: string;
  clientName: string;
  clientAvatarUrl?: string | null;
  programName?: string | null;
  blockName: string;
  blockStatus?: string | null;
  currentWeek?: number | null;
  totalWeeks?: number | null;
  unsaved: boolean;
  className?: string;
}) {
  const {
    clientId, clientName, clientAvatarUrl, programName, blockName,
    blockStatus, currentWeek, totalWeeks, unsaved,
  } = props;

  return (
    <div className={cn("rounded-lg border border-primary/30 bg-[color-mix(in_oklab,var(--primary)_5%,var(--card))] p-3 shadow-sm", props.className)}>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        <Link to="/admin/clients" className="hover:text-foreground">Clients</Link>
        <ChevronRight className="h-3 w-3 opacity-50" />
        <Link
          to="/admin/clients/$id"
          params={{ id: clientId }}
          className="max-w-[28ch] truncate hover:text-foreground"
          title={clientName}
        >
          {clientName}
        </Link>
        <ChevronRight className="h-3 w-3 opacity-50" />
        <span className="text-muted-foreground/70">Programs</span>
        <ChevronRight className="h-3 w-3 opacity-50" />
        <span className="max-w-[28ch] truncate text-foreground" title={blockName}>{blockName}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <Avatar className="h-10 w-10 shrink-0 border border-primary/30">
          {clientAvatarUrl ? <AvatarImage src={clientAvatarUrl} alt={clientName} /> : null}
          <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
            {initialsOf(clientName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-[10px] uppercase tracking-wide text-primary">
              <UserIcon className="h-3 w-3" /> Client Program
            </Badge>
            {blockStatus ? (
              <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-medium", statusTone(blockStatus))}>
                {blockStatus}
              </span>
            ) : null}
            {unsaved ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Unsaved changes for <span className="font-semibold">{clientName}</span>
              </span>
            ) : null}
          </div>
          <h1 className="mt-0.5 truncate text-base font-bold leading-tight md:text-lg" title={`Editing ${clientName}'s Program`}>
            Editing <span className="text-primary">{clientName}</span>'s Program
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {[programName, blockName, totalWeeks ? `${totalWeeks} week${totalWeeks === 1 ? "" : "s"}` : null, currentWeek ? `Week ${currentWeek}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          <Link
            to="/admin/clients/$id"
            params={{ id: clientId }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> View profile
          </Link>
          <Link
            to="/admin/clients/$id"
            params={{ id: clientId }}
            search={{ tab: "messages" } as any}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-3 w-3" /> Messages
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Sticky compact identity bar — shown alongside the existing toolbar so the
 * coach always sees whose Program is open, even when the full header has
 * scrolled off. Truncates long names cleanly on mobile.
 */
export function ClientBuilderStickyChip(props: {
  clientId: string;
  clientName: string;
  blockName: string;
  currentWeek?: number | null;
}) {
  const { clientId, clientName, blockName, currentWeek } = props;
  return (
    <Link
      to="/admin/clients/$id"
      params={{ id: clientId }}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15"
      title={`${clientName} · ${blockName}${currentWeek ? ` · Week ${currentWeek}` : ""}`}
    >
      <UserIcon className="h-3 w-3 shrink-0" />
      <span className="max-w-[18ch] truncate font-semibold sm:max-w-[28ch]">{clientName}</span>
      <span className="hidden text-primary/60 sm:inline">·</span>
      <span className="hidden max-w-[18ch] truncate text-primary/80 sm:inline">{blockName}</span>
      {currentWeek ? (
        <>
          <span className="text-primary/60">·</span>
          <span className="shrink-0 text-primary/80">W{currentWeek}</span>
        </>
      ) : null}
    </Link>
  );
}

/**
 * Compact template badge to make the reusable-template editor visually
 * distinct from the client builder.
 */
export function TemplateBuilderIdentityBadge(props: { templateName: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400", props.className)}>
      <LibraryBig className="h-3 w-3" /> Program Template
    </span>
  );
}