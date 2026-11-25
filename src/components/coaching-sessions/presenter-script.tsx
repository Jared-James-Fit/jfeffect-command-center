/**
 * The coach's presenter script (Nov 25 2026): the script for the slide on the
 * shared screen, in the coach's own window only. The shared screen tells it
 * which slide is up over a BroadcastChannel (same browser), and ‹ › here move
 * the shared screen too. Each slide's script can be edited (kept on this
 * device) and put back to the generated one. Built in code (script.ts) from
 * the same agenda the screen reads, so it's there instantly and never
 * disagrees with the slide.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  presentChannel,
  slideText,
  type PresentMessage,
  type ScriptSlide,
} from "@/lib/coaching-sessions/script";

const editsKey = (id: string) => `jf-script-edits:${id}`;
function readEdits(id: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(editsKey(id)) || "{}") ?? {};
  } catch {
    return {};
  }
}
function writeEdits(id: string, v: Record<string, string>) {
  try {
    localStorage.setItem(editsKey(id), JSON.stringify(v));
  } catch {
    /* private mode: edits last for the visit */
  }
}

export function PresenterScript({
  sessionId,
  slides,
  variant = "card",
}: {
  sessionId: string;
  slides: ScriptSlide[];
  /** "window": the script's own full window (large type, ← → move the slides) */
  variant?: "card" | "window";
}) {
  const big = variant === "window";
  const [index, setIndex] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>(() => readEdits(sessionId));
  const [editing, setEditing] = useState(false);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const chan = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(presentChannel(sessionId));
    chan.current = c;
    c.onmessage = (e: MessageEvent<PresentMessage>) => {
      if (e.data?.type === "slide") {
        setIndex(e.data.index);
        setSince(Date.now());
      }
    };
    c.postMessage({ type: "hello" } satisfies PresentMessage);
    return () => {
      c.close();
      chan.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const total = slides.length;
  const i = Math.min(Math.max(0, index), Math.max(0, total - 1));
  const slide = slides[i];
  const go = (n: number) => {
    const to = Math.min(total - 1, Math.max(0, n));
    setIndex(to);
    setSince(Date.now());
    setEditing(false);
    chan.current?.postMessage({ type: "go", index: to } satisfies PresentMessage);
  };

  const goRef = useRef(go);
  goRef.current = go;
  const iNow = useRef(i);
  iNow.current = i;
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") goRef.current(iNow.current + 1);
      if (e.key === "ArrowLeft") goRef.current(iNow.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);

  const key = slide ? `${i}:${slide.key}` : "";
  const edited = key ? edits[key] : undefined;
  const generated = useMemo(() => (slide ? slideText(slide) : ""), [slide]);
  const elapsed = Math.floor((now - since) / 1000);
  const over = slide ? elapsed > slide.minutes * 60 : false;

  if (!slide) return null;
  const save = (text: string) => {
    const next = { ...edits, [key]: text };
    setEdits(next);
    writeEdits(sessionId, next);
  };
  const reset = () => {
    const next = { ...edits };
    delete next[key];
    setEdits(next);
    writeEdits(sessionId, next);
    setEditing(false);
  };

  return (
    <section
      className={cn("space-y-3", big ? "space-y-5" : "rounded-2xl border border-border p-4")}
      data-presenter-script={variant}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">Your script · only you see this</p>
          <p className={cn("truncate font-semibold", big ? "text-[22px]" : "text-[16px]")}>
            {i + 1} of {total} · {slide.title}
          </p>
        </div>
        <p className={cn("shrink-0 tabular-nums", big ? "text-[16px]" : "text-[13px]", over ? "text-warning" : "text-muted-foreground")}>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {slide.minutes} min
        </p>
      </div>

      {editing ? (
        <Textarea
          rows={14}
          value={edited ?? generated}
          onChange={(e) => save(e.target.value)}
          className={big ? "text-[18px]" : "text-[16px] sm:text-[15px]"}
        />
      ) : edited != null ? (
        <p className={cn("whitespace-pre-wrap leading-relaxed", big ? "text-[19px]" : "text-[15px]")}>{edited}</p>
      ) : (
        <div className={cn("space-y-3 leading-relaxed", big ? "space-y-5 text-[19px]" : "text-[15px]")}>
          {slide.say.length ? (
            <div className="space-y-1.5">
              {slide.say.map((l, n) => (
                <p key={n}>{l}</p>
              ))}
            </div>
          ) : null}
          {slide.ask.length ? (
            <div>
              <p className={cn("font-medium text-muted-foreground", big ? "text-[14px]" : "text-[12px]")}>Ask</p>
              <ul className="mt-1 space-y-1">
                {slide.ask.map((q, n) => (
                  <li key={n} className="font-medium">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {slide.pause ? (
            <p className={cn("rounded-lg bg-secondary px-3 py-2", big ? "text-[17px]" : "text-[14px]")}>
              <span className="font-semibold">Stop and listen.</span> {slide.pause}
            </p>
          ) : null}
          {slide.transition ? (
            <p className={cn("text-muted-foreground", big ? "text-[16px]" : "text-[14px]")}>Then: {slide.transition}</p>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-10" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-10" onClick={() => go(i + 1)} disabled={i >= total - 1} aria-label="Next slide">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          {edited != null ? (
            <Button variant="ghost" size="sm" className="h-10" onClick={reset}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Regenerate
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setEditing((v) => !v)}>
            <Pencil className="mr-1.5 h-4 w-4" /> {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>
    </section>
  );
}
