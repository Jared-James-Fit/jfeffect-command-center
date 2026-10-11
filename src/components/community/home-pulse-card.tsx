import { useRef } from "react";
import { Activity } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { pickWorkoutWin, postTimeLabel, type CommunityPost } from "@/lib/community";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { usePostViewTracker } from "@/components/community/post-views";

/**
 * Home's first card: the crew's latest finished sessions, from Pulse, one
 * small row each (who, the session's one real win, when), with how many
 * others trained today. The card is tinted by the newest row's win; tapping
 * a row opens that post.
 */
export function HomePulseCard({ posts, today, unit, onOpen }: { posts: CommunityPost[]; today: number; unit: "kg" | "lb"; onOpen: (postId: string) => void }) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const listedToday = posts.filter((p) => new Date(p.created_at) >= midnight).length;
  const others = Math.max(0, today - listedToday);
  const top = WIN_STYLE[pickWorkoutWin(posts[0].stats!, unit).kind];
  return (
    <div
      data-crew-pulse
      className={cn("relative flex h-full w-[82%] shrink-0 snap-center snap-always flex-col overflow-hidden rounded-[20px] bg-[#0b0b0e] p-3.5 text-white", top.tint)}
      aria-label="Crew Pulse"
    >
      <span className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Pulse</span>
        {others > 0 && <span className="ml-auto text-[10px] font-bold text-white/55">+{others} more today</span>}
      </span>
      <ul className="mt-2 flex flex-1 flex-col justify-around divide-y divide-white/10">
        {posts.map((p) => (
          <PulseCardRow key={p.id} post={p} unit={unit} onOpen={() => onOpen(p.id)} />
        ))}
      </ul>
    </div>
  );
}

function PulseCardRow({ post, unit, onOpen }: { post: CommunityPost; unit: "kg" | "lb"; onOpen: () => void }) {
  // on screen (half of it) for two seconds = a view, as on every card
  const ref = useRef<HTMLButtonElement | null>(null);
  usePostViewTracker(ref, post);
  const win = pickWorkoutWin(post.stats!, unit);
  const style = WIN_STYLE[win.kind];
  const name = post.is_mine ? "You" : post.author.name.split(" ")[0];
  return (
    <li className="flex min-h-0 flex-1">
      <button
        ref={ref}
        type="button"
        data-crew-pulse-row={win.kind}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left active:opacity-70"
        aria-label={`${name}: ${win.headline}`}
      >
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={28} expandable={false} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="max-w-[7rem] shrink-0 truncate font-bold">{name}</span>
            <span className={cn("inline-flex min-w-0 items-center gap-0.5 font-bold", style.text)}>
              <style.Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{win.kind === "done" ? "Done" : win.label}</span>
            </span>
            <span className="ml-auto shrink-0 text-white/55">{postTimeLabel(post.created_at)}</span>
          </span>
          <span className={cn("block truncate text-[13px] font-semibold leading-snug", win.kind === "pr" && "text-amber-300")}>
            {win.headline}
            {win.detail && <span className="text-white/60"> · {win.detail}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
