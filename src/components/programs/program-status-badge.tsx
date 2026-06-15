import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { validateTemplatePayload, type DayIssue } from "@/lib/pl-template-validation";

/**
 * Compact status pill for a Program Library template.
 *  - Green "Ready to assign" when validateTemplatePayload returns no issues.
 *  - Amber "N issue(s)" with a popover that lists every missing field, grouped
 *    by day, when the template still has gaps.
 *
 * Click toggles a popover; the trigger itself isn't a button when there are
 * no issues so the green badge doesn't grab focus on tab.
 */
export function ProgramStatusBadge({
  template,
  size = "sm",
  className = "",
}: {
  template: any;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const issues = useMemo<DayIssue[]>(
    () => validateTemplatePayload(template),
    [template],
  );
  const issueCount = issues.reduce((n, d) => n + d.missing.length, 0);
  const ready = issues.length === 0;

  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";

  if (ready) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400 ${pad} ${className}`}
        title="All required fields are set. This template is ready to assign."
      >
        <CheckCircle2 className="h-3 w-3" />
        Ready to assign
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 ${pad} ${className}`}
        >
          <AlertTriangle className="h-3 w-3" />
          {issueCount} {issueCount === 1 ? "issue" : "issues"} — incomplete
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,90vw)] p-0">
        <div className="border-b border-border bg-amber-500/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Missing fields ({issueCount})
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Fix every item below before this template can be assigned to a client.
          </p>
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto p-3">
          {issues.map((d, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                {d.location}
              </div>
              <ul className="space-y-0.5 pl-3 text-xs text-muted-foreground">
                {d.missing.map((m, j) => (
                  <li key={j} className="list-disc">{m}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}