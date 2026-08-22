import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { WorkspaceAction, WorkspaceTone } from "./types";

const TONE_TO_BUTTON: Record<WorkspaceTone, { variant: "outline" | "default"; extra: string }> = {
  default: { variant: "outline", extra: "" },
  primary: { variant: "default", extra: "" },
  warn: { variant: "outline", extra: "bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25" },
  rose: { variant: "outline", extra: "bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25" },
  success: { variant: "outline", extra: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25" },
};

/**
 * Data-driven action grid. Coaching and Membership both feed different action
 * arrays into the same component. Layout, sizing, tap targets stay identical.
 */
export function WorkspaceActionCenter({
  actions,
  heading = "Actions",
  className,
  maxVisible,
}: {
  actions: WorkspaceAction[];
  heading?: string | null;
  className?: string;
  /**
   * When set, only the first N actions render as buttons and the rest collapse
   * into a "More" menu — keeps the client workspace header compact so the
   * coach sees client data instead of a wall of buttons.
   */
  maxVisible?: number;
}) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  const primary = maxVisible ? visible.slice(0, maxVisible) : visible;
  const overflow = maxVisible ? visible.slice(maxVisible) : [];

  const renderButton = (a: WorkspaceAction) => {
    const Icon = a.icon;
    const tone = TONE_TO_BUTTON[a.tone ?? "default"];
    const btn = (
      <Button
        variant={tone.variant}
        disabled={a.disabled}
        onClick={a.onClick}
        aria-label={a.ariaLabel ?? a.label}
        className={`min-h-[48px] w-full justify-start text-sm ${tone.extra}`}
      >
        <Icon className="mr-2 h-4 w-4" /> {a.label}
      </Button>
    );
    if (a.to) {
      return (
        <Link key={a.key} to={a.to as any} params={a.params as any} className="block">
          {btn}
        </Link>
      );
    }
    return <div key={a.key}>{btn}</div>;
  };

  return (
    <div className={className ?? "mb-4"}>
      {heading && (
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {heading}
        </div>
      )}
      <div
        className={
          maxVisible
            ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
            : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        }
      >
        {primary.map(renderButton)}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-h-[48px] w-full justify-start text-sm">
                <MoreHorizontal className="mr-2 h-4 w-4" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {overflow.map((a) => {
                const Icon = a.icon;
                const item = (
                  <DropdownMenuItem
                    key={a.key}
                    disabled={a.disabled}
                    onSelect={() => a.onClick?.()}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4" /> {a.label}
                  </DropdownMenuItem>
                );
                if (a.to) {
                  return (
                    <Link key={a.key} to={a.to as any} params={a.params as any}>
                      {item}
                    </Link>
                  );
                }
                return item;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}