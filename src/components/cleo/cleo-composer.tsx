/**
 * Cleo's message box, the same everywhere Cleo is talked to (Nov 24 2026):
 *
 *   Enter       sends (a phone's return key reads "send" and does the same)
 *   Shift+Enter a new line (so does Enter while an input method is composing)
 *   the mic     dictation: tap, speak (a live waveform and the time), tap ✓ and
 *               the words land in the box to read and change before sending;
 *               ✕ throws the take away; a take that couldn't be turned into
 *               words is kept with Try again. Where a phone can't record, the
 *               mic says to use the keyboard's own dictation.
 *   Stop        while Cleo is answering, the send button stops it.
 *
 * It grows with what's typed (to a limit, then scrolls), never sends twice (a
 * send in flight ignores another), and holds nothing itself: the caller keeps
 * the draft (persisted per conversation, cleo-drafts.ts).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceDictation, type Transcribe } from "@/hooks/use-voice-dictation";
import { VoiceRecordingBar } from "@/components/voice/voice-recorder";

export type { Transcribe } from "@/hooks/use-voice-dictation";

export const DICTATION_MAX_MS = 5 * 60_000;

/**
 * Recording, turning it into words, and why it didn't work: one place for
 * every Cleo box, on the app's one dictation hook (useVoiceDictation: the
 * recording is temporary, kept in memory for Try again, never stored).
 */
export function useCleoDictation(transcribe: Transcribe | null, onText: (text: string) => void) {
  return useVoiceDictation({
    transcribe,
    onText,
    maxMs: DICTATION_MAX_MS,
    tooShort: "That was too short. Tap the mic, speak, then tap ✓.",
  });
}

export type CleoDictation = ReturnType<typeof useCleoDictation>;

/** The recording strip: cancel, the time, the live waveform, done; then turning it into words. */
export function DictationStrip({ dictation, className }: { dictation: CleoDictation; className?: string }) {
  if (dictation.state === "recording")
    return (
      <VoiceRecordingBar
        meter={dictation.meter}
        onCancel={dictation.cancel}
        onDone={dictation.finish}
        doneLabel="Done: turn it into text"
        className={className}
      />
    );
  if (dictation.state === "requesting" || dictation.state === "processing" || dictation.state === "transcribing")
    return (
      <div className={cn("flex min-h-11 items-center gap-2 px-2 text-sm text-muted-foreground", className)} role="status" data-cleo-transcribing>
        <Loader2 className="h-4 w-4 animate-spin" /> {dictation.state === "requesting" ? "Waiting for the microphone…" : "Turning what you said into text…"}
      </div>
    );
  return null;
}

export type CleoComposerHandle = { focus: () => void; insert: (text: string) => void; dictate: () => void };

export const CleoComposer = forwardRef<
  CleoComposerHandle,
  {
    value: string;
    onChange: (v: string) => void;
    /** Send what's in the box. Return false (or throw) to keep it. */
    onSend: (text: string, meta: { dictated: boolean }) => void | boolean | Promise<void | boolean>;
    /** Cleo is answering: the button is Stop. */
    answering?: boolean;
    onStop?: () => void;
    /** Something besides text to send (attachments ready). */
    canSendEmpty?: boolean;
    disabled?: boolean;
    placeholder?: string;
    transcribe?: Transcribe | null;
    /** The attach button (the caller owns the tray). */
    onAttach?: () => void;
    onPasteFiles?: (files: File[]) => void;
    /** Above the box (the attachment tray). */
    above?: ReactNode;
    /** One quiet line under the box. */
    hint?: ReactNode;
    className?: string;
    autoFocus?: boolean;
    maxHeight?: number;
  }
>(function CleoComposer(
  { value, onChange, onSend, answering, onStop, canSendEmpty, disabled, placeholder = "Ask Cleo anything…", transcribe = null, onAttach, onPasteFiles, above, hint, className, autoFocus, maxHeight = 200 },
  ref,
) {
  const box = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const dictatedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const insert = useCallback(
    (text: string) => {
      const cur = valueRef.current;
      const el = box.current;
      let next: string;
      if (el && document.activeElement === el && el.selectionStart != null && cur) {
        const a = el.selectionStart;
        const b = el.selectionEnd ?? a;
        const before = cur.slice(0, a);
        const after = cur.slice(b);
        const pad = before && !/\s$/.test(before) ? " " : "";
        next = `${before}${pad}${text}${after}`;
      } else next = cur.trim() ? `${cur.replace(/\s+$/, "")} ${text}` : text;
      onChange(next);
      requestAnimationFrame(() => {
        const t = box.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(next.length, next.length);
      });
    },
    [onChange],
  );

  const dictation = useCleoDictation(transcribe, (text) => {
    dictatedRef.current = true;
    insert(text);
  });

  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus(), insert, dictate: () => void dictation.start() }), [insert, dictation]);

  // grows with what's typed, to a limit
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(maxHeight, el.scrollHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight, dictation.state]);

  useEffect(() => {
    if (autoFocus && !window.matchMedia?.("(pointer: coarse)").matches) box.current?.focus();
  }, [autoFocus]);

  const canSend = !disabled && !answering && (value.trim().length > 0 || !!canSendEmpty);

  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    const dictated = dictatedRef.current;
    try {
      const r = await onSend(value, { dictated });
      if (r !== false) dictatedRef.current = false;
    } finally {
      sending.current = false;
    }
  };

  const recording = dictation.state === "recording" || dictation.state === "requesting" || dictation.state === "processing" || dictation.state === "transcribing";

  return (
    <div className={cn("w-full", className)} data-cleo-composer>
      {above}
      {dictation.state === "error" && dictation.fail && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-foreground" role="alert" data-cleo-dictation-failed>
          <span className="min-w-0 flex-1">{dictation.fail.message}</span>
          {dictation.fail.canRetry && (
            <button type="button" onClick={() => dictation.retry()} className="cursor-pointer font-semibold underline underline-offset-2">
              Try again
            </button>
          )}
          <button type="button" onClick={dictation.dismiss} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1 rounded-2xl border border-border bg-background px-1.5 py-1.5 focus-within:border-foreground/30 dark:bg-muted/30">
        {recording ? (
          <DictationStrip dictation={dictation} className="flex-1" />
        ) : (
          <>
            {onAttach && (
              <button
                type="button"
                onClick={onAttach}
                disabled={disabled}
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="Attach photos, videos or files"
                title="Attach"
              >
                <Paperclip className="h-[18px] w-[18px]" />
              </button>
            )}
            <textarea
              ref={box}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                if (!e.target.value.trim()) dictatedRef.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                // an input method still composing (Japanese, Chinese, autocorrect): Enter is its own
                if (e.nativeEvent.isComposing || (e.nativeEvent as any).keyCode === 229) return;
                e.preventDefault();
                void send();
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length && onPasteFiles) {
                  e.preventDefault();
                  onPasteFiles(files);
                }
              }}
              rows={1}
              enterKeyHint="send"
              placeholder={placeholder}
              disabled={disabled}
              aria-label="Message Cleo"
              className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60"
              data-cleo-input
            />
            {transcribe !== null && (
              <button
                type="button"
                onClick={() => {
                  if (!dictation.supported) {
                    dictation.dismiss();
                    toast.message("Recording isn't available in this browser. Tap the box and use your keyboard's microphone to dictate.");
                    return;
                  }
                  void dictation.start();
                }}
                disabled={disabled}
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="Dictate"
                title="Dictate"
                data-cleo-mic
              >
                <Mic className="h-[18px] w-[18px]" />
              </button>
            )}
            {answering && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background hover:opacity-90"
                aria-label="Stop Cleo"
                title="Stop"
                data-cleo-stop
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-25"
                aria-label="Send"
                title="Send (Enter)"
                data-cleo-send
              >
                <ArrowUp className="h-[18px] w-[18px]" />
              </button>
            )}
          </>
        )}
      </div>
      {hint && !recording && <div className="mt-1 px-2 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
});
