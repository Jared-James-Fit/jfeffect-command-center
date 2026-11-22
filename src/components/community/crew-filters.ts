import { useEffect, useMemo, useState } from "react";
import { FILTER_GROUPS, filterLabel, filterRow, groupOrder, isGrade, paintStoryFilter, readBlockWeek, storyFilter, type FilterContext, type FilterGroup, type StoryFilter } from "@/lib/story-filters";
import type { CameraCard } from "@/components/community/share-studio";
import type { LookGroup, LookItem } from "@/components/community/look-carousel";

/** A story filter's key in the row ("fx:legday"). */
export const FX = "fx:";
export const NORMAL_KEY = "post:normal";
export const isFxKey = (k: string | null | undefined) => !!k && k.startsWith(FX);

/** The clock the filters read, a fresh one each minute (so a painter's identity holds for a minute). */
export function useMinute(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, [enabled]);
  // only a new minute is a new clock
  const key = `${now.getHours()}:${now.getMinutes()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => now, [key]);
}

/** What the filters can show: the athlete's own, already-public things (see story-filters.ts). */
export function useFilterContext(i: Omit<FilterContext, "now" | "block"> & { blockTitle: string | null | undefined; enabled: boolean }): FilterContext {
  const now = useMinute(i.enabled);
  const key = JSON.stringify([i.firstName, i.session, i.finished, i.blockTitle, i.fuel]);
  return useMemo(
    () => ({ now, firstName: i.firstName, session: i.session, finished: i.finished, block: readBlockWeek(i.blockTitle), fuel: i.fuel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, key],
  );
}

/**
 * The whole row of filters, Normal first, then each group in the order that
 * fits right now (story-filters.ts' groupOrder): the cards the caller has for
 * a group (a lock in's, a workout's, a meal's) lead it, then that group's
 * story filters. With the chips for the groups that have something.
 */
export function buildFilterRow(c: FilterContext, cards: Partial<Record<FilterGroup, LookItem[]>> = {}, opts: { gradesOnly?: boolean } = {}): { items: LookItem[]; groups: LookGroup[] } {
  const fx = filterRow(c).filter((f) => !opts.gradesOnly || isGrade(f));
  const items: LookItem[] = [{ key: NORMAL_KEY, look: "plain", label: "Normal" }];
  const order = groupOrder(c);
  for (const g of order) {
    items.push(...(cards[g] ?? []).map((it) => ({ ...it, group: g })));
    items.push(...fx.filter((f) => f.group === g).map((f) => fxItem(f, c)));
  }
  const groups = order.map((k) => FILTER_GROUPS.find((g) => g.key === k)!).filter((g) => items.some((it) => it.group === g.key));
  return { items, groups };
}

function fxItem(f: StoryFilter, c: FilterContext): LookItem {
  return { key: `${FX}${f.id}`, look: "plain", label: filterLabel(f, c), emoji: f.emoji, group: f.group };
}

/** A story filter as a card the studio and the composer paint (its own painter, at whatever size they ask). */
export function fxCard(key: string, c: FilterContext, data: CameraCard["data"]): { card: CameraCard; grade: boolean } | null {
  const f = storyFilter(key.slice(FX.length));
  if (!f) return null;
  return {
    grade: isGrade(f),
    card: {
      data,
      looks: ["plain"],
      look: "plain",
      onLook: () => undefined,
      paint: (canvas, media, format, scale, logo) => paintStoryFilter(canvas, f, c, media, logo, format, scale),
    },
  };
}
