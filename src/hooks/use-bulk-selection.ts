import { useCallback, useMemo, useState } from "react";

/**
 * Reusable bulk-selection hook for any list of records keyed by id.
 *
 * Usage:
 *   const sel = useBulkSelection(rows.map(r => r.id));
 *   sel.isSelected(id) / sel.toggle(id) / sel.toggleAll() / sel.clear()
 *   sel.selectedIds / sel.count / sel.allSelected / sel.someSelected
 */
export function useBulkSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  // Drop any selected ids that are no longer visible (filter change etc).
  // We do this lazily on read so we never mutate state inside render.
  const effective = useMemo(() => {
    const out = new Set<string>();
    for (const id of selected) if (visibleSet.has(id)) out.add(id);
    return out;
  }, [selected, visibleSet]);

  const isSelected = useCallback((id: string) => effective.has(id), [effective]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setOne = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const count = effective.size;
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => effective.has(id));
  const someSelected = count > 0 && !allSelected;

  return {
    selectedIds: Array.from(effective),
    count,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    setOne,
    toggleAll,
    clear,
  };
}

export type BulkSelection = ReturnType<typeof useBulkSelection>;