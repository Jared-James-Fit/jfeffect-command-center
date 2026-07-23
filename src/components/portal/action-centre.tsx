import { Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ActionTone = "warning" | "primary" | "success";

export type ActionItem = {
  key: string;
  icon: any;
  tone: ActionTone;
  title: string;
  message?: string;
  chip?: string;
  onClick?: () => void;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  href?: string;
};

const toneOrder: Record<ActionTone, number> = { warning: 0, primary: 1, success: 2 };

const SEEN_KEY = "jf:action-centre:seen-keys:v1";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSeen(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    /* ignore */
  }
}

export function ActionCentre({ items }: { items: ActionItem[] }) {
  const sorted = [...items].sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  const currentKeys = sorted.map((it) => it.key);
  const unseenCount = currentKeys.filter((k) => !seen.has(k)).length;

  // Mark all currently-visible items as seen shortly after they render, so the
  // badge clears once the user has actually had a chance to see them.
  useEffect(() => {
    if (currentKeys.length === 0) return;
    const t = window.setTimeout(() => {
      setSeen((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const k of currentKeys) {
          if (!next.has(k)) {
            next.add(k);
            changed = true;
          }
        }
        // Prune keys for items that no longer exist so the store stays bounded.
        const live = new Set(currentKeys);
        for (const k of Array.from(next)) {
          if (!live.has(k)) {
            next.delete(k);
            changed = true;
          }
        }
        if (changed) writeSeen(next);
        return changed ? next : prev;
      });
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKeys.join("|")]);

  return (
    <section aria-label="Action Centre" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-base font-bold">Action Centre</h3>
        {unseenCount > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            {unseenCount}
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">You're all caught up</div>
            <div className="text-xs text-muted-foreground">No actions require your attention.</div>
          </div>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {sorted.map((it, i) => (
            <li key={it.key} className={i > 0 ? "border-t border-border/70" : ""}>
              <Row item={it} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ item }: { item: ActionItem }) {
  const Icon = item.icon;
  const toneIcon =
    item.tone === "warning" ? "text-warning"
    : item.tone === "success" ? "text-emerald-500"
    : "text-primary";
  const toneChip =
    item.tone === "warning" ? "bg-warning/15 text-warning"
    : item.tone === "success" ? "bg-emerald-500/15 text-emerald-500"
    : "bg-primary/15 text-primary";

  const body = (
    <div className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition active:bg-secondary/30">
      <Icon className={cn("h-5 w-5 shrink-0", toneIcon)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-bold">{item.title}</div>
          {item.chip && (
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", toneChip)}>
              {item.chip}
            </span>
          )}
        </div>
        {item.message && (
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.message}</div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );

  if (item.to) {
    // Pre-interpolate `$param` placeholders so we never hand TanStack a
    // template string with a missing/misaligned params prop. Extra params
    // become search params (safe for TanStack `search`).
    let resolved = item.to;
    const leftover: Record<string, unknown> = {};
    if (item.params) {
      for (const [k, v] of Object.entries(item.params)) {
        const tag = `$${k}`;
        if (resolved.includes(tag)) {
          resolved = resolved.split(tag).join(encodeURIComponent(String(v)));
        } else {
          leftover[k] = v;
        }
      }
    }
    const mergedSearch = { ...(item.search ?? {}), ...leftover };
    const hasSearch = Object.keys(mergedSearch).length > 0;
    return (
      <Link
        to={resolved}
        search={hasSearch ? (mergedSearch as any) : undefined}
        className="block"
      >
        {body}
      </Link>
    );
  }
  if (item.href) return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">{body}</a>
  );
  return (
    <button type="button" onClick={item.onClick} className="block w-full text-left">{body}</button>
  );
}