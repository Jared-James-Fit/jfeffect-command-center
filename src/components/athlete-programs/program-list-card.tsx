import { Link } from "@tanstack/react-router";
import { Bookmark, CalendarCheck, Globe2, Lock, Play } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import {
  authorHandle,
  goalLabel,
  levelLabel,
  programMeta,
  type ProgramCard,
} from "@/lib/athlete-programs";

/**
 * One program in a list: what it is, who made it, how many people took it.
 * In your own list (`showAuthor` off) it says whether it's on your calendar,
 * shared or private, and whose program a copy came from.
 */
export function ProgramListCard({
  program: p,
  showAuthor = true,
  running = false,
}: {
  program: ProgramCard;
  showAuthor?: boolean;
  /** it's the program on your calendar */
  running?: boolean;
}) {
  const tags = [goalLabel(p.goal), levelLabel(p.level)].filter(Boolean) as string[];
  const copiedFrom = !showAuthor && p.forked_from?.author ? authorHandle(p.forked_from.author) : null;
  return (
    <Link
      to="/portal/programs/$programId"
      params={{ programId: p.id }}
      className="block rounded-2xl border border-border bg-card p-4 transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{p.title}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">{programMeta(p)}</div>
        </div>
        {running ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
            <CalendarCheck className="h-3 w-3" aria-hidden /> On your calendar
          </span>
        ) : p.is_mine && (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {p.hidden ? (
              "Taken down"
            ) : p.visibility === "community" ? (
              <>
                <Globe2 className="h-3 w-3" aria-hidden /> Shared
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" aria-hidden /> Private
              </>
            )}
          </span>
        )}
      </div>
      {copiedFrom && (
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">Copied from {copiedFrom}</div>
      )}
      {p.day_titles.length > 0 && (
        <div className="mt-2 truncate text-[13px]">{p.day_titles.join(" · ")}</div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        {showAuthor ? (
          <div className="flex min-w-0 items-center gap-2">
            <UserAvatar
              src={p.author?.avatar_url ?? null}
              name={p.author?.name ?? "?"}
              size={22}
              expandable={false}
            />
            <span className="truncate text-[13px] text-muted-foreground">
              {authorHandle(p.author)}
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3 text-[12px] text-muted-foreground">
          {p.save_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Bookmark className="h-3.5 w-3.5" aria-hidden />
              {p.save_count}
            </span>
          )}
          {p.start_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Play className="h-3.5 w-3.5" aria-hidden />
              {p.start_count}
            </span>
          )}
        </div>
      </div>
      {showAuthor && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
