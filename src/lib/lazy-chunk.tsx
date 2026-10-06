import {
  Component,
  lazy,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { importWithRetry } from "@/lib/chunk-import";
import { isChunkLoadError } from "@/lib/chunk-recovery";
import { flagUpdateAvailable } from "@/lib/pwa/register-sw";

/**
 * Drop-in replacement for `React.lazy` that survives a failed chunk fetch.
 *
 * Plain `React.lazy` has two problems on a frequently deployed app: a failed
 * fetch (stale bundle after a deploy, flaky mobile network) throws past every
 * local boundary into the full-page "Refresh App" screen, and React caches the
 * rejection so retrying is impossible without a reload. This wrapper:
 *
 *  - retries the import once, quietly;
 *  - contains the failure in a small inline fallback with a working Retry
 *    (and "Update app" once Retry has failed), never the page-level screen;
 *  - nudges the app's normal "update available" prompt when the bundle is stale;
 *  - exposes `.preload()` so callers can fetch the chunk before it is needed
 *    (on idle / touch-down) and the first tap opens instantly.
 *
 * Usage matches `lazy`: render inside a <Suspense>.
 */

export type ChunkFallbackContext = { retry: () => void; failures: number };
export type LazyWithRetryOptions = {
  fallback?: (ctx: ChunkFallbackContext) => ReactNode;
};

/** Clear the reload guard and do a hard reload to pick up the latest deployment. */
export function reloadForUpdate() {
  try {
    window.sessionStorage.removeItem("jfe_chunk_reload_v1");
  } catch {
    // ignore
  }
  window.location.reload();
}

/** Primary action for a failed load: Retry first, then a reload once Retry has failed too. */
export function chunkFailureAction({ retry, failures }: ChunkFallbackContext) {
  return failures >= 2
    ? { label: "Update app", run: reloadForUpdate }
    : { label: "Try again", run: retry };
}

function BlockFallback(ctx: ChunkFallbackContext) {
  const action = chunkFailureAction(ctx);
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
    >
      <span>Couldn&apos;t load this section.</span>
      <Button type="button" size="sm" variant="outline" onClick={action.run}>
        {action.label}
      </Button>
    </div>
  );
}

class ChunkBoundary extends Component<
  {
    children: ReactNode;
    render: (ctx: ChunkFallbackContext) => ReactNode;
    retry: () => void;
    getFailures: () => number;
    onCaught: () => void;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Runs after the fallback is committed, i.e. the failure has been consumed.
    if (isChunkLoadError(error)) this.props.onCaught();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Only our own load failures are handled here; anything else keeps
    // bubbling to the route's error boundary exactly as before.
    if (!isChunkLoadError(error)) throw error;
    return this.props.render({ retry: this.props.retry, failures: this.props.getFailures() });
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  options: LazyWithRetryOptions = {},
): ComponentType<ComponentProps<T>> & { preload: () => Promise<void> } {
  let promise: Promise<{ default: T }> | null = null;
  let failures = 0;
  let needsReset = false;

  const load = () => {
    if (!promise) {
      promise = importWithRetry(factory, flagUpdateAvailable).then(
        (mod) => {
          failures = 0;
          return mod;
        },
        (err) => {
          promise = null;
          failures += 1;
          throw err;
        },
      );
    }
    return promise;
  };

  let Inner = lazy(load);
  const renderFallback = options.fallback ?? BlockFallback;

  function LazyWithRetry(props: ComponentProps<T>) {
    const [nonce, setNonce] = useState(0);
    // React caches a rejected lazy for good; swap in a fresh one before the
    // next attempt (retry, or a later mount after an earlier failure). Only
    // armed once the boundary has shown the failure (onCaught): arming it at
    // rejection time would let React's own retry render replace the rejected
    // lazy before its error ever reached the boundary, looping forever.
    if (needsReset) {
      needsReset = false;
      promise = null;
      Inner = lazy(load);
    }
    const retry = () => {
      needsReset = true;
      setNonce((n) => n + 1);
    };
    return (
      <ChunkBoundary
        key={nonce}
        render={renderFallback}
        retry={retry}
        getFailures={() => failures}
        onCaught={() => {
          needsReset = true;
        }}
      >
        <Inner {...(props as any)} />
      </ChunkBoundary>
    );
  }

  LazyWithRetry.preload = (): Promise<void> => load().then(() => undefined, () => undefined);

  return LazyWithRetry as ComponentType<ComponentProps<T>> & { preload: () => Promise<void> };
}
