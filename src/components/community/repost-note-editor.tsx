import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/lib/auth";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { useCommunityProfile, usePostMediaUrls } from "@/lib/community.queries";
import { useRepost } from "@/lib/community-saves";
import { REPOST_NOTE_EMOJI, REPOST_NOTE_MAX, cleanRepostNote, fitRepostNoteDraft, isEmojiOnly, type CommunityPost } from "@/lib/community";

const PLACEHOLDER = "Add a note…";
const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* no haptics here */
  }
};
/** Taps on these never take the keyboard down (the note keeps its caret). */
const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

/**
 * Your repost's note, Instagram's way: the post fills the screen, dimmed,
 * with your photo in the middle and the note in a bubble above it that you
 * type straight into (Return starts a new line, up to 6). Quick emoji and
 * Save sit right on the keyboard, and the whole screen is pinned to the part
 * above it, so nothing slides under it. "Remove" takes the repost back (with
 * Undo); leaving with changes asks "Discard note?" first.
 */
export function RepostNoteEditor({ post, onClose, preview }: { post: CommunityPost; onClose: () => void; preview?: string | null }) {
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(user?.id ?? null);
  const { data: urls } = usePostMediaUrls(preview === undefined ? [post] : []);
  const picture = preview ?? (post.media_thumb_path ? urls?.[post.media_thumb_path] : post.media_type === "image" && post.media_path ? urls?.[post.media_path] : null) ?? null;
  const repost = useRepost();
  const view = useVisualViewportBox(true);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const focusedOnce = useRef(false);
  const saved = post.my_repost?.note ?? "";
  const [text, setText] = useState(saved);
  const [confirm, setConfirm] = useState(false);
  const dirty = cleanRepostNote(text) !== cleanRepostNote(saved);
  const big = isEmojiOnly(text);
  const left = REPOST_NOTE_MAX - [...text].length;
  const keyboard = !!view?.keyboard;

  const focusNote = () => {
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: true });
  };
  const requestClose = () => {
    if (!dirty) return onClose();
    ref.current?.blur();
    setConfirm(true);
  };
  // the screen closes at once (the stamp already shows it), so these use promises:
  // a mutate() callback never runs once the screen that asked is gone
  const oops = (e: any, fallback: string) => e?.message ?? fallback;
  const save = () => {
    if (!dirty) return onClose();
    const note = cleanRepostNote(text);
    const send = (): void => {
      repost.mutateAsync({ post, on: true, note }).catch((e) =>
        toast.error(oops(e, "Couldn't save your note. Try again."), { action: { label: "Try again", onClick: send } }),
      );
    };
    send(); // a failure puts the old note back and says so
    onClose();
  };
  const remove = () => {
    const note = post.my_repost?.note ?? null;
    repost
      .mutateAsync({ post, on: false })
      .then(() =>
        toast("Repost removed", {
          action: {
            label: "Undo",
            onClick: () => void repost.mutateAsync({ post: { id: post.id, my_repost: null }, on: true, note }).catch((e) => toast.error(oops(e, "That didn't work. Try again."))),
          },
        }),
      )
      .catch((e) => toast.error(oops(e, "That didn't work. Try again.")));
    onClose();
  };
  const insert = (em: string) => {
    focusNote(); // in the tap itself, so a closed keyboard comes back up
    const t = ref.current;
    const start = t?.selectionStart ?? text.length;
    const end = t?.selectionEnd ?? text.length;
    const next = fitRepostNoteDraft(text, text.slice(0, start) + em + text.slice(end));
    if (next === text) return buzz();
    setText(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const at = Math.min(start + em.length, el.value.length);
      el.setSelectionRange(at, at);
    });
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="repost-editor-in fixed inset-x-0 z-[82] flex flex-col overflow-hidden bg-black text-white outline-none"
          // keyboard up: just the part of the screen above it; otherwise all of it
          style={{ top: keyboard ? view!.top : 0, height: keyboard ? view!.height : "100%" }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusNote();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (confirm) setConfirm(false);
            else requestClose();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          data-repost-editor
        >
          {/* the post, dimmed */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {picture ? (
              <img
                src={picture}
                alt=""
                className="h-full w-full object-cover opacity-60"
                style={post.media_focus ? { objectPosition: `${post.media_focus.x * 100}% ${post.media_focus.y * 100}%` } : undefined}
              />
            ) : (
              <div className="h-full w-full bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.32),#111114_65%)]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-black/70" />
          </div>

          <div className="relative flex h-full w-full flex-col sm:mx-auto sm:max-w-[480px]" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
            <div className="relative flex h-11 shrink-0 items-center justify-center px-2">
              <button type="button" onClick={requestClose} className="absolute left-1 grid h-11 w-11 place-items-center rounded-full active:bg-white/10" aria-label="Back" data-repost-editor-back>
                <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
              </button>
              <DialogPrimitive.Title className="text-[17px] font-bold text-white/90">Reposted</DialogPrimitive.Title>
            </div>

            {/* tap anywhere around the note: the keyboard goes down */}
            <div
              className="flex min-h-0 flex-1 flex-col items-center justify-center px-6"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) ref.current?.blur();
              }}
            >
              <div className="relative mb-3" data-repost-editor-bubble>
                {/* the bubble grows with what you write: the hidden copy sizes it, the box sits on top */}
                <label
                  className={cn(
                    "grid min-w-[9.5rem] max-w-[min(19.5rem,82vw)] cursor-text rounded-[24px] bg-white/[0.93] px-5 py-3 text-center text-black shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] backdrop-blur-md",
                    big ? "text-[30px] leading-[1.15]" : "text-[17px] font-medium leading-[1.3]",
                  )}
                >
                  <span className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words" aria-hidden>
                    {(text || PLACEHOLDER) + "​"}
                  </span>
                  <textarea
                    ref={(el) => {
                      ref.current = el;
                      // open = typing (in the tap that opened it: iOS only raises the keyboard then)
                      if (el && !focusedOnce.current) {
                        focusedOnce.current = true;
                        el.focus({ preventScroll: true });
                        el.setSelectionRange(el.value.length, el.value.length);
                      }
                    }}
                    value={text}
                    onChange={(e) => {
                      const next = fitRepostNoteDraft(text, e.target.value);
                      if (next === text && e.target.value !== text) buzz();
                      setText(next);
                    }}
                    rows={1}
                    cols={1}
                    placeholder={PLACEHOLDER}
                    aria-label="Repost note"
                    enterKeyHint="enter"
                    autoCapitalize="sentences"
                    // the phone-wide 16px rule for text boxes must not win here: the box and its sizing copy wrap alike
                    style={{ font: "inherit", letterSpacing: "inherit" }}
                    className="col-start-1 row-start-1 m-0 block h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-center text-inherit caret-black outline-none placeholder:text-black/40"
                    data-repost-note-input
                  />
                </label>
                {left <= 10 && (
                  <span className={cn("absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", left <= 0 ? "bg-primary text-primary-foreground" : "bg-black/70 text-white")} aria-live="polite">
                    {left}
                  </span>
                )}
                {/* the thought tail, down to your photo */}
                <span className="absolute -bottom-2 left-[calc(50%-30px)] h-3.5 w-3.5 rounded-full bg-white/[0.93]" aria-hidden />
                <span className="absolute -bottom-[18px] left-[calc(50%-38px)] h-2 w-2 rounded-full bg-white/[0.93]" aria-hidden />
              </div>
              <button type="button" onClick={focusNote} className="relative mt-2 shrink-0 rounded-full" aria-label="Write your note" {...keepFocus}>
                <UserAvatar src={me?.author.avatar_url ?? null} name={me?.author.name ?? "You"} size={keyboard ? 84 : 108} expandable={false} />
                <span className={cn("absolute grid place-items-center rounded-full bg-emerald-500 text-white ring-[3px] ring-black/70", keyboard ? "-bottom-0.5 -right-0.5 h-7 w-7" : "bottom-0 right-0 h-8 w-8")} aria-hidden>
                  <Repeat2 className={keyboard ? "h-4 w-4" : "h-[18px] w-[18px]"} strokeWidth={2.8} />
                </span>
              </button>
              <div className="mt-4 shrink-0 text-[14px] text-white/75">
                You reposted this post.{" "}
                <button type="button" onClick={remove} className="font-bold text-white underline-offset-2 active:underline" data-remove-repost>
                  Remove
                </button>
              </div>
            </div>

            {/* on the keyboard: quick emoji, then Save */}
            <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: keyboard ? "0.5rem" : "max(env(safe-area-inset-bottom), 0.75rem)" }}>
              <div className="grid grid-cols-8" role="group" aria-label="Quick emoji">
                {REPOST_NOTE_EMOJI.map((em) => (
                  <button
                    key={em}
                    type="button"
                    {...keepFocus}
                    onClick={() => insert(em)}
                    className="grid h-12 place-items-center rounded-full text-[28px] leading-none active:scale-90"
                    aria-label={`Add ${em}`}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <button type="button" {...keepFocus} onClick={save} className="mt-2 h-12 w-full rounded-xl bg-white text-[16px] font-bold text-black active:bg-white/85" data-save-note>
                Save
              </button>
            </div>
          </div>

          {/* leaving with changes: Instagram's "Discard thought?" */}
          {confirm && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 px-12" data-discard-note>
              <div role="alertdialog" aria-modal="true" aria-labelledby="discard-note-title" className="repost-discard-in w-full max-w-[280px] overflow-hidden rounded-[16px] bg-[#f4f4f6]/95 text-center text-black shadow-2xl backdrop-blur-xl">
                <div className="px-5 pb-4 pt-5">
                  <div id="discard-note-title" className="text-[17px] font-bold">Discard note?</div>
                  <div className="mt-1 text-[13px] leading-snug text-black/60">If you go back now, your changes won't be saved.</div>
                </div>
                <button type="button" onClick={onClose} className="h-12 w-full border-t border-black/10 text-[17px] font-bold text-[#e5303d] active:bg-black/5" data-discard>
                  Discard
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setConfirm(false);
                    focusNote();
                  }}
                  className="h-12 w-full border-t border-black/10 text-[17px] active:bg-black/5"
                  data-keep-editing
                >
                  Keep editing
                </button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
