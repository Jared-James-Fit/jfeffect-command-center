import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { pollPercents, type CommunityAuthor, type CommunityPoll, type CommunityPost } from "@/lib/community";
import { useVotePoll } from "@/lib/community.queries";

/**
 * A poll on a post: tap an option to vote (tap another to switch). The
 * results stay hidden until you vote, then the bars grow in: that reveal
 * is the reward. The poster sees results straight away, plus who picked
 * what (nobody else does).
 */
export function PollCard({ post, onOpenPerson, className }: { post: CommunityPost; onOpenPerson?: (a: CommunityAuthor) => void; className?: string }) {
  const poll = post.poll;
  const vote = useVotePoll(post);
  const [votersOpen, setVotersOpen] = useState(false);
  const showResults = !!poll && (!!poll.my_vote || post.is_mine);
  // bars start at 0 and grow the moment results show
  const [grown, setGrown] = useState(showResults);
  useEffect(() => {
    if (!showResults || grown) return;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [showResults, grown]);
  if (!poll || !poll.options.length) return null;

  const pct = pollPercents(poll);
  const top = Math.max(...poll.options.map((o) => o.votes));
  const pick = (id: string) => {
    if (poll.my_vote === id || vote.isPending) return;
    vote.mutate(id, { onError: () => toast.error("Couldn't save your vote. Try again.") });
  };

  return (
    // taps here never open the post or like it
    <div data-poll className={cn("mt-3 space-y-2", className)} onClick={(e) => e.stopPropagation()}>
      {poll.options.map((o, i) => {
        const mine = poll.my_vote === o.id;
        const lead = showResults && o.votes > 0 && o.votes === top;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => pick(o.id)}
            aria-pressed={mine}
            aria-label={showResults ? `${o.label}, ${pct[i]}%${mine ? ", your vote" : ""}` : `Vote ${o.label}`}
            className={cn(
              "relative flex min-h-11 w-full items-center overflow-hidden rounded-xl border text-left text-[14px] leading-snug transition active:scale-[0.99]",
              showResults ? "border-transparent bg-muted/70" : "border-border bg-background font-semibold active:border-primary",
            )}
          >
            {showResults && (
              <span
                aria-hidden
                data-poll-bar
                className={cn("absolute inset-y-0 left-0 rounded-xl transition-[width] duration-700 ease-out", mine ? "bg-primary/30" : "bg-foreground/[0.09]")}
                style={{ width: grown ? `${pct[i]}%` : "0%" }}
              />
            )}
            <span className={cn("relative flex min-w-0 flex-1 items-center gap-1.5 px-3.5 py-2", showResults && (lead ? "font-black" : "font-semibold"))}>
              {mine && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />}
              <span className="min-w-0 break-words">{o.label}</span>
            </span>
            {showResults && <span className={cn("relative shrink-0 pr-3.5 tabular-nums", lead ? "font-black" : "font-semibold text-muted-foreground")}>{pct[i]}%</span>}
          </button>
        );
      })}
      <div className="flex items-center justify-between gap-2 px-0.5 text-[12px] text-muted-foreground">
        <span>
          {poll.total === 0 ? "Be the first to vote" : `${poll.total} ${poll.total === 1 ? "vote" : "votes"}`}
          {!showResults && poll.total > 0 && " · vote to see results"}
        </span>
        {poll.voters && poll.total > 0 && (
          <button type="button" onClick={() => setVotersOpen(true)} className="shrink-0 font-bold text-foreground active:opacity-60">
            See who voted
          </button>
        )}
      </div>
      {poll.voters && <PollVotersSheet poll={poll} open={votersOpen} onClose={() => setVotersOpen(false)} onOpenPerson={onOpenPerson} />}
    </div>
  );
}

/** Who picked what (the poster's view), option by option. */
function PollVotersSheet({ poll, open, onClose, onOpenPerson }: { poll: CommunityPoll; open: boolean; onClose: () => void; onOpenPerson?: (a: CommunityAuthor) => void }) {
  const pct = pollPercents(poll);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[75dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="sticky top-0 z-10 border-b border-border/70 bg-background px-4 py-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-black">Who voted</SheetTitle>
              <SheetDescription className="text-xs">Only coaches see who voted.</SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="space-y-4 px-4 py-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
          {poll.options.map((o, i) => {
            const people = poll.voters?.[o.id] ?? [];
            return (
              <section key={o.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-[14px] font-black">{o.label}</h3>
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-muted-foreground">
                    {o.votes} · {pct[i]}%
                  </span>
                </div>
                {people.length ? (
                  <div className="mt-1">
                    {people.map((a) => (
                      <button
                        key={a.user_id}
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenPerson?.(a);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left active:bg-muted"
                      >
                        <UserAvatar src={a.avatar_url} name={a.name} size={32} expandable={false} />
                        <span className="truncate text-[14px] font-semibold">{a.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[12px] text-muted-foreground">Nobody yet</p>
                )}
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
