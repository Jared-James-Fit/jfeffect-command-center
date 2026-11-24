import { Link } from "@tanstack/react-router";
import { ChevronRight, Compass, Hammer, LayoutGrid, Upload, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyDrafts } from "@/lib/program-history-queries";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { useOpenImports } from "@/lib/program-import/queries";

export type ProgramsAction = "explore" | "build" | "import" | "crew";

/** The four ways into a program, one set of words for every screen that offers them. */
export const PROGRAMS_ACTIONS: Record<
  ProgramsAction,
  { label: string; hint: string; icon: typeof Compass }
> = {
  explore: { label: "Explore", hint: "JF Effect plans", icon: Compass },
  build: { label: "Build", hint: "Your own program", icon: Hammer },
  import: { label: "Import", hint: "One you already have", icon: Upload },
  crew: { label: "Crew", hint: "Shared by members", icon: Users },
};

/** Which actions someone gets: a coaching client's coach writes their training, so no plans to follow. */
export function programsActionsFor(isSelfServe: boolean): ProgramsAction[] {
  return isSelfServe ? ["explore", "build", "import", "crew"] : ["build", "import", "crew"];
}

const HREF: Record<ProgramsAction, { to: string; search?: Record<string, string> }> = {
  explore: { to: "/portal/programs", search: { tab: "jf" } },
  build: { to: "/portal/programs/new" },
  import: { to: "/portal/programs/import" },
  crew: { to: "/portal/programs", search: { tab: "crew" } },
};

/** "2 drafts · 1 import to check": what's waiting, only when something is. */
export function waitingLine(
  drafts: number,
  imports: { ready: number; reading: number },
): string | null {
  const parts: string[] = [];
  if (drafts) parts.push(`${drafts} ${drafts === 1 ? "draft" : "drafts"}`);
  if (imports.ready)
    parts.push(`${imports.ready} ${imports.ready === 1 ? "import" : "imports"} to check`);
  if (imports.reading) parts.push(`${imports.reading} being read`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Programs, always on Workouts (Nov 24 2026): the four ways into a program
 * as one row of equal tiles (Explore, Build, Import, Crew), and My programs
 * one tap away, saying when a draft or an import is waiting. It sits under
 * the day's workout and the program card, so training stays first. A
 * coaching client gets Build, Import and Crew (their coach writes what's on
 * their calendar) and a line saying what they build is their own.
 */
export function ProgramsCard({
  isSelfServe,
  className,
}: {
  isSelfServe: boolean;
  className?: string;
}) {
  const actions = programsActionsFor(isSelfServe);
  // drafts and imports are the signed-in login's own: a coach viewing as a client never sees theirs here
  const previewing = useViewingAsClient();
  const drafts = useMyDrafts(!previewing);
  const imports = useOpenImports(!previewing);
  const rows = previewing ? [] : (imports.data ?? []);
  const waiting = waitingLine(previewing ? 0 : (drafts.data?.length ?? 0), {
    ready: rows.filter((r) => r.status === "ready").length,
    reading: rows.filter((r) => r.status === "pending" || r.status === "reading").length,
  });

  return (
    <section
      className={cn("rounded-2xl border border-border bg-card", className)}
      aria-labelledby="programs-card-title"
      data-programs-card
    >
      <div className="flex items-center gap-2 px-4 pt-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 id="programs-card-title" className="text-[16px] font-semibold">
          Programs
        </h2>
        <Link
          to="/portal/programs"
          search={{ tab: "mine" } as any}
          className="-mr-2 ml-auto inline-flex min-h-10 items-center gap-0.5 rounded-lg px-2 text-[14px] font-medium text-muted-foreground hover:text-foreground"
          data-programs-mine
        >
          My programs <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {!isSelfServe && (
        <p
          className="px-4 text-[12.5px] leading-snug text-muted-foreground"
          data-programs-coached-note
        >
          Your coach writes your training. What you build here is yours and never changes it.
        </p>
      )}
      <div
        className={cn(
          "grid gap-1 px-2 pb-2 pt-0.5",
          actions.length === 4 ? "grid-cols-4" : "grid-cols-3",
        )}
        data-programs-actions
      >
        {actions.map((a) => {
          const { label, hint, icon: Icon } = PROGRAMS_ACTIONS[a];
          const href = HREF[a];
          return (
            <Link
              key={a}
              to={href.to as any}
              search={href.search as any}
              className="group flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center transition hover:bg-muted/60 active:scale-[0.98]"
              aria-label={`${label}: ${hint}`}
              data-programs-action={a}
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-muted transition group-hover:bg-background">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-[13px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
      {waiting && (
        <Link
          to="/portal/programs"
          search={{ tab: "mine" } as any}
          className="flex min-h-11 items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[13.5px] transition hover:bg-muted/40"
          data-programs-waiting
        >
          <span className="min-w-0 truncate">
            <span className="font-medium">Waiting for you</span>
            <span className="text-muted-foreground"> · {waiting}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}
    </section>
  );
}
