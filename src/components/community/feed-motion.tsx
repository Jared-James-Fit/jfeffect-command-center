import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A post that eases in (fade + small rise) the first time it scrolls into
 * view, so the feed builds as you go instead of landing all at once. The
 * first few on screen come in one after another. Shows straight away where
 * there's no IntersectionObserver or motion is reduced.
 */
export function FeedItem({ index, children, className, ...rest }: { index: number; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(() => typeof window === "undefined" || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setShown(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      // a touch before it's on screen, so it's already moving as it appears
      { rootMargin: "0px 0px 80px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div
      ref={ref}
      {...rest}
      data-shown={shown ? "" : undefined}
      className={cn("feed-item", className)}
      // the first screenful arrives one after another
      style={{ transitionDelay: shown && index < 4 ? `${index * 70}ms` : undefined, ...rest.style }}
    >
      {children}
    </div>
  );
}

/** What's coming while the next posts load: the shape of a post. */
export function PostSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card" aria-label="Loading more posts">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-28 rounded" />
          <Skeleton className="h-2.5 w-16 rounded" />
        </div>
      </div>
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex gap-4 px-3.5 py-3">
        <Skeleton className="h-6 w-12 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
    </div>
  );
}

/** The bottom of the feed: you've seen it all (a small win), and what to do next. */
export function CaughtUp({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 pb-4 pt-6 text-center">
      <div className="caught-up-ring grid h-14 w-14 place-items-center rounded-full border-2 border-primary text-primary">
        <Check className="h-7 w-7" strokeWidth={3} />
      </div>
      <div className="mt-3 text-[15px] font-black">You're all caught up</div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">You've seen every new post from the crew.</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * New posts from the crew while you're scrolled down: a pill to jump up to
 * them (at the top they just slide in). Never your own posts.
 */
export function useNewPosts(enabled: boolean, myId: string | null) {
  const qc = useQueryClient();
  const [count, setCount] = useState(0);
  const mine = useRef(myId);
  mine.current = myId;
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel("community-new-posts")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "community_posts", filter: "visibility=eq.community" }, (payload: any) => {
        const row = payload.new;
        if (!row?.id || row.author_user_id === mine.current) return;
        if (window.scrollY < 300) void qc.invalidateQueries({ queryKey: ["community-feed"] });
        else setCount((n) => n + 1);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [enabled, qc]);
  const show = () => {
    setCount(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void qc.invalidateQueries({ queryKey: ["community-feed"] });
  };
  return { count, show };
}

export function NewPostsPill({ count, onShow }: { count: number; onShow: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] z-40 flex justify-center">
      <button
        type="button"
        onClick={onShow}
        className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-black text-primary-foreground shadow-lg shadow-primary/30 animate-in fade-in slide-in-from-top-2 active:scale-95"
      >
        <ArrowUp className="h-4 w-4" strokeWidth={3} /> {count === 1 ? "New post" : `${count} new posts`}
      </button>
    </div>
  );
}
