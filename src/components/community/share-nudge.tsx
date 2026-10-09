import { useEffect, useRef, useState } from "react";
import { Camera, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { SHARE_NUDGE_DONE, shareNudgeKey } from "@/lib/community";
import { useCommunityProfile, useHintsSeen, useMarkHintSeen, useTodaySession } from "@/lib/community.queries";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";

type Surface = "home" | "feed";

// This window's nudge belongs to the first place it's seen (Home or the
// feed) for the rest of the app session, so it's never in two places.
let claim: { key: string; surface: Surface; dismissed: boolean } | null = null;

/**
 * Whether to invite this client to post: only until their first post (then
 * never again, remembered on the account), and at most once every few days
 * (each window is an account hint, so another device doesn't repeat it).
 */
export function useShareNudge(surface: Surface) {
  const { role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const userId = usePortalUserId();
  const eligible = role === "client" || isImpersonating;
  const hints = useHintsSeen();
  const me = useCommunityProfile(eligible ? userId ?? null : null);
  const markHint = useMarkHintSeen();
  const [, rerender] = useState(0);
  const key = shareNudgeKey();
  const posted = (me.data?.posts ?? 0) + (me.data?.archived ?? 0) > 0;
  const done = !!hints.data?.includes(SHARE_NUDGE_DONE);

  // They've posted: it never asks again, even if that post goes later.
  useEffect(() => {
    if (posted && hints.isSuccess && !done && !isImpersonating) markHint(SHARE_NUDGE_DONE);
  }, [posted, hints.isSuccess, done, isImpersonating, markHint]);

  const ready = eligible && hints.isSuccess && me.isSuccess && !!me.data && !posted && !done;
  const show = ready && (claim?.key === key ? claim.surface === surface && !claim.dismissed : !hints.data!.includes(key));
  return {
    show,
    /** On screen: this window is used up (it stays for this visit). */
    seen: () => {
      if (claim?.key === key) return;
      claim = { key, surface, dismissed: false };
      // the coach's "View as" never spends the client's nudge
      if (!isImpersonating) markHint(key);
    },
    dismiss: () => {
      claim = { key, surface, dismissed: true };
      if (!isImpersonating) markHint(key);
      rerender((n) => n + 1);
    },
  };
}

/**
 * The invite itself: lock in today's session when there's one to train,
 * else share a session. One card, friendly, easy to pass on ("Not now").
 * `home`: a card in Home's Crew feed swipe. `feed`: a row between posts.
 */
export function ShareNudge({ surface, unit, className }: { surface: Surface; unit: "kg" | "lb"; className?: string }) {
  const nudge = useShareNudge(surface);
  const { isImpersonating } = useClientImpersonation();
  const { data: today } = useTodaySession(nudge.show && !isImpersonating);
  const ref = useRef<HTMLDivElement | null>(null);
  const { show, seen } = nudge;

  useEffect(() => {
    const el = ref.current;
    if (!show || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || e.intersectionRatio < 0.5) return;
        seen();
        io.disconnect();
      },
      { threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show, seen]);

  if (!show) return null;
  const lock = !!today;
  const Icon = lock ? Lock : Camera;
  const title = lock ? "Lock in today's session" : "Share a session with the crew";
  const body = lock ? "A quick pic before you train. The crew sees you showed up." : "A photo with your numbers on it. Takes a few seconds.";
  const notNow = (
    <button type="button" onClick={nudge.dismiss} aria-label="Not now" className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-muted">
      <X className="h-4 w-4" />
    </button>
  );

  if (surface === "home") {
    return (
      <div
        ref={ref}
        data-share-nudge="home"
        className={cn(
          "relative flex h-full w-[74%] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[20px] border border-primary/20 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(239,51,64,0.16),transparent_60%)] bg-card p-4",
          className,
        )}
      >
        {notNow}
        <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/12 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="text-[16px] font-black leading-tight">{title}</div>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{body}</p>
        </div>
        <ShareWorkoutButton unit={unit} label={lock ? "Lock in" : "Share"} previewOnly={isImpersonating} className="w-full" />
      </div>
    );
  }
  return (
    <div ref={ref} data-share-nudge="feed" className={cn("relative flex gap-3 rounded-3xl border border-primary/20 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(239,51,64,0.12),transparent_60%)] bg-card p-4 pr-10", className)}>
      {notNow}
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-black leading-tight">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{body}</p>
        <ShareWorkoutButton unit={unit} label={lock ? "Lock in" : "Share"} previewOnly={isImpersonating} className="mt-3" />
      </div>
    </div>
  );
}
