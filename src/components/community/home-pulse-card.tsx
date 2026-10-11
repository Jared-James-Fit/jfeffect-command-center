import { useRef } from "react";
import { Activity, Heart, MessageCircle } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { pickWorkoutWin, postTimeLabel, workoutHeadline, type CommunityPost } from "@/lib/community";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { usePostViewTracker } from "@/components/community/post-views";

/**
 * Home's first card: the crew's latest finished session, from Pulse (who,
 * when, the session's one real win, likes and comments), tinted by the kind
 * of win, with how many others trained today. Tapping opens the post.
 */
export function HomePulseCard({ post, today, unit, onOpen }: { post: CommunityPost; today: number; unit: "kg" | "lb"; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  usePostViewTracker(ref, post);
  const s = post.stats!;
  const win = pickWorkoutWin(s, unit);
  const style = WIN_STYLE[win.kind];
  const name = post.is_mine ? "You" : post.author.name.split(" ")[0];
  const likes = post.reaction_count ?? 0;
  const others = Math.max(0, today - 1);
  return (
    <button
      ref={ref}
      type="button"
      data-crew-pulse={win.kind}
      onClick={onOpen}
      className={cn("relative flex h-full w-[82%] shrink-0 snap-center snap-always flex-col overflow-hidden rounded-[20px] bg-[#0b0b0e] p-3.5 text-left text-white transition-transform active:scale-[0.98]", style.tint)}
      aria-label={`Crew Pulse: ${name}, ${win.headline}`}
    >
      <span className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Crew Pulse</span>
        {others > 0 && <span className="ml-auto text-[10px] font-bold text-white/55">+{others} more today</span>}
      </span>
      <span className="mt-2.5 flex items-center gap-1.5">
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={24} expandable={false} />
        <span className="min-w-0 truncate text-[12px] font-bold">{name}</span>
        <span className="shrink-0 text-[11px] text-white/60">· {postTimeLabel(post.created_at)}</span>
      </span>
      <span className="mt-auto">
        <span className={cn("inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.14em]", style.text)}>
          <style.Icon className="h-3.5 w-3.5" /> {win.label}
        </span>
        <span className="font-display mt-1 block truncate text-[26px] uppercase leading-[1.02]">{win.headline}</span>
        <span className={cn("mt-0.5 block truncate text-[12px] font-semibold", win.kind === "pr" ? "text-amber-300" : "text-white/70")}>
          {[win.detail, workoutHeadline(s)].filter(Boolean).join(" · ")}
        </span>
      </span>
      {(likes > 0 || post.comment_count > 0) && (
        <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold backdrop-blur-sm">
          {likes > 0 && (
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5 fill-white" /> {likes}
            </span>
          )}
          {post.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> {post.comment_count}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
