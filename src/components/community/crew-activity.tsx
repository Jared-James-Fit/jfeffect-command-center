import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Dumbbell, Heart, Lock, Play, Search, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { FollowButton, FollowRequestActions } from "@/components/community/follow-button";
import { SuggestedAthletes } from "@/components/community/suggested-athletes";
import { cn } from "@/lib/utils";
import type { CommunityAuthor } from "@/lib/community";
import { ACTIVITY_FILTERS, activityAge, activityLine, activitySections, matchesActivityFilter, type ActivityFilter, type ActivityItem } from "@/lib/crew-activity";
import { useActivityThumbs, useCrewActivity, useMarkCrewActivityRead } from "@/lib/crew-activity.queries";

/**
 * Crew Activity, like Instagram's: who liked, commented on, replied to or
 * followed you. New on top (what was unread when it opened, then it's read),
 * then Today / Yesterday / This week / Earlier. Follow back right on the line;
 * the post it's about on the right; people to follow at the bottom.
 */
export function CrewActivity({ onBack, onOpenPost, onOpenPerson, onFindPeople }: {
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onOpenPerson: (a: CommunityAuthor) => void;
  onFindPeople: () => void;
}) {
  const { data: items, isLoading, isError, refetch } = useCrewActivity(true);
  const markRead = useMarkCrewActivityRead();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  // what was new when they got here stays "New" while they're here (it's read now)
  const [newKeys, setNewKeys] = useState<Set<string> | null>(null);
  const marked = useRef(false);
  useEffect(() => {
    if (!items || marked.current) return;
    marked.current = true;
    const unread = items.filter((i) => i.unread);
    setNewKeys(new Set(unread.map((i) => i.key)));
    void markRead(unread);
  }, [items, markRead]);

  const shown = useMemo(() => (items ?? []).filter((i) => matchesActivityFilter(i, filter)), [items, filter]);
  const sections = useMemo(() => activitySections(shown, newKeys ?? new Set()), [shown, newKeys]);
  const thumbs = useActivityThumbs((items ?? []).map((i) => i.post_thumb));

  return (
    <div className="space-y-3" data-crew-activity>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onBack} className="-ml-2 grid h-10 w-10 place-items-center rounded-full active:bg-muted" aria-label="Back to the feed">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 text-[20px] font-black tracking-tight">Activity</h1>
        <button type="button" onClick={onFindPeople} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Find people">
          <Search className="h-5 w-5" />
        </button>
      </div>
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Show">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn("h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors", filter === f.key ? "bg-primary/12 text-primary ring-1 ring-primary/25" : "bg-muted text-foreground active:bg-muted/70")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3 pt-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-11 w-11 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <button type="button" onClick={() => void refetch()} className="w-full rounded-2xl border border-border/80 bg-card p-5 text-center text-sm text-muted-foreground">
          Couldn't load your activity. Tap to try again.
        </button>
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center" data-activity-empty>
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-foreground/80">
            <Heart className="h-7 w-7" />
          </span>
          <div className="mt-3 text-[16px] font-black">{filter === "all" ? "Nothing here yet" : `No ${ACTIVITY_FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} yet`}</div>
          <p className="mt-1 max-w-[260px] text-[13px] text-muted-foreground">When people like or comment on your posts or follow you, you'll see it here.</p>
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.key} aria-label={s.label} data-activity-section={s.key}>
            <h2 className="mb-1 mt-2 text-[15px] font-black">{s.label}</h2>
            <ul>
              {s.items.map((it) => (
                <ActivityRow key={it.key} it={it} isNew={s.key === "new"} thumb={it.post_thumb ? thumbs[it.post_thumb] ?? null : null} onOpenPost={onOpenPost} onOpenPerson={onOpenPerson} />
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Instagram ends Activity with people to follow */}
      <div className="pt-2">
        <SuggestedAthletes onOpen={onOpenPerson} onSeeAll={onFindPeople} />
      </div>
    </div>
  );
}

function ActivityRow({ it, isNew, thumb, onOpenPost, onOpenPerson }: {
  it: ActivityItem;
  isNew: boolean;
  thumb: string | null;
  onOpenPost: (postId: string) => void;
  onOpenPerson: (a: CommunityAuthor) => void;
}) {
  const line = activityLine(it);
  const actors = it.actors ?? [];
  const first = actors[0];
  const open = () => {
    if (it.kind === "follow" || it.kind === "follow_request") return first && onOpenPerson(first);
    if (it.post_id) onOpenPost(it.post_id);
  };
  return (
    <li className={cn("-mx-3 flex items-center gap-3 px-3 py-2", isNew && "bg-primary/[0.06]")} data-activity-row={it.kind}>
      <button type="button" onClick={() => first && onOpenPerson(first)} className="relative h-11 w-11 shrink-0 active:opacity-80" aria-label={first ? `${first.name}'s profile` : undefined}>
        {actors.length > 1 ? (
          // two people: Instagram's stacked pair
          <>
            <span className="absolute left-0 top-0">
              <UserAvatar src={actors[1].avatar_url} name={actors[1].name} size={32} expandable={false} />
            </span>
            <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-background">
              <UserAvatar src={actors[0].avatar_url} name={actors[0].name} size={32} expandable={false} />
            </span>
          </>
        ) : (
          <UserAvatar src={first?.avatar_url ?? null} name={first?.name ?? "Someone"} size={44} expandable={false} />
        )}
      </button>
      <button type="button" onClick={open} className="min-w-0 flex-1 text-left text-[14px] leading-snug active:opacity-70">
        <span className="line-clamp-3 break-words">
          {line.names.map((n, i) => (
            <span key={i}>
              {i > 0 && (i === line.names.length - 1 && !line.others ? " and " : ", ")}
              <b className="font-bold">{n}</b>
            </span>
          ))}
          {line.others > 0 && (
            <>
              {" and "}
              <b className="font-bold">{line.others === 1 ? "1 other" : `${line.others} others`}</b>
            </>
          )}{" "}
          {line.action}
          {line.quote && <> {line.quote}</>} <span className="text-muted-foreground">{activityAge(it.at)}</span>
        </span>
      </button>
      {it.kind === "follow_request" ? (
        first ? <FollowRequestActions userId={first.user_id} /> : null
      ) : it.kind === "follow" ? (
        first ? <FollowButton userId={first.user_id} name={first.name} size="sm" /> : null
      ) : (
        <PostThumb it={it} url={thumb} onOpen={open} />
      )}
    </li>
  );
}

/** The post the line is about: its photo, or what kind of post it was. */
function PostThumb({ it, url, onOpen }: { it: ActivityItem; url: string | null; onOpen: () => void }) {
  const Icon = it.post_media === "video" ? Play : it.win ? Trophy : it.post_kind === "lockin" ? Lock : Dumbbell;
  return (
    <button type="button" onClick={onOpen} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted active:opacity-80" aria-label="Open the post" data-activity-thumb={url ? "photo" : it.post_text ? "text" : "icon"}>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : it.post_text ? (
        <span className="block h-full w-full overflow-hidden p-1 text-left text-[7px] font-semibold leading-[1.15] text-foreground">{it.post_text}</span>
      ) : (
        <span className="grid h-full w-full place-items-center text-foreground/75">
          <Icon className="h-5 w-5" />
        </span>
      )}
      {url && it.post_media === "video" && (
        <span className="absolute inset-0 grid place-items-center bg-black/20 text-white">
          <Play className="h-4 w-4 fill-white" />
        </span>
      )}
    </button>
  );
}
