import { Link } from "@tanstack/react-router";
import { ChevronRight, FilePen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { importLabel, useOpenImports } from "@/lib/program-import/queries";
import { useMyDrafts } from "@/lib/program-history-queries";
import { timeAgo } from "@/lib/calendar-sync";

/**
 * Drafts (Nov 24 2026): everything not saved yet, in one place. Programs
 * being built (kept on the server a beat after every edit, so a draft started
 * on the phone is here on the computer) and imports being read, ready to
 * check, or that couldn't be read. One tap back into each; nothing when there
 * are none. The signed-in login's own only (never shown while viewing as a client).
 */
export function OpenImports({
  className,
  enabled = true,
  importsOnly = false,
}: {
  className?: string;
  enabled?: boolean;
  /** Only imports (the import page itself). */
  importsOnly?: boolean;
}) {
  const q = useOpenImports(enabled);
  const drafts = useMyDrafts(enabled && !importsOnly);
  const rows = enabled ? q.data ?? [] : [];
  const kept = enabled && !importsOnly ? drafts.data ?? [] : [];
  if (!rows.length && !kept.length) return null;
  return (
    <section className={cn("space-y-2", className)} aria-label={importsOnly ? "Imports" : "Drafts"} data-open-imports data-drafts>
      <div className="flex items-center gap-2 px-1 text-[13px] font-semibold text-muted-foreground">
        <FilePen className="h-4 w-4" aria-hidden /> {importsOnly ? "Your imports" : "Drafts"}
        <span className="font-normal tabular-nums">{rows.length + kept.length}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {kept.map((d) => (
          <Link
            key={d.id}
            to="/portal/programs/new"
            search={d.program_id ? ({ edit: d.program_id } as any) : undefined}
            className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-secondary/40"
            data-draft-row={d.program_id ?? "new"}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{d.title?.trim() || "Untitled program"}</span>
              <span className="block text-[13px] text-muted-foreground">
                {d.program_id ? "Unsaved changes" : "New program, not saved yet"} · {timeAgo(d.updated_at)}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ))}
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
