/**
 * Cleo in the program builder (Nov 23 2026): the builder's one assistant, docked
 * beside the program instead of a sheet over it. It is Adjust program's engine
 * (program_ai_edits: the athlete's whole history read, schema-checked changes
 * proposed one tick box each with their exact before and after, nothing applied
 * until the coach applies the ones they tick, a stale proposal refused, every
 * apply undoable), never a second chatbot.
 *
 *   Computer   a right-hand panel the builder makes room for (the page gives up
 *              its width, `html[data-cleo-dock]`): docked (resizable, the width
 *              remembered) or expanded for a long review; closing only folds it
 *              away, so the conversation and a half-typed message are still
 *              there when it opens again.
 *   Phone      a bottom sheet: a peek for a quick question with the workout still
 *              in view, the whole screen for a long one (the grip, or a swipe up),
 *              a swipe down to put it away; it sits on the visible part of the
 *              screen while the keyboard is up.
 *
 * It follows the coach around the builder (builderNav.onHere): the scope (this
 * day, this week, this block, the whole program) is told to Cleo with every
 * message as "[Looking at: …]", and it moves with the coach until they pick one
 * themselves. The builder saves what's on screen before every message (the AI
 * reads what's saved). Quick asks fit the scope and only fill the box.
 *
 * Branded Cleo for whoever has Cleo (useCleoAccess); anyone else who may adjust
 * the program sees the same dock as "Adjust program": nobody loses it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileNow } from "@/hooks/use-mobile";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { builderNav, type BuilderHere } from "@/lib/builder-nav";
import { CleoMark } from "@/components/summer/cleo-mark";
import { ChatPanel, HistoryPanel, RulesPanel } from "@/components/program-ai/edit-with-ai";
import type { ProgramAiTarget } from "@/lib/program-ai/program-ai.functions";

export type CleoScope = "day" | "week" | "block" | "program";
type DeskMode = "docked" | "expanded";
type Tab = "chat" | "rules" | "history";

const WIDTH_KEY = "jf.cleo-dock.width";
const MODE_KEY = "jf.cleo-dock.mode";
export const DOCK_MIN = 340;
export const DOCK_DEFAULT = 420;

/** The builder's handle on its dock: open it (with words in the box), and whether it's open. */
export function useCleoDock() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const ask = useCallback((text?: string) => {
    if (text) setSeed({ text, nonce: Date.now() });
    setOpen(true);
  }, []);
  return { open, setOpen, seed, ask, toggle: () => setOpen((v) => !v) };
}
export type CleoDockHandle = ReturnType<typeof useCleoDock>;

/** Where the coach is in the builder, live. */
export function useBuilderHere(): BuilderHere | null {
  const [here, setHere] = useState<BuilderHere | null>(() => builderNav.here());
  useEffect(() => {
    setHere(builderNav.here());
    return builderNav.onHere(() => setHere(builderNav.here()));
  }, []);
  return here;
}

/** The scope the builder's view suggests: a day for Day, a week for Week, the block for Block and Sheet. */
export function scopeForView(view: BuilderHere["view"] | null | undefined): CleoScope {
  if (view === "day") return "day";
  if (view === "week") return "week";
  if (view === "program") return "program";
  return "block";
}

/** What Cleo is told the coach means ("Week 3 · Day 2 “Lower A” of “Strength”", "the whole program"). */
export function scopeWords(scope: CleoScope, here: BuilderHere | null): string | null {
  if (scope === "program") return "the whole program";
  if (!here) return null;
  const of = here.blockName ? ` of “${here.blockName}”` : "";
  if (scope === "block") return here.blockName ? `the whole “${here.blockName}” block` : "the whole block";
  if (here.week == null) return null;
  if (scope === "week") return `Week ${here.week}${of}`;
  if (here.day == null) return `Week ${here.week}${of}`;
  return `Week ${here.week} · Day ${here.day}${here.dayName ? ` “${here.dayName}”` : ""}${of}`;
}

const SCOPE_LABEL: Record<CleoScope, string> = { day: "Day", week: "Week", block: "Block", program: "Program" };

/** One-tap asks that fit what's in scope. They fill the box; the coach still sends. */
export function quickActionsFor(scope: CleoScope, kind: ProgramAiTarget["kind"]): string[] {
  const client = kind === "client";
  switch (scope) {
    case "day":
      return ["Review this workout", "Optimize the exercise order", "Suggest better accessories", client ? "Make it fit their session length" : "Make it fit in 60 minutes"];
    case "week":
      return ["Check this week's volume", "Compare this week with last week", "Find anything not filled in", "Is this week recoverable?"];
    case "block":
      return ["Evaluate the progression", "Check weekly volume across the block", "Identify programming issues", "Tighten the equipment flow"];
    default:
      return client
        ? ["Review the program against their goals", "Which lift is progressing the slowest?", "Identify programming issues", "Is their weekly volume recoverable?"]
        : ["Identify programming issues", "Simplify the accessories", "Make a 3-day version of this", "Adapt it for a home gym"];
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode: it lasts the visit */
  }
}

/** The launcher in the builder's header: Cleo's mark (or Adjust program's), pressed while the dock is open. */
export function CleoLauncher({ dock, compact }: { dock: CleoDockHandle; compact?: boolean }) {
  const cleo = useCleoAccess();
  const label = cleo ? "Cleo" : compact ? "Adjust" : "Adjust program";
  return (
    <button
      type="button"
      onClick={dock.toggle}
      aria-pressed={dock.open}
      aria-label={dock.open ? `Close ${cleo ? "Cleo" : "Adjust program"}` : cleo ? "Open Cleo" : "Adjust program"}
      title={cleo ? "Cleo: ask about or change this program" : "Adjust program"}
      data-testid="edit-with-ai"
      data-cleo-launcher
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors",
        dock.open ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
      )}
    >
      {cleo ? <CleoMark size={17} /> : <SlidersHorizontal className="h-4 w-4" aria-hidden />}
      {label}
    </button>
  );
}

export function CleoDock({
  dock,
  target,
  title,
  onApplied,
  beforeSend,
}: {
  dock: CleoDockHandle;
  target: ProgramAiTarget;
  /** "Marc Asugui · Block 2", or the template's name. */
  title: string;
  onApplied?: () => void | Promise<void>;
  /** Save what's on screen (run before every message). */
  beforeSend?: () => Promise<void> | void;
}) {
  const phone = useIsMobileNow();
  const cleo = useCleoAccess();
  const here = useBuilderHere();
  const [tab, setTab] = useState<Tab>("chat");
  // the scope follows the view until the coach picks one
  const [picked, setPicked] = useState<CleoScope | null>(null);
  const scope = picked ?? scopeForView(here?.view);
  const context = scopeWords(scope, here);
  const quick = useMemo(() => quickActionsFor(scope, target.kind), [scope, target.kind]);

  // mounted on first open and kept (hidden) after, so the conversation and the draft survive closing
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (dock.open) setMounted(true);
  }, [dock.open]);

  // computer: docked or expanded, and the docked width, remembered
  const [mode, setMode] = useState<DeskMode>(() => {
    try {
      return window.localStorage.getItem(MODE_KEY) === "expanded" ? "expanded" : "docked";
    } catch {
      return "docked";
    }
  });
  const [width, setWidth] = useState(() => readNumber(WIDTH_KEY, DOCK_DEFAULT));
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // the builder always keeps at least 480px; expanded takes most of a big screen
  const maxW = Math.max(DOCK_MIN, Math.min(760, vw - 480));
  const deskW = mode === "expanded" ? Math.max(maxW, Math.min(980, Math.round(vw * 0.6))) : Math.min(Math.max(width, DOCK_MIN), maxW);

  // the builder makes room for it (styles.css): never a panel over the program's fields
  useEffect(() => {
    const root = document.documentElement;
    if (dock.open && !phone) {
      root.setAttribute("data-cleo-dock", mode);
      root.style.setProperty("--cleo-dock-w", `${Math.min(deskW, vw - 320)}px`);
    } else {
      root.removeAttribute("data-cleo-dock");
      root.style.removeProperty("--cleo-dock-w");
    }
  }, [dock.open, phone, mode, deskW, vw]);
  useEffect(
    () => () => {
      document.documentElement.removeAttribute("data-cleo-dock");
      document.documentElement.style.removeProperty("--cleo-dock-w");
    },
    [],
  );

  // dragging the docked panel's left edge
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "docked") return;
    drag.current = { x: e.clientX, w: deskW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(Math.min(maxW, Math.max(DOCK_MIN, drag.current.w + (drag.current.x - e.clientX))));
  };
  const onResizeUp = () => {
    if (!drag.current) return;
    drag.current = null;
    write(WIDTH_KEY, String(Math.round(width)));
  };
  const setDeskMode = (m: DeskMode) => {
    setMode(m);
    write(MODE_KEY, m);
  };

  // phone: peek or the whole screen; on the visible part of the screen while typing
  const [full, setFull] = useState(false);
  const box = useVisualViewportBox(phone && dock.open);
  const sheetDrag = useRef<{ y: number } | null>(null);
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    sheetDrag.current = { y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = sheetDrag.current;
    sheetDrag.current = null;
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 8) setFull((v) => !v);
    else if (dy < -40) setFull(true);
    else if (dy > 60) {
      if (full) setFull(false);
      else dock.setOpen(false);
    }
  };

  // Esc folds the panel away (a dialog over it keeps its own Esc)
  useEffect(() => {
    if (!dock.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-cleo-dock]")) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      e.preventDefault();
      e.stopPropagation();
      dock.setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dock]);

  if (!mounted) return null;
  const name = cleo ? "Cleo" : "Adjust program";
  const keyboardUp = phone && !!box?.keyboard;
  const phoneStyle = phone
    ? keyboardUp && box
      ? { top: box.top + 8, height: box.height - 8, bottom: "auto" }
      : { height: full ? "calc(100dvh - var(--app-safe-top, 0px) - 12px)" : "min(60dvh, 560px)" }
    : { width: deskW };

  return (
    <aside
      role="complementary"
      aria-label={name}
      hidden={!dock.open}
      data-cleo-dock={phone ? (full ? "full" : "peek") : mode}
      className={cn(
        "fixed z-40 flex flex-col bg-background text-foreground dark:bg-card",
        phone
          ? "phone-column inset-x-0 bottom-0 rounded-t-2xl border-t border-border shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.35)]"
          : "bottom-0 right-0 top-0 border-l border-border",
      )}
      style={phoneStyle}
    >
      {!phone && mode === "docked" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize"
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const next = Math.min(maxW, Math.max(DOCK_MIN, deskW + (e.key === "ArrowLeft" ? 24 : -24)));
              setWidth(next);
              write(WIDTH_KEY, String(next));
            }
          }}
          className="absolute -left-1 bottom-0 top-0 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent hover:after:bg-foreground/30 focus-visible:after:bg-foreground/50"
          data-cleo-resize
        />
      )}

      {phone && (
        <div
          onPointerDown={onGripDown}
          onPointerUp={onGripUp}
          className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
          aria-hidden
          data-cleo-grip
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>
      )}

      {/* who and what: Cleo, the program, the scope it's working in */}
      <div className={cn("shrink-0 border-b border-border px-3 pb-2.5", phone ? "pt-0" : "pt-[calc(env(safe-area-inset-top)+0.6rem)]")}>
        <div className="flex min-h-10 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background">
            {cleo ? <CleoMark size={18} /> : <SlidersHorizontal className="h-4 w-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight tracking-[-0.01em]">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{target.kind === "template" ? `Template · ${title}` : title}</p>
          </div>
          {phone ? (
            <button type="button" onClick={() => setFull((v) => !v)} aria-label={full ? "Smaller" : "Full screen"} className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              {full ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDeskMode(mode === "expanded" ? "docked" : "expanded")}
              aria-label={mode === "expanded" ? "Dock beside the program" : "Expand"}
              title={mode === "expanded" ? "Dock beside the program" : "Expand for a long review"}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              data-cleo-expand
            >
              {mode === "expanded" ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => dock.setOpen(false)}
            aria-label={`Close ${name} (keeps the conversation)`}
            title="Close (keeps the conversation)"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            data-cleo-close
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div role="radiogroup" aria-label="What it's about" className="grid flex-1 grid-cols-4 rounded-lg bg-muted p-0.5" data-cleo-scope>
            {(["day", "week", "block", "program"] as CleoScope[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => setPicked(s)}
                className={cn(
                  "h-8 cursor-pointer rounded-md text-xs font-semibold transition-colors",
                  scope === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label={name} className="flex shrink-0 items-center gap-0.5">
            {(["chat", "rules", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-8 cursor-pointer rounded-md px-2 text-xs font-semibold transition-colors",
                  tab === t ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "chat" ? "Ask" : t === "rules" ? "Rules" : "History"}
              </button>
            ))}
          </div>
        </div>
        {picked && picked !== scopeForView(here?.view) && (
          <button type="button" onClick={() => setPicked(null)} className="mt-1.5 cursor-pointer text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline">
            Follow what's on screen
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" hidden={tab !== "chat"}>
        <ChatPanel target={target} onApplied={onApplied} context={context} beforeSend={beforeSend} quickActions={quick} seed={dock.seed} />
      </div>
      {tab === "rules" && <RulesPanel clientId={target.kind === "client" ? target.clientId : null} />}
      {tab === "history" && <HistoryPanel target={target} onChanged={onApplied} />}
    </aside>
  );
}
