import { Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight } from "lucide-react";
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
  href?: string;
};

const toneOrder: Record<ActionTone, number> = { warning: 0, primary: 1, success: 2 };

export function ActionCentre({ items }: { items: ActionItem[] }) {
  const sorted = [...items].sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

  return (
    <section aria-label="Action Centre" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-base font-bold">Action Centre</h3>
        {sorted.length > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            {sorted.length}
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

  if (item.to) return <Link to={item.to} className="block">{body}</Link>;
  if (item.href) return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">{body}</a>
  );
  return (
    <button type="button" onClick={item.onClick} className="block w-full text-left">{body}</button>
  );
}