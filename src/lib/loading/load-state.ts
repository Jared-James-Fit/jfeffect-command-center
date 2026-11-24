/**
 * How the app reads a wait, in one place (pure, tested in load-state.test.ts).
 *
 * Every loading surface (a page's skeleton, a card's data, a button's work, an
 * upload, an AI run) answers the same questions the same way:
 *  - is it quick enough to show nothing at all (`showAfterMs`)?
 *  - has it been long enough to say so (`slowAfterMs`)?
 *  - has it been so long that the person needs a way out (`stalledAfterMs`)?
 *  - did it fail, and in what plain words (`describeLoadError`)?
 *  - is it worth trying again by itself (`shouldRetryQuery`)?
 * Nothing here makes up progress: a phase is only ever time measured.
 */

export const LOAD_TIMING = {
  /** A wait under this shows nothing at all: an instant answer never flashes a loader. */
  showAfterMs: 200,
  /** Past this, the wait says it's taking longer than usual. */
  slowAfterMs: 8_000,
  /** Past this, a load that's still waiting offers Try again (never an endless spinner). */
  stalledAfterMs: 20_000,
} as const;

export type LoadTiming = { showAfterMs: number; slowAfterMs: number; stalledAfterMs: number };

/** Where a wait is: under the show threshold, loading, slow, or stalled. */
export type LoadPhase = "instant" | "loading" | "slow" | "stalled";

export function loadPhase(elapsedMs: number, t: LoadTiming = LOAD_TIMING): LoadPhase {
  if (!Number.isFinite(elapsedMs) || elapsedMs < t.showAfterMs) return "instant";
  if (elapsedMs < t.slowAfterMs) return "loading";
  if (elapsedMs < t.stalledAfterMs) return "slow";
  return "stalled";
}

/** The next moment the phase changes, so a hook waits on one timer instead of ticking. */
export function nextPhaseAt(elapsedMs: number, t: LoadTiming = LOAD_TIMING): number | null {
  for (const at of [t.showAfterMs, t.slowAfterMs, t.stalledAfterMs]) if (elapsedMs < at) return at;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Errors in plain words                                                      */
/* -------------------------------------------------------------------------- */

export type LoadErrorKind =
  | "offline"
  | "network"
  | "timeout"
  | "session"
  | "forbidden"
  | "not_found"
  | "rate"
  | "server"
  | "other";

function messageOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; error_description?: unknown; error?: unknown };
  if (typeof e.message === "string") return e.message;
  if (typeof e.error_description === "string") return e.error_description;
  if (typeof e.error === "string") return e.error;
  return "";
}

/** An HTTP status anywhere the usual clients put one (Supabase, fetch wrappers, server functions). */
export function statusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, any>;
  for (const v of [e.status, e.statusCode, e.context?.status, e.response?.status, e.cause?.status]) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n) && n >= 100 && n < 600) return n;
  }
  return null;
}

function codeOf(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" || typeof c === "number" ? String(c) : "";
}

const NETWORK_WORDS = [
  "failed to fetch",
  "load failed",
  "networkerror",
  "network error",
  "network request failed",
  "fetch failed",
  "internet connection appears to be offline",
  "err_internet_disconnected",
  "err_network_changed",
  "err_connection",
  "the network connection was lost",
  "could not connect to the server",
];

/** What kind of failure this is, read from its status, code and words. */
export function loadErrorKind(err: unknown, online = true): LoadErrorKind {
  const msg = messageOf(err).toLowerCase();
  const name = err && typeof err === "object" ? String((err as { name?: unknown }).name ?? "") : "";
  const status = statusOf(err);
  const code = codeOf(err);

  if (!online) return "offline";
  if (name === "TimeoutError" || code === "57014" || /\btime(d)? ?out\b|timed out|statement timeout/.test(msg)) return "timeout";
  if (NETWORK_WORDS.some((w) => msg.includes(w))) return "network";
  if (name === "TypeError" && msg.includes("fetch")) return "network";
  if (status === 401 || code === "PGRST301" || code === "PGRST302" || /jwt (expired|malformed)|invalid jwt|not authenticated|auth session missing|refresh token/.test(msg)) return "session";
  if (status === 403 || code === "42501" || /permission denied|row-level security|not allowed|forbidden|not authori[sz]ed/.test(msg)) return "forbidden";
  if (status === 404 || code === "PGRST116" || /\bnot found\b/.test(msg)) return "not_found";
  if (status === 429 || /rate limit|too many requests/.test(msg)) return "rate";
  if ((status != null && status >= 500) || /internal server error|bad gateway|service unavailable|gateway time|worker exceeded|\b50[234]\b/.test(msg)) return "server";
  return "other";
}

export type LoadErrorWords = {
  kind: LoadErrorKind;
  /** One short line: what happened. */
  title: string;
  /** What to do about it, or null. */
  detail: string | null;
  /** Whether Try again can help. */
  retryable: boolean;
};

/** A failure in the person's words, never a stack trace or a database code. */
export function describeLoadError(err: unknown, opts: { online?: boolean; what?: string } = {}): LoadErrorWords {
  const kind = loadErrorKind(err, opts.online ?? true);
  const what = opts.what?.trim();
  const couldnt = what ? `Couldn't load ${what}` : "Couldn't load this";
  switch (kind) {
    case "offline":
      return { kind, title: "You're offline", detail: "It'll load when you're back online.", retryable: true };
    case "network":
      return { kind, title: couldnt, detail: "Check your connection and try again.", retryable: true };
    case "timeout":
      return { kind, title: `${couldnt} in time`, detail: "It took too long to answer. Try again.", retryable: true };
    case "session":
      return { kind, title: "Your sign-in needs refreshing", detail: "Try again. If it keeps happening, sign out and back in.", retryable: true };
    case "forbidden":
      return { kind, title: "You don't have access to this", detail: null, retryable: false };
    case "not_found":
      return { kind, title: "This isn't here anymore", detail: "It may have been moved or deleted.", retryable: false };
    case "rate":
      return { kind, title: "Too many requests right now", detail: "Wait a moment, then try again.", retryable: true };
    case "server":
      return { kind, title: couldnt, detail: "Something went wrong on our side. Try again in a moment.", retryable: true };
    default:
      return { kind, title: couldnt, detail: "Try again. If it keeps happening, let your coach know.", retryable: true };
  }
}

/* -------------------------------------------------------------------------- */
/* Retrying                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The query client's default: a failure that can only fail again (no access,
 * gone, a bad request) is shown at once instead of after a pointless retry;
 * a dropped connection, a timeout or a server hiccup gets two more tries with
 * a backoff, which is what gym wifi needs; anything else one, as before.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const kind = loadErrorKind(error);
  if (kind === "forbidden" || kind === "not_found") return false;
  const status = statusOf(error);
  if (status != null && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) return false;
  if (kind === "network" || kind === "timeout" || kind === "server" || kind === "rate") return failureCount < 2;
  return failureCount < 1;
}

/** 1 s, then 2 s, then 4 s (capped at 8 s), with a little jitter so a crowd doesn't retry in step. */
export function queryRetryDelay(attemptIndex: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attemptIndex), 8000);
  return base + Math.round(random() * 250);
}

/* -------------------------------------------------------------------------- */
/* A query, read as what to show                                              */
/* -------------------------------------------------------------------------- */

export type QueryLike<T = unknown> = {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data: T | undefined;
  error: unknown;
};

export type QueryViewKind = "loading" | "offline" | "error" | "empty" | "ready";

export type QueryView = {
  kind: QueryViewKind;
  /** Data on screen is being refreshed in the background. */
  refreshing: boolean;
  /** Data on screen, but the latest refresh failed (shown quietly, never instead of the data). */
  refreshFailed: boolean;
};

/**
 * What a screen should show for a query:
 *  - data (cached or fresh) always wins: a failed or paused refresh never hides it;
 *  - waiting offline with nothing to show is "offline" (TanStack pauses it; it
 *    would otherwise read as loading forever);
 *  - a failure with nothing to show is "error", never an empty list;
 *  - empty only when the answer really is empty.
 */
export function queryView<T>(q: QueryLike<T>, isEmpty?: (data: T) => boolean): QueryView {
  const hasData = q.data !== undefined;
  if (hasData) {
    const empty = isEmpty ? isEmpty(q.data as T) : false;
    return {
      kind: empty ? "empty" : "ready",
      refreshing: q.fetchStatus === "fetching",
      refreshFailed: q.status === "error" && q.fetchStatus !== "fetching",
    };
  }
  if (q.status === "error" && q.fetchStatus !== "fetching") return { kind: "error", refreshing: false, refreshFailed: false };
  if (q.fetchStatus === "paused") return { kind: "offline", refreshing: false, refreshFailed: false };
  if (q.status === "success") {
    // answered with `undefined` (a query that returns nothing): treat as empty
    return { kind: "empty", refreshing: q.fetchStatus === "fetching", refreshFailed: false };
  }
  return { kind: "loading", refreshing: false, refreshFailed: false };
}

/** Several queries read as one: the first problem wins, then loading, then data. */
export function combineQueryViews(views: QueryView[]): QueryView {
  const order: QueryViewKind[] = ["error", "offline", "loading", "empty", "ready"];
  let kind: QueryViewKind = "ready";
  for (const k of order) {
    if (views.some((v) => v.kind === k)) {
      kind = k;
      break;
    }
  }
  // "empty" for a combined view only when every part is empty
  if (kind === "empty" && views.some((v) => v.kind === "ready")) kind = "ready";
  return {
    kind,
    refreshing: views.some((v) => v.refreshing),
    refreshFailed: views.some((v) => v.refreshFailed),
  };
}

/** "0:42", "3:05", "1:02:10": how long something has been running, for long work. */
export function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Bytes in words: "740 KB", "4.2 MB". */
export function bytesWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "4.2 MB of 10.0 MB · 42%": an upload's real progress, or null when its size is unknown. */
export function uploadWords(loaded: number, total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
  return `${bytesWords(Math.min(loaded, total))} of ${bytesWords(total)} · ${pct}%`;
}
