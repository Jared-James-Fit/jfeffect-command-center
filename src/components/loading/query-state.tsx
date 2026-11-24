import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useArrivalClass } from "@/hooks/use-arrival";
import { combineQueryViews, queryView, type QueryView } from "@/lib/loading/load-state";
import { EmptyState, ErrorState, OfflineState, RefreshFailedNote, SlowNote } from "@/components/loading/load-states";
import { CardSkeleton } from "@/components/loading/skeletons";

type AnyQuery = Pick<UseQueryResult<any, any>, "status" | "fetchStatus" | "data" | "error" | "refetch" | "isFetching">;

/** One query (or several) read as what to show: loading, offline, error, empty or ready (load-state.ts `queryView`). */
export function useQueryView<T>(query: Pick<UseQueryResult<T, any>, "status" | "fetchStatus" | "data" | "error">, isEmpty?: (data: T) => boolean): QueryView {
  return queryView(query as any, isEmpty);
}

/** Refetch every query that has no data or failed (a combined Try again). */
function retryAll(queries: AnyQuery[]) {
  return Promise.all(queries.filter((q) => q.data === undefined || q.status === "error").map((q) => q.refetch()));
}

/**
 * A section driven by data, with every state handled the same way app-wide:
 *  - waiting: `skeleton` (its space held from the first frame, seen only after a
 *    beat), then "Taking longer than usual…", then Try again (never an endless spinner);
 *  - offline with nothing saved: says it loads when they're back online;
 *  - failed with nothing to show: what happened and Try again, never an empty list;
 *  - answered and empty: `empty` (or nothing, when it isn't given);
 *  - data (cached or fresh): `children`, which a failed refresh never hides
 *    (one quiet line says so, unless `quietRefreshErrors`).
 *
 * ```tsx
 * <QueryState query={sales} what="sales" skeleton={<ListSkeleton />} isEmpty={(d) => !d.length} empty={<EmptyState title="No sales yet" />}>
 *   {(rows) => <SalesList rows={rows} />}
 * </QueryState>
 * ```
 */
export function QueryState<T>({
  query,
  children,
  skeleton,
  isEmpty,
  empty,
  what,
  errorSize = "card",
  quietRefreshErrors = false,
  className,
}: {
  query: Pick<UseQueryResult<T, any>, "status" | "fetchStatus" | "data" | "error" | "refetch" | "isFetching">;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** Completes "Couldn't load …" ("your sales"). */
  what?: string;
  errorSize?: "card" | "inline" | "page";
  quietRefreshErrors?: boolean;
  className?: string;
}) {
  const view = useQueryView(query, isEmpty);
  const arrive = useArrivalClass(view.kind === "loading");
  const retry = () => query.refetch();

  if (view.kind === "loading") {
    return (
      <div className={className}>
        {skeleton ?? <CardSkeleton />}
        <SlowNote active onRetry={retry} what={what} />
      </div>
    );
  }
  if (view.kind === "offline") return <OfflineState what={what} size={errorSize} className={className} />;
  if (view.kind === "error") {
    return (
      <ErrorState
        error={query.error}
        what={what}
        onRetry={retry}
        retrying={query.isFetching}
        size={errorSize}
        className={className}
      />
    );
  }
  const body = view.kind === "empty" ? (empty ?? null) : children(query.data as T);
  return (
    <div className={[className, arrive].filter(Boolean).join(" ") || undefined}>
      {view.refreshFailed && !quietRefreshErrors && (
        <RefreshFailedNote onRetry={retry} retrying={query.isFetching} className="mb-3" />
      )}
      {body}
    </div>
  );
}

/** Several queries behind one section: the first problem wins; children get every query's data. */
export function QueriesState<Ts extends unknown[]>({
  queries,
  children,
  skeleton,
  what,
  errorSize = "card",
  className,
}: {
  queries: { [K in keyof Ts]: Pick<UseQueryResult<Ts[K], any>, "status" | "fetchStatus" | "data" | "error" | "refetch" | "isFetching"> };
  children: (data: Ts) => ReactNode;
  skeleton?: ReactNode;
  what?: string;
  errorSize?: "card" | "inline" | "page";
  className?: string;
}) {
  const list = queries as unknown as AnyQuery[];
  const view = combineQueryViews(list.map((q) => queryView(q as any)));
  const arrive = useArrivalClass(view.kind === "loading");
  const retry = () => retryAll(list);
  if (view.kind === "loading") {
    return (
      <div className={className}>
        {skeleton ?? <CardSkeleton />}
        <SlowNote active onRetry={retry} what={what} />
      </div>
    );
  }
  if (view.kind === "offline") return <OfflineState what={what} size={errorSize} className={className} />;
  if (view.kind === "error") {
    const failed = list.find((q) => q.status === "error" && q.data === undefined);
    return (
      <ErrorState
        error={failed?.error}
        what={what}
        onRetry={retry}
        retrying={list.some((q) => q.isFetching)}
        size={errorSize}
        className={className}
      />
    );
  }
  return (
    <div className={[className, arrive].filter(Boolean).join(" ") || undefined}>
      {view.refreshFailed && <RefreshFailedNote onRetry={retry} retrying={list.some((q) => q.isFetching)} className="mb-3" />}
      {children(list.map((q) => q.data) as Ts)}
    </div>
  );
}

export { EmptyState };
