import { Component, createContext, Suspense, useContext, useEffect, type ReactNode } from "react";
import { Loader2, RefreshCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { chunkFailureAction, lazyWithRetry, type ChunkFallbackContext } from "@/lib/lazy-chunk";

/**
 * The share studio and composer, loaded on demand but fetched early.
 *
 * Why early: the app ships many times a day, and a phone keeps the old build
 * open for hours. The studio used to be fetched the moment someone tapped
 * Post; after a publish that file no longer exists, so the tap ended in a
 * "Couldn't load this section" box squeezed into the header and no camera.
 * `usePreloadStudio()` fetches both on idle as soon as a screen with a Post
 * button is up (while that build is still the live one), so the tap opens
 * instantly. If loading still fails, it fails full screen with Update app.
 *
 * `StudioShell` also keeps a crash inside the studio from taking the page
 * down (the page used to quietly reload and drop the post): it shows its own
 * screen, reports the error to Support, and Try again reopens on the draft.
 */

const StudioClose = createContext<() => void>(() => {});

function Screen({ children }: { children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black px-8 text-center text-white" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {children}
    </div>
  );
}

function CloseButton() {
  const close = useContext(StudioClose);
  return (
    <button type="button" onClick={close} className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" style={{ top: "max(env(safe-area-inset-top), 0.75rem)" }} aria-label="Close">
      <X className="h-6 w-6" />
    </button>
  );
}

function LoadFailed(ctx: ChunkFallbackContext) {
  const action = chunkFailureAction(ctx);
  return (
    <Screen>
      <CloseButton />
      <div className="text-[17px] font-black">Couldn't open the camera</div>
      <p className="max-w-[280px] text-[13px] text-white/70">{ctx.failures >= 2 ? "A newer version of the app is ready. Update to keep posting." : "Check your connection and try again."}</p>
      <button type="button" onClick={action.run} className="h-12 rounded-full bg-primary px-6 text-[15px] font-black text-primary-foreground active:scale-[0.97]">
        {action.label}
      </button>
    </Screen>
  );
}

/** What shows for the moment it takes to open (instant once preloaded). */
export function StudioLoading() {
  return (
    <Screen>
      <CloseButton />
      <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-label="Opening the camera" />
    </Screen>
  );
}

export const ShareStudio = lazyWithRetry(() => import("@/components/community/share-studio").then((m) => ({ default: m.ShareStudio })), { fallback: LoadFailed });
export const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })), { fallback: LoadFailed });
export const NoteEditor = lazyWithRetry(() => import("@/components/community/note-editor").then((m) => ({ default: m.NoteEditor })), { fallback: LoadFailed });

let preloaded = false;
export function preloadStudio() {
  if (preloaded) return;
  preloaded = true;
  void ShareStudio.preload();
  void ShareComposer.preload();
  void NoteEditor.preload();
}

/** Fetch the studio while the phone is idle, so Post opens instantly (and still works after a publish). */
export function usePreloadStudio(enabled = true) {
  useEffect(() => {
    if (!enabled || preloaded || typeof window === "undefined") return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadStudio, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preloadStudio, 1500);
    return () => window.clearTimeout(t);
  }, [enabled]);
}

/** Record a crash inside the studio for Support (deduped by the database). Best effort. */
export function reportStudioCrash(error: unknown) {
  try {
    const e = error as Error | undefined;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    void (supabase as any)
      .rpc("report_page_error", {
        _route: `${window.location.pathname}#posting`,
        _message: e?.message ?? String(error),
        _stack: e?.stack ?? null,
        _device: { ua: nav.userAgent, standalone: !!nav.standalone, w: window.innerWidth, h: window.innerHeight },
      })
      .then(() => {}, () => {});
  } catch {
    /* never in the way */
  }
}

class StudioCrashBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null; n: number }> {
  state: { error: Error | null; n: number } = { error: null, n: 0 };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[share-studio]", error);
    reportStudioCrash(error);
  }
  render() {
    if (!this.state.error) return <div key={this.state.n} className="contents">{this.props.children}</div>;
    return (
      <Screen>
        <CloseButton />
        <div className="text-[17px] font-black">Something went wrong with this post</div>
        <p className="max-w-[280px] text-[13px] text-white/70">Your photo and caption are saved. Try again and pick up where you left off.</p>
        <button
          type="button"
          onClick={() => this.setState((s) => ({ error: null, n: s.n + 1 }))}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-black text-primary-foreground active:scale-[0.97]"
        >
          <RefreshCcw className="h-4 w-4" /> Try again
        </button>
      </Screen>
    );
  }
}

/** Around a studio or composer: its loading screen, its crash screen, and Close for both. */
export function StudioShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <StudioClose.Provider value={onClose}>
      <StudioCrashBoundary onClose={onClose}>
        <Suspense fallback={<StudioLoading />}>{children}</Suspense>
      </StudioCrashBoundary>
    </StudioClose.Provider>
  );
}
