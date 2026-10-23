import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Reply, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, postTimeLabel, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { STICKER_ANSWER_MAX, questionResponses, stickerPercents, type PostSticker, type StickerAnswer, type StickerSpec } from "@/lib/lessons";
import { useAnswerSticker } from "@/lib/lessons.queries";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * A story's sticker, Instagram's way: one tap and you're in.
 *   poll      tap an answer, then the bars and percentages show (tap another to switch)
 *   slider    drag the emoji, let go to answer; the crew's average shows after
 *   question  tap, type, send: only the poster sees it (the poster can fill it in too)
 * Everyone sees the same box, the poster too: no results until you've
 * answered, and never a count on the story. The poster's See results opens
 * the tally and who answered what (nobody else sees it: the card says so).
 * Answers never push anyone. A coach previewing a client
 * can look but not answer. A question's poster answers a response on their
 * story (Instagram's Share response): the card goes on the story with the
 * question and what was sent, never who sent it, and it shows as answered.
 */
export function StorySticker({ post, onComposing, onOpenPerson, onReply, className }: {
  post: CommunityPost;
  onComposing?: (on: boolean) => void;
  /** The poster's list of who answered: a name opens that person's profile. */
  onOpenPerson?: (a: CommunityAuthor) => void;
  /** The poster answers a question response with a story. */
  onReply?: (a: StickerAnswer) => void;
  className?: string;
}) {
  const s = post.sticker;
  const [sheet, setSheet] = useState(false);
  const blocked = usePreviewGuard();
  if (!s) return null;
  const first = post.author.name.split(" ")[0];
  return (
    <div
      className={cn("mx-auto w-[min(84%,320px)] rounded-[22px] bg-white px-4 pb-3.5 pt-3.5 text-black shadow-[0_12px_40px_rgba(0,0,0,0.45)]", className)}
      data-story-interactive
      data-story-sticker={s.type}
    >
      <p className="text-center text-[17px] font-black leading-snug">{s.q}</p>
      {s.type === "poll" ? (
        <PollSticker post={post} s={s} />
      ) : s.type === "slider" ? (
        <SliderSticker post={post} s={s} onComposing={onComposing} />
      ) : (
        <QuestionSticker post={post} first={first} onComposing={onComposing} />
      )}
      {s.is_mine ? (
        <button type="button" onClick={() => setSheet(true)} className="mt-2.5 flex w-full items-center justify-center gap-1 text-[12px] font-bold text-black/60 active:text-black" data-sticker-results>
          {s.type === "question" ? "See responses" : "See results"} <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ) : (
        s.mine && <p className="mt-2 text-center text-[11px] font-semibold text-black/45">{s.type === "question" ? `Only ${first} sees who sent it` : `Only ${first} sees your answer`}</p>
      )}
      {s.is_mine && (
        <StickerAnswersSheet
          open={sheet}
          onClose={() => setSheet(false)}
          sticker={s}
          onOpenPerson={onOpenPerson ? (a) => { setSheet(false); onOpenPerson(a); } : undefined}
          onReply={
            onReply && s.type === "question"
              ? (a) => {
                  if (blocked()) return;
                  setSheet(false);
                  onReply(a);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function usePreviewGuard() {
  const { isImpersonating } = useClientImpersonation();
  return () => {
    if (!isImpersonating) return false;
    toast.message(PREVIEW_ONLY_MESSAGE);
    return true;
  };
}

function PollSticker({ post, s }: { post: CommunityPost; s: Extract<PostSticker, { type: "poll" }> }) {
  const answer = useAnswerSticker(post);
  const blocked = usePreviewGuard();
  // results only once you've voted (the poster too, like everyone)
  const shown = s.mine?.choice != null;
  const pct = stickerPercents(s.options.map((o) => o.votes));
  return (
    <div className="mt-3 space-y-2">
      {s.options.map((o, i) => {
        const mine = s.mine?.choice === i;
        return (
          <button
            key={i}
            type="button"
            disabled={answer.isPending}
            onClick={() => {
              if (blocked()) return;
              answer.mutate({ choice: mine ? null : i }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't send that") });
            }}
            className={cn(
              "relative flex h-11 w-full items-center overflow-hidden rounded-xl border text-left text-[15px] font-bold transition-colors active:scale-[0.99]",
              mine ? "border-primary" : "border-black/10",
              !shown && "justify-center bg-black/[0.04]",
            )}
            aria-pressed={mine}
            data-sticker-option={i}
          >
            {shown && (
              <span className={cn("absolute inset-y-0 left-0 transition-[width] duration-500", mine ? "bg-primary/20" : "bg-black/[0.07]")} style={{ width: `${pct[i]}%` }} aria-hidden />
            )}
            <span className={cn("relative min-w-0 truncate", shown ? "flex-1 pl-3.5" : "px-3")}>{o.label}</span>
            {shown && (
              <span className="relative flex shrink-0 items-center gap-1 pr-3.5 text-[14px] font-black">
                {mine && <Check className="h-4 w-4 text-primary" />}
                {pct[i]}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SliderSticker({ post, s, onComposing }: { post: CommunityPost; s: Extract<PostSticker, { type: "slider" }>; onComposing?: (on: boolean) => void }) {
  const answer = useAnswerSticker(post);
  const blocked = usePreviewGuard();
  const track = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const mine = typeof s.mine?.value === "number" ? s.mine.value : null;
  const value = drag ?? mine ?? 0;
  const answered = mine != null;
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100);
  };
  const send = (v: number) =>
    answer.mutate({ value: v }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't send that") });
  return (
    <div className="mt-4 px-1 pb-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={s.q}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="relative h-10 touch-none"
        onPointerDown={(e) => {
          if (blocked()) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onComposing?.(true);
          setDrag(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (drag != null) setDrag(at(e.clientX));
        }}
        onPointerUp={(e) => {
          if (drag == null) return;
          const v = at(e.clientX);
          setDrag(null);
          onComposing?.(false);
          send(v);
        }}
        onPointerCancel={() => {
          setDrag(null);
          onComposing?.(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          if (blocked()) return;
          send(Math.max(0, Math.min(100, (mine ?? 50) + (e.key === "ArrowRight" ? 10 : -10))));
        }}
        data-sticker-slider
      >
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-primary" style={{ width: `${value}%` }} />
        </div>
        {answered && drag == null && typeof s.average === "number" && (
          <span className="absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55" style={{ left: `${s.average}%` }} aria-hidden title="Crew average" />
        )}
        <span
          className={cn("absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center leading-none transition-transform", drag != null ? "scale-125 text-[34px]" : "text-[28px]")}
          style={{ left: `${value}%` }}
          aria-hidden
        >
          {s.emoji}
        </span>
      </div>
      <p className="mt-1 text-center text-[12px] font-semibold text-black/50">
        {answered && typeof s.average === "number"
          ? `Crew average ${s.average} · you ${mine}`
          : s.is_mine
            ? "Slide to answer"
            : "Slide the " + s.emoji + " to answer"}
      </p>
    </div>
  );
}

function QuestionSticker({ post, first, onComposing }: { post: CommunityPost; first: string; onComposing?: (on: boolean) => void }) {
  const s = post.sticker!;
  const answer = useAnswerSticker(post);
  const blocked = usePreviewGuard();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const sent = s.mine?.body;
  // the poster can fill in their own question too (Instagram's): it goes in their Responses like anyone's
  const own = !!s.is_mine;
  if (sent && !open) {
    return (
      <button type="button" onClick={() => { if (blocked()) return; setText(sent); setOpen(true); onComposing?.(true); }} className="mt-3 w-full rounded-xl bg-black/[0.05] px-3 py-2.5 text-left text-[14px]" data-sticker-question-sent>
        <span className="line-clamp-2">{sent}</span>
        <span className="mt-1 block text-[11px] font-bold text-black/45">{own ? "In your responses" : `Sent to ${first}`} · tap to change</span>
      </button>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (blocked()) return;
          setOpen(true);
          onComposing?.(true);
        }}
        className="mt-3 w-full rounded-xl bg-black/[0.05] px-3 py-3 text-center text-[14px] font-semibold text-black/45"
        data-sticker-question-open
      >
        Type something…
      </button>
    );
  }
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    answer.mutate(
      { body },
      {
        onSuccess: () => {
          setOpen(false);
          onComposing?.(false);
          toast.success(own ? "Added to your responses" : `Sent to ${first}`);
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't send that"),
      },
    );
  };
  return (
    <div className="mt-3">
      <textarea
        autoFocus
        value={text}
        maxLength={STICKER_ANSWER_MAX}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setOpen(false);
            onComposing?.(false);
          }
        }}
        rows={2}
        className="w-full resize-none rounded-xl bg-black/[0.05] px-3 py-2.5 text-[16px] outline-none placeholder:text-black/35"
        placeholder="Type something…"
        data-sticker-question-input
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button type="button" onClick={() => { setOpen(false); onComposing?.(false); }} className="h-9 rounded-full px-3 text-[13px] font-bold text-black/50">
          Cancel
        </button>
        <button type="button" disabled={!text.trim() || answer.isPending} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-black text-primary-foreground disabled:opacity-40" data-sticker-send>
          <Send className="h-3.5 w-3.5" /> Send
        </button>
      </div>
    </div>
  );
}

/**
 * The poster's view: everyone who answered, newest first. A question's
 * responses are Instagram's: each one as its card, the ones not answered yet
 * first, each with Answer on your story (Answered once you have).
 */
export function StickerAnswersSheet({ open, onClose, sticker, onOpenPerson, onReply }: {
  open: boolean;
  onClose: () => void;
  sticker: PostSticker;
  onOpenPerson?: (a: CommunityAuthor) => void;
  onReply?: (a: StickerAnswer) => void;
}) {
  const question = sticker.type === "question";
  const answers: StickerAnswer[] = question ? questionResponses(sticker.answers ?? []) : sticker.answers ?? [];
  const what = (a: StickerAnswer) =>
    sticker.type === "poll" ? sticker.options[a.choice ?? -1]?.label ?? "" : sticker.type === "slider" ? `${sticker.emoji} ${a.value ?? 0}` : a.body ?? "";
  // a response's sender: photo and name (their profile)
  const who = (a: StickerAnswer) => (
    <>
      <button
        type="button"
        disabled={!onOpenPerson}
        onClick={() => onOpenPerson?.(a)}
        className="shrink-0 rounded-full active:scale-95 disabled:active:scale-100"
        aria-label={`Open ${a.name}'s profile`}
        data-sticker-answer-person
      >
        <UserAvatar src={a.avatar_url} name={a.name} size={30} expandable={false} />
      </button>
      <button type="button" disabled={!onOpenPerson} onClick={() => onOpenPerson?.(a)} className="min-w-0 truncate text-left text-[14px] font-bold">
        {a.name}
      </button>
    </>
  );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[16px] font-black">{question ? "Responses" : sticker.q}</SheetTitle>
            <SheetDescription className="truncate text-[12px]">
              {question
                ? `${sticker.q} · only you see who sent them`
                : sticker.type === "slider" && typeof sticker.average === "number"
                  ? `Crew average ${sticker.average} · only you can see who answered`
                  : `Only you can see who ${sticker.type === "poll" ? "voted" : "answered"}`}
            </SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className={cn("overflow-y-auto", question ? "space-y-2.5 px-3 py-3" : "px-2 py-2")}>
          {answers.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{question ? "No responses yet." : "No answers yet."}</p>}
          {question
            ? answers.map((a) => {
                const answered = !!a.answered_post_id;
                return (
                  <div key={a.user_id} className={cn("rounded-2xl border border-border/70 bg-card p-3", answered && "opacity-75")} data-sticker-response={answered ? "answered" : "open"}>
                    <div className="flex items-center gap-2">
                      {who(a)}
                      {a.at && <span className="shrink-0 text-[12px] text-muted-foreground">{postTimeLabel(a.at)}</span>}
                      {answered && (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400" data-sticker-answered>
                          <Check className="h-3 w-3" /> Answered
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-snug">{a.body}</p>
                    {onReply && (
                      <button
                        type="button"
                        onClick={() => onReply(a)}
                        className={cn(
                          "mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-black active:scale-95",
                          answered ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
                        )}
                        data-sticker-reply
                      >
                        <Reply className="h-3.5 w-3.5" /> {answered ? "Answer again" : "Answer on your story"}
                      </button>
                    )}
                  </div>
                );
              })
            : sticker.type === "poll"
              ? answers.length > 0 && <PollTally sticker={sticker} answers={answers} row={(a) => <AnswerRow key={a.user_id} a={a} onOpenPerson={onOpenPerson} />} />
              : answers.map((a) => <AnswerRow key={a.user_id} a={a} detail={what(a)} onOpenPerson={onOpenPerson} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Someone who answered: photo and name (their profile), and what they sent. */
function AnswerRow({ a, detail, onOpenPerson }: { a: StickerAnswer; detail?: string; onOpenPerson?: (a: CommunityAuthor) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
      <button
        type="button"
        disabled={!onOpenPerson}
        onClick={() => onOpenPerson?.(a)}
        className="shrink-0 rounded-full active:scale-95 disabled:active:scale-100"
        aria-label={`Open ${a.name}'s profile`}
        data-sticker-answer-person
      >
        <UserAvatar src={a.avatar_url} name={a.name} size={36} expandable={false} />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" disabled={!onOpenPerson} onClick={() => onOpenPerson?.(a)} className="block max-w-full truncate text-left text-[14px] font-bold">
          {a.name}
        </button>
        {detail && <div className="text-[14px] font-semibold text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

/** The poster's poll results, Instagram's: each answer with its share and votes, and who picked it under it. */
function PollTally({ sticker, answers, row }: { sticker: Extract<PostSticker, { type: "poll" }>; answers: StickerAnswer[]; row: (a: StickerAnswer) => ReactNode }) {
  const pct = stickerPercents(sticker.options.map((o) => o.votes));
  return (
    <>
      {sticker.options.map((o, i) => {
        const voters = answers.filter((a) => a.choice === i);
        return (
          <section key={i} className="px-1 py-1.5" data-sticker-tally={i}>
            <div className="relative mx-2 flex h-10 items-center overflow-hidden rounded-xl bg-muted">
              <span className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${pct[i]}%` }} aria-hidden />
              <span className="relative min-w-0 flex-1 truncate pl-3 text-[14px] font-bold">{o.label}</span>
              <span className="relative shrink-0 pr-3 text-[13px] font-black tabular-nums">
                {pct[i]}% · {o.votes}
              </span>
            </div>
            {voters.map(row)}
          </section>
        );
      })}
    </>
  );
}

/** How a sticker will look on the story, before it's posted (nothing to tap). */
export function StickerPreview({ sticker, className }: { sticker: StickerSpec; className?: string }) {
  return (
    <div className={cn("mx-auto w-[min(84%,320px)] rounded-[22px] bg-white px-4 pb-3.5 pt-3.5 text-black shadow-[0_12px_40px_rgba(0,0,0,0.45)]", className)} aria-hidden data-sticker-preview={sticker.type}>
      <p className="text-center text-[17px] font-black leading-snug">{sticker.q}</p>
      {sticker.type === "poll" ? (
        <div className="mt-3 space-y-2">
          {sticker.options.map((o, i) => (
            <div key={i} className="flex h-11 items-center justify-center rounded-xl border border-black/10 bg-black/[0.04] px-3 text-[15px] font-bold">
              <span className="truncate">{o.label}</span>
            </div>
          ))}
        </div>
      ) : sticker.type === "slider" ? (
        <div className="relative mt-4 h-10">
          <div className="absolute inset-x-1 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-black/10" />
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[28px] leading-none">{sticker.emoji}</span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-black/[0.05] px-3 py-3 text-center text-[14px] font-semibold text-black/45">Type something…</div>
      )}
    </div>
  );
}
