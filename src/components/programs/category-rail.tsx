import { cn } from "@/lib/utils";
import { CATEGORIES, type CategoryId } from "@/lib/programs/categories";

interface Props {
  value: CategoryId;
  counts?: Partial<Record<CategoryId, number>>;
  profileReady?: boolean;
  onChange: (id: CategoryId) => void;
}

export function CategoryRail({ value, counts, profileReady, onChange }: Props) {
  const visible = CATEGORIES.filter((c) => !(c.id === "recommended" && profileReady === false));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-2 pb-1">
        {visible.map((c) => {
          const active = c.id === value;
          const n = counts?.[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {c.label}
              {typeof n === "number" && (
                <span className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                )}>{n}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
