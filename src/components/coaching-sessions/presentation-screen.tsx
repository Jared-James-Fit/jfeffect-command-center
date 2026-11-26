/**
 * The meeting on a shared screen (Nov 25 2026): full screen, one section at a
 * time, large type, nothing private. It reads getPresentationFn, which returns
 * only the athlete-safe view, so the coach's notes and Cleo's reads are never
 * in this window at all. ← → (or the dots) move between sections; the coach's
 * own workspace stays in the other window. Each slide can carry one picture
 * from the athlete's own records (slide-visuals.tsx, visuals.ts). S opens the
 * coach's script in a window of its own (nothing about it is drawn here).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getPresentationFn, getPresentationVisualsFn } from "@/lib/coaching-sessions/sessions.functions";
import { cn } from "@/lib/utils";
import { openScriptWindow, presentChannel, type PresentMessage } from "@/lib/coaching-sessions/script";
import { slideVisuals, type PresentationVisuals } from "@/lib/coaching-sessions/visuals";
import { SlideVisual } from "./slide-visuals";

export function PresentationScreen({ sessionId }: { sessionId: string }) {
  const read = useServerFn(getPresentationFn);
  const q = useQuery({
    queryKey: ["coaching-presentation", sessionId],
    queryFn: () => read({ data: { sessionId } }),
    refetchInterval: 20_000,
  });
  const readVisuals = useServerFn(getPresentationVisualsFn);
  const vq = useQuery({
    queryKey: ["coaching-presentation-visuals", sessionId],
    queryFn: () => readVisuals({ data: { sessionId } }) as Promise<PresentationVisuals>,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const [i, setI] = useState(0);
  const total = (q.data?.sections.length ?? 0) + 1; // a title screen, then each section
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setI((n) => Math.min(total - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey) openScriptWindow(sessionId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, sessionId]);

  // The coach's private script (their other window) follows this slide, and
  // its ‹ › move this screen. Only the index crosses the channel.
  const chan = useRef<BroadcastChannel | null>(null);
  const iRef = useRef(i);
  iRef.current = i;
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(presentChannel(sessionId));
    chan.current = c;
    c.onmessage = (e: MessageEvent<PresentMessage>) => {
      if (e.data?.type === "go") setI(Math.max(0, e.data.index));
      if (e.data?.type === "hello") c.postMessage({ type: "slide", index: iRef.current } satisfies PresentMessage);
    };
    return () => {
      c.close();
      chan.current = null;
    };
  }, [sessionId]);
  useEffect(() => {
    chan.current?.postMessage({ type: "slide", index: i } satisfies PresentMessage);
  }, [i]);

  if (q.isLoading || !q.data)
    return <div className="fixed inset-0 z-50 bg-background" data-presentation-loading />;
  const d = q.data;
  const section = i > 0 ? d.sections[i - 1] : null;
  const v = vq.data ?? null;
  const pictures = v ? slideVisuals(d.sections, v) : {};
  const kind = pictures[i];
  const picture = v && kind ? <SlideVisual kind={kind} v={v} /> : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground" data-presentation>
      <header className="flex items-center justify-between px-6 py-4 sm:px-10">
        <p className="text-[14px] font-semibold tracking-tight text-muted-foreground">JF Effect</p>
        <button
          type="button"
          onClick={() => window.close()}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="flex min-h-0 flex-1 overflow-y-auto px-6 sm:px-10">
        <div
          className={cn(
            "m-auto grid w-full items-center gap-8 py-4",
            picture ? "max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-14" : "max-w-3xl",
          )}
        >
        {section ? (
          <div className="w-full" data-presentation-section={section.key}>
            <p className="text-[15px] font-medium text-muted-foreground">
              {i} of {total - 1} · {section.minutes} min
            </p>
            <h1
              className={cn(
                "mt-2 text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.03em]",
                picture ? "sm:text-[56px]" : "sm:text-[64px]",
              )}
            >
              {section.title}
            </h1>
            <p className="mt-3 text-[18px] text-muted-foreground sm:text-[22px]">{section.prompt}</p>
            {section.key === "execute" && d.agreed.length ? (
              <ul className="mt-8 space-y-3">
                {d.agreed.map((a) => (
                  <li key={a} className="text-[20px] leading-snug sm:text-[26px]">
                    {a}
                  </li>
                ))}
              </ul>
            ) : null}
            {section.points.length ? (
              <ul className="mt-8 space-y-4">
                {section.points.map((p) => (
                  <li key={p} className="flex gap-4 text-[20px] leading-snug sm:text-[26px]">
                    <span className="mt-[0.55em] h-2 w-2 shrink-0 rounded-full bg-foreground/40" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="w-full" data-presentation-title>
            {d.event?.daysOut != null && d.event.daysOut >= 0 ? (
              <p className="text-[18px] font-medium tabular-nums text-muted-foreground">
                {d.event.daysOut === 0 ? "Today" : `${d.event.daysOut} days to go`}
                {d.event.phase ? ` · ${d.event.phase}` : ""}
              </p>
            ) : null}
            <h1 className="mt-2 text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[76px]">
              {d.event?.title ?? "Our check-in"}
            </h1>
            <p className="mt-4 text-[20px] text-muted-foreground sm:text-[24px]">
              {d.firstName ? `${d.firstName}, ` : ""}
              {d.objective ?? (d.minutes ? `${d.minutes} minutes on what's working, what's next and your plan.` : "What's working, what's next and your plan.")}
            </p>
          </div>
        )}
        {picture ? <div className="w-full">{picture}</div> : null}
        </div>
      </main>

      <footer className="flex items-center justify-between gap-4 px-6 pb-6 sm:px-10">
        <button
          type="button"
          onClick={() => setI((n) => Math.max(0, n - 1))}
          disabled={i === 0}
          aria-label="Back"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-border disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex gap-2">
          {Array.from({ length: total }).map((_, n) => (
            <button
              key={n}
              type="button"
              aria-label={`Go to ${n === 0 ? "start" : d.sections[n - 1]?.title}`}
              onClick={() => setI(n)}
              className={cn("h-2 rounded-full transition-all", n === i ? "w-8 bg-foreground" : "w-2 bg-foreground/25")}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setI((n) => Math.min(total - 1, n + 1))}
          disabled={i === total - 1}
          aria-label="Next"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-border disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </footer>
    </div>
  );
}
