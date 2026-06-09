import { useEffect, useMemo, useRef, useState } from "react";
import { Cake, MessageSquare, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { applyFirstName, type ResolvedBirthdayCard } from "@/lib/birthday-templates";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** Lightweight CSS confetti — no dependency, ~60 spans falling once. */
function ConfettiBurst({ run }: { run: boolean }) {
  const reduced = usePrefersReducedMotion();
  const pieces = useMemo(() => {
    const colors = [
      "hsl(var(--primary))",
      "#ffd166",
      "#06d6a0",
      "#118ab2",
      "#ef476f",
      "#ffffff",
    ];
    return Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 1.6 + Math.random() * 1.4,
      size: 6 + Math.random() * 6,
      rotate: Math.random() * 360,
      color: colors[i % colors.length],
    }));
  }, []);
  if (reduced || !run) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block rounded-[1px]"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `bday-fall ${p.duration}s linear ${p.delay}s 1 forwards`,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

export interface BirthdayCardViewProps {
  card: ResolvedBirthdayCard;
  firstName: string | null | undefined;
  fullName?: string | null;
  avatarSrc?: string | null;
  onDismiss?: () => void;
  onMessageCoach?: () => void;
  onViewPlan?: () => void;
  /** Constrain width for a phone-frame preview. */
  compact?: boolean;
}

/**
 * The actual birthday card surface. Used both inside the client portal
 * (in a dialog) and inside the admin preview.
 */
export function BirthdayCardView({
  card,
  firstName,
  fullName,
  avatarSrc,
  onDismiss,
  onMessageCoach,
  onViewPlan,
  compact = false,
}: BirthdayCardViewProps) {
  const reduced = usePrefersReducedMotion();
  const [confettiKey, setConfettiKey] = useState(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Re-fire confetti each mount.
    if (!mountedRef.current) {
      mountedRef.current = true;
      setConfettiKey((k) => k + 1);
    }
  }, []);

  const headline = applyFirstName(card.headline, firstName);

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-border bg-card shadow-2xl",
        "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(120%_80%_at_50%_-10%,hsl(var(--primary)/0.25),transparent_60%)]",
        compact ? "w-full max-w-[340px]" : "w-full",
        !reduced && "animate-in fade-in zoom-in-95 duration-500",
      )}
    >
      {card.celebration_effect && (
        <ConfettiBurst key={confettiKey} run={card.celebration_effect} />
      )}

      {/* Soft top accent stripe */}
      <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-primary to-primary/60" />

      <div className={cn("relative px-6 pb-6 pt-8 text-center", compact && "px-5 pt-7")}>
        <div className="mx-auto mb-4 flex items-center justify-center">
          <div className="relative">
            <UserAvatar
              src={avatarSrc ?? null}
              name={fullName || firstName || ""}
              size={compact ? 72 : 88}
              ring
              expandable={false}
              tone="primary"
            />
            <span
              className={cn(
                "absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-md",
                !reduced && "animate-in zoom-in-50 duration-700",
              )}
              aria-hidden
            >
              <Cake className="h-4 w-4" />
            </span>
          </div>
        </div>

        <h2 className={cn("font-bold tracking-tight", compact ? "text-xl" : "text-2xl")}>
          {headline}
        </h2>

        {card.message && (
          <p className={cn("mx-auto mt-2 max-w-md text-muted-foreground", compact ? "text-sm" : "text-base")}>
            {applyFirstName(card.message, firstName)}
          </p>
        )}

        {card.quote && (
          <blockquote
            className={cn(
              "mx-auto mt-5 max-w-md rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 italic text-foreground/90",
              compact ? "text-sm" : "text-[15px]",
            )}
          >
            “{applyFirstName(card.quote, firstName)}”
          </blockquote>
        )}

        {card.coach_message && (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              From your coach
            </div>
            <p className={cn("text-foreground/90", compact ? "text-sm" : "text-[15px]")}>
              {applyFirstName(card.coach_message, firstName)}
            </p>
          </div>
        )}

        <div className={cn("mt-6 flex flex-col gap-2", !compact && "sm:flex-row sm:justify-center")}>
          {onDismiss && (
            <Button onClick={onDismiss} className="sm:min-w-[160px]">
              Thank you 🎂
            </Button>
          )}
          {card.show_message_coach_button && onMessageCoach && (
            <Button variant="outline" onClick={onMessageCoach} className="sm:min-w-[160px]">
              <MessageSquare className="mr-2 h-4 w-4" /> Message Coach
            </Button>
          )}
          {onViewPlan && (
            <Button variant="ghost" onClick={onViewPlan} className="sm:min-w-[160px]">
              <Calendar className="mr-2 h-4 w-4" /> Today's Plan
            </Button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bday-fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120%) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}