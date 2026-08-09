import { Loader2 } from "lucide-react";

/**
 * Branded full-page loading gate for layout-level guards (role resolution,
 * first mount). Used only while a layout truly cannot render yet — never
 * for ordinary in-app navigation or query refetching.
 */
export function FullPageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}