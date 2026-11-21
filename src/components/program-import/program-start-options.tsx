import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Hammer, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export type StartWay = "follow" | "build" | "import";

/** The three ways to get a program, in one set of words for every screen that offers them. */
export const START_WAYS: Record<StartWay, { title: string; sub: string }> = {
  follow: { title: "Follow a program", sub: "A JF Effect plan written by our coaches. Pick one and start today." },
  build: { title: "Build my own", sub: "Choose the weeks and days, then fill them from the exercise library." },
  import: { title: "Import a program", sub: "From a spreadsheet, Word doc, PDF or photos. You check it before it's saved." },
};

const ICON = { follow: BookOpen, build: Hammer, import: Upload } as const;

/**
 * Follow a program · Build my own · Import a program, one tap each. Every way
 * ends in the same kind of program (the builder's plan), tracked the same way.
 * `follow` is a JF member's (a coaching client's coach writes their training).
 */
export function ProgramStartOptions({
  ways = ["follow", "build", "import"],
  onFollow,
  className,
}: {
  ways?: StartWay[];
  /** Follow opens the JF Effect plans here instead of linking to them. */
  onFollow?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card text-left", className)} data-program-start-options>
      {ways.map((w) => {
        const Icon = ICON[w];
        const body = (
          <>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{START_WAYS[w].title}</span>
              <span className="block text-[13px] leading-snug text-muted-foreground">{START_WAYS[w].sub}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </>
        );
        const cls =
          "flex min-h-[64px] w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 hover:bg-secondary/40 active:bg-secondary/60";
        if (w === "follow" && onFollow)
          return (
            <button key={w} type="button" onClick={onFollow} className={cls} data-start-way={w}>
              {body}
            </button>
          );
        return (
          <Link
            key={w}
            to={w === "follow" ? "/portal/programs" : w === "build" ? "/portal/programs/new" : "/portal/programs/import"}
            search={w === "follow" ? ({ tab: "jf" } as any) : undefined}
            className={cls}
            data-start-way={w}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}
