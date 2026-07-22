import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { isChunkLoadError, attemptChunkReload } from "@/lib/chunk-recovery";

type Props = {
  error: Error;
  reset: () => void;
};

/**
 * Default error UI for route/loader failures. Most failures on the published
 * site are transient SSR/cold-start cancellations from the edge runtime, so we
 * auto-retry once before showing the fallback UI.
 */
export function RouterErrorFallback({ error, reset }: Props) {
  const router = useRouter();
  const [autoRetried, setAutoRetried] = useState(false);
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!chunkError) return;
    // Try a one-time recovery reload. If the guard is already set,
    // attemptChunkReload returns false and we fall through to the
    // "Refresh App" UI below — no infinite loop.
    attemptChunkReload("router-error-boundary");
  }, [chunkError]);

  useEffect(() => {
    if (chunkError) return;
    if (autoRetried) return;
    setAutoRetried(true);
    // Surface the underlying error so we can see why routes fail in
    // production logs (Sentry/console). Without this the fallback UI is
    // the only signal that something went wrong.
    // eslint-disable-next-line no-console
    console.error("[router-error]", error);
    const id = window.setTimeout(() => {
      void router.invalidate().then(() => reset());
    }, 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chunkError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-semibold text-foreground">
            The app needs to refresh to finish updating.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A new version is available. Tap below to load it.
          </p>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => {
                try {
                  window.sessionStorage.removeItem("jfe_chunk_reload_v1");
                } catch {}
                window.location.reload();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Refresh App
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!autoRetried) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-semibold text-foreground">
          Something went wrong loading this page
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message
            ? "The page couldn't load. This is usually a temporary network hiccup."
            : "Please try again in a moment."}
        </p>
        {error?.message && (
          <details className="mt-3 rounded-md border border-border bg-muted/30 p-2 text-left text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">
              Error details
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              void router.invalidate().then(() => reset());
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}