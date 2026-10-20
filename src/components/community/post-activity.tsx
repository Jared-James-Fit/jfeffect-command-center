import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Eye, Heart, Repeat2, Send, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { FollowButton } from "@/components/community/follow-button";
import { cn } from "@/lib/utils";
import { activityDid, activityPeople, pickWorkoutWin, postTimeLabel, reactionEmoji, storyFrameKind, storyWords, type ActivityFilter, type ActivityPerson, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { usePostActivity, usePostMediaUrls } from "@/lib/community.queries";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

/** View posts privately: counted, never named, on everyone's Activity. */
function useSetPrivateViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_set_private_views", { _on: on });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-post-activity"] }),
  });
}

/**
 * Instagram's Activity for something you posted, only you can open it: how
 * many saw it, liked it, added it to their story and reposted it, then the
 * people, whoever did the most first (shared, reposted, liked, then just
 * viewed), each with what they did and when, Follow right there. On your
 * story the strip at the top is your moments: tap one to see its Activity
 * (the story behind moves to it). People who view privately are counted,
 * never named.
 */
export function PostActivitySheet({
  postId,
  start = "all",
  story = false,
  moments,
  onPick,
  onClose,
  onOpenAuthor,
}: {
  postId: string | null;
  start?: ActivityFilter;
  /** A story: it can't be shared or reposted, so only views and likes. */
  story?: boolean;
  /** Your story's moments, oldest first. */
  moments?: CommunityPost[];
  onPick?: (id: string) => void;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
}) {
  const { data, isLoading, isError, refetch } = usePostActivity(postId);
  const setPrivate = useSetPrivateViews();
  const [filter, setFilter] = useState<ActivityFilter>(start);
  // each opening starts where it was asked to (Seen by: everyone; the hearts: likes)
  useEffect(() => {
    if (postId) setFilter(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!postId, start]);
  const shared = data ? data.shares + data.reposts : 0;
  const stats: { key: string; Icon: typeof Eye; n: number; label: string }[] = data
    ? [
        { key: "views", Icon: Eye, n: data.views, label: data.views === 1 ? "View" : "Views" },
        { key: "likes", Icon: Heart, n: data.likes, label: data.likes === 1 ? "Like" : "Likes" },
        ...(story
          ? []
          : [
              { key: "shares", Icon: Send, n: data.shares, label: data.shares === 1 ? "Share" : "Shares" },
              { key: "reposts", Icon: Repeat2, n: data.reposts, label: data.reposts === 1 ? "Repost" : "Reposts" },
            ]),
      ]
    : [];
  const chips: { f: ActivityFilter; label: string }[] = data
    ? [
        { f: "all", label: "All" },
        ...(data.likes > 0 ? [{ f: "likes" as const, label: `Likes ${data.likes}` }] : []),
        ...(!story && shared > 0 ? [{ f: "shares" as const, label: `Shares ${shared}` }] : []),
      ]
    : [];
  const people = data ? activityPeople(data.people, filter) : [];
  const picked = moments && moments.length > 1 && onPick;
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="flex max-h-[80dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-post-activity>
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-3 pt-3 text-left">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-black">Activity</SheetTitle>
              <SheetDescription className="text-[12px]">Only you can see this</SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          {picked && <MomentStrip moments={moments} current={postId} onPick={onPick} />}
          {data && (
            <div className={cn("mt-3 grid gap-1.5", stats.length === 2 ? "grid-cols-2" : "grid-cols-4")} data-activity-stats>
              {stats.map(({ key, Icon, n, label }) => (
                <div key={key} className="flex flex-col items-center rounded-2xl bg-muted/70 px-1 py-2">
                  <Icon className={cn("h-[18px] w-[18px]", key === "likes" && n > 0 && "fill-[#ef3340] text-[#ef3340]")} strokeWidth={2} />
                  <span className="mt-1 text-[16px] font-black tabular-nums leading-none">{n}</span>
                  <span className="mt-1 text-[11px] font-semibold text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          )}
          {chips.length > 1 && (
            <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Show">
              {chips.map((c) => (
                <button
                  key={c.f}
                  type="button"
                  role="tab"
                  aria-selected={filter === c.f}
                  onClick={() => setFilter(c.f)}
                  className={cn("h-8 rounded-full px-3.5 text-[13px] font-bold active:scale-95", filter === c.f ? "bg-foreground text-background" : "bg-muted text-foreground")}
                  data-activity-chip={c.f}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {isLoading && (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-11 rounded-xl" />
              ))}
            </div>
          )}
          {isError && (
            <button type="button" onClick={() => void refetch()} className="w-full p-6 text-center text-[13px] text-muted-foreground">
              Couldn't load this. Tap to try again.
            </button>
          )}
          {people.map((p) => (
            <ActivityRow key={p.user_id} p={p} onOpen={onOpenAuthor ? () => (onClose(), onOpenAuthor(p)) : undefined} />
          ))}
          {data && people.length === 0 && (
            <p className="p-6 text-center text-[13px] text-muted-foreground">
              {filter === "likes" ? "No likes yet." : filter === "shares" ? "Nobody's shared it yet." : data.private_count > 0 ? "Only private views so far." : "No views yet."}
            </p>
          )}
          {data && filter === "all" && data.private_count > 0 && (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              + {data.private_count} {data.private_count === 1 ? "person" : "people"} viewed privately
            </p>
          )}
        </div>
        {data && (
          <label className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            <span className="min-w-0">
              <span className="block text-[13px] font-bold">View posts privately</span>
              <span className="block text-[11px] text-muted-foreground">You still count as a view, without your name</span>
            </span>
            <Switch checked={data.me_private} disabled={setPrivate.isPending} onCheckedChange={(on) => setPrivate.mutate(on)} />
          </label>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One person: their photo with what they did on it (♥ / emoji, shared, reposted), then the words and when. */
function ActivityRow({ p, onOpen }: { p: ActivityPerson; onOpen?: () => void }) {
  const did = activityDid(p);
  const badge = p.shared_at ? (
    <Send className="h-2.5 w-2.5" strokeWidth={3} />
  ) : p.reposted_at ? (
    <Repeat2 className="h-2.5 w-2.5" strokeWidth={3} />
  ) : p.reaction ? (
    p.reaction === "heart" ? <Heart className="h-2.5 w-2.5 fill-white" strokeWidth={0} /> : <span className="text-[10px] leading-none">{reactionEmoji(p.reaction)}</span>
  ) : null;
  const tint = p.shared_at ? "bg-[#7c3aed]" : p.reposted_at ? "bg-emerald-500" : p.reaction === "heart" ? "bg-[#ef3340]" : "bg-card";
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-1.5" data-activity-person>
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70 disabled:active:opacity-100">
        <span className="relative shrink-0">
          <UserAvatar src={p.avatar_url} name={p.name} size={44} expandable={false} />
          {badge && <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full text-white ring-2 ring-background", tint)}>{badge}</span>}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1 text-[14px] font-bold">
            <span className="truncate">{p.name}</span>
            {p.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {did.label}
            {did.at ? ` · ${postTimeLabel(did.at)}` : ""}
          </span>
        </span>
      </button>
      <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} size="sm" tone="soft" />
    </div>
  );
}

/** Your story's moments, small, as on Instagram's viewer list: the one you're on is ringed. */
function MomentStrip({ moments, current, onPick }: { moments: CommunityPost[]; current: string | null; onPick: (id: string) => void }) {
  const { data: urls } = usePostMediaUrls(moments);
  return (
    <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-activity-moments>
      {moments.map((m, i) => {
        const path = m.media_thumb_path ?? (m.media_type === "image" ? m.media_path : null);
        const src = (path && urls?.[path]) || (m.media_type ? null : m.gif_url ?? null);
        const kind = storyFrameKind(m);
        const on = m.id === current;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => !on && onPick(m.id)}
            aria-pressed={on}
            aria-label={`Moment ${i + 1}`}
            className={cn("relative h-[76px] w-[46px] shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-offset-2 ring-offset-background active:scale-95", on ? "ring-2 ring-foreground" : "opacity-75")}
          >
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <span className="line-clamp-4 p-1 text-left text-[7px] font-bold leading-tight text-white/85">{kind === "lesson" ? m.caption?.trim().split("\n")[0] || "Lesson" : kind === "win" && m.stats ? pickWorkoutWin(m.stats, "kg").headline : storyWords(m).text}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
