import { Link } from "@tanstack/react-router";
import { ChevronRight, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { importLabel, useOpenImports } from "@/lib/program-import/queries";

/** Imports being read, ready to check, or that couldn't be read: one tap back into each. Nothing when there are none. */
export function OpenImports({ className }: { className?: string }) {
  const q = useOpenImports();
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <section className={cn("space-y-2", className)} aria-label="Imports" data-open-imports>
      <div className="flex items-center gap-2 px-1 text-[13px] font-medium text-muted-foreground">
        <Upload className="h-3.5 w-3.5" aria-hidden /> Imports
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {rows.map((r) => {
          const running = r.status === "pending" || r.status === "reading";
          return (
            <Link
              key={r.id}
              to="/portal/programs/import"
              search={{ id: r.id }}
              className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-secondary/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{importLabel(r)}</span>
                <span className={cn("block text-[13px]", r.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {r.status === "ready" ? "Ready to check and save" : r.status === "failed" ? "Couldn't be read" : "Being read…"}
                </span>
              </span>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
