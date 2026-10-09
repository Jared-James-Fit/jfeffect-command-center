import { Eye } from "lucide-react";

/** Shown across the admin app for the finance login: what it can and can't change. */
export function ViewOnlyStrip() {
  return (
    <div className="flex items-start gap-2 border-b bg-secondary/40 px-4 py-1.5 text-xs text-muted-foreground md:px-6">
      <Eye className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold text-foreground">View only.</span>{" "}
        You can see everything. You can change the books, record payments, send payment links and manage discount codes.
      </p>
    </div>
  );
}
