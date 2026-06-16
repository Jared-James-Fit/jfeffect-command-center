import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

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

  useEffect(() => {
    if (autoRetried) return;
    setAutoRetried(true);
    const id = window.setTimeout(() => {
      void router.invalidate().then(() => reset());
    }, 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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