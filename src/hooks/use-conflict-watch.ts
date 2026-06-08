import { useEffect, useRef, useState } from "react";

/**
 * Cross-coach conflict watcher for meta editors (template / member-plan settings).
 *
 * Compares the freshly-fetched server `remote` value against a captured
 * baseline. When the server moves to a value that is neither the baseline
 * nor the user's current local edit, surface a `conflict` payload so the
 * page can show a "field updated somewhere else" warning with keep/use-latest
 * actions.
 *
 * The baseline rebases automatically:
 *   - whenever the user successfully saves (`savedAt` changes), so the next
 *     refetch is compared against the post-save value rather than the original
 *     mount value;
 *   - whenever the user explicitly resolves the conflict via `dismiss`.
 */
export function useConflictWatch<T>({
  remote,
  local,
  savedAt,
  equals = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b),
}: {
  remote: T | undefined;
  local: T;
  savedAt?: number | null;
  equals?: (a: T, b: T) => boolean;
}) {
  const baselineRef = useRef<T | undefined>(remote);
  const [conflict, setConflict] = useState<T | null>(null);

  // Re-baseline after a successful save.
  useEffect(() => {
    baselineRef.current = remote;
    setConflict(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt]);

  useEffect(() => {
    if (remote === undefined) return;
    if (baselineRef.current === undefined) { baselineRef.current = remote; return; }
    if (equals(remote, baselineRef.current)) return;
    // Server moved. If user has no local divergence from the new remote, just
    // re-baseline silently.
    if (equals(remote, local)) {
      baselineRef.current = remote;
      setConflict(null);
      return;
    }
    setConflict(remote);
  }, [remote, local, equals]);

  return {
    conflict,
    dismiss: () => {
      baselineRef.current = remote;
      setConflict(null);
    },
    acceptRemote: () => {
      baselineRef.current = remote;
      setConflict(null);
    },
  };
}