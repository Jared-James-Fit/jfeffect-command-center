import { useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { PULSE_STRIP_ROWS, pickWorkoutWin, postTimeLabel, reactionEmoji, type CommunityPost, type ReactionKey } from "@/lib/community";
import { useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/post-card";

/**
 * A day of Pulses, folded into one card: a row per finished session (who,
 * its real win, one-tap props), the newest few first, the rest a tap away.
 * Each row opens the full post. Keeps the feed for the posts people wrote.
 */
export function PulseStrip({ posts, unit, viewerIsStaff, onOpen }: { posts: CommunityPost[]; unit: "kg" | "lb"; viewerIsStaff: boolean; onOpen: (p: CommunityPost) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? posts : posts.slice(0, PULSE_STRIP_ROWS);
  const more = posts.length - shown.length;
  const prs = posts.reduce((n, p) => n + (p.stats?.pr_count ?? 0), 0);
  return (
    <section data-pulse-strip className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <header className="flex items-center gap-2 px-4 pb-1.5 pt-3">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-black">Pulse</span>
        <span className="text-[12px] text-muted-foreground">
          · {posts.length} {posts.length === 1 ? "session" : "sessions"} finished{prs > 0 ? ` · ${prs} PR${prs === 1 ? "" : "s"}` : ""}
        </span>
      </header>
      <ul className="divide-y divide-border/60">
        {shown.map((p) => (
          <PulseRow key={p.id} post={p} unit={unit} viewerIsStaff={viewerIsStaff} onOpen={onOpen} />
        ))}
      </ul>
      {(more > 0 || open) && posts.length > PULSE_STRIP_ROWS && (
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-center gap-1 border-t border-border/60 py-2.5 text-[12px] font-bold text-muted-foreground active:bg-muted">
          {open ? "Show less" : `${more} more`}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </section>
  );
}

function PulseRow({ post, unit, viewerIsStaff, onOpen }: { post: CommunityPost; unit: "kg" | "lb"; viewerIsStaff: boolean; onOpen: (p: CommunityPost) => void }) {
  const react = useReact(post, viewerIsStaff);
  const s = post.stats!;
  const win = pickWorkoutWin(s, unit);
  const style = WIN_STYLE[win.kind];
  const give = (next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't send that") });
  return (
    <li data-pulse-row={win.kind} data-post-id={post.id} className="flex scroll-mt-20 items-center gap-3 px-4 py-2.5">
      <button type="button" onClick={() => onOpen(post)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70" aria-label={`${post.author.name}: ${win.headline}`}>
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={36} expandable={false} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
            {/* the name keeps its room; the win's label gives way */}
            <span className="max-w-[9.5rem] shrink-0 truncate font-bold">{post.is_mine ? "You" : post.author.name}</span>
            <span className={cn("inline-flex min-w-0 items-center gap-0.5 font-bold", style.text.replace("text-white/70", "text-muted-foreground"))}>
              <style.Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{win.kind === "done" ? "Done" : win.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">· {postTimeLabel(post.created_at)}</span>
          </div>
          <div className="truncate text-[14px] font-semibold leading-snug">
            {win.headline}
            {win.detail && <span className="text-muted-foreground"> · {win.detail}</span>}
          </div>
        </div>
      </button>
      {!post.is_mine && (
        <button
          type="button"
          data-props
          onClick={() => give(post.my_reaction ? null : "fire")}
          aria-pressed={!!post.my_reaction}
          aria-label={post.my_reaction ? "Props sent. Tap to take back" : "Give props"}
          className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-black transition active:scale-95", post.my_reaction ? "bg-orange-500/15 text-orange-600 dark:text-orange-300" : "bg-foreground text-background")}
        >
          {post.my_reaction ? `${reactionEmoji(post.my_reaction) ?? "🔥"} Sent` : "🔥 Props"}
        </button>
      )}
      {post.is_mine && (post.reaction_count ?? 0) > 0 && <span className="shrink-0 text-[12px] font-bold text-muted-foreground">🔥 {post.reaction_count}</span>}
    </li>
  );
}
