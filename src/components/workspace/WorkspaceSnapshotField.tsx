import { AlertCircle } from "lucide-react";

/**
 * Small labelled field used inside snapshot grids. Renders a value when
 * present, otherwise a warning-styled fallback button (e.g. "Add phone").
 */
export function WorkspaceSnapshotField({
  label,
  value,
  fallbackAction,
}: {
  label: string;
  value?: string | null;
  fallbackAction?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {value ? (
        <div className="mt-0.5 font-semibold truncate">{value}</div>
      ) : fallbackAction ? (
        <button
          type="button"
          onClick={fallbackAction.onClick}
          className="mt-0.5 inline-flex min-h-[32px] items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning hover:bg-warning/20"
        >
          <AlertCircle className="h-3.5 w-3.5" /> {fallbackAction.label}
        </button>
      ) : (
        <div className="mt-0.5 font-semibold text-muted-foreground">—</div>
      )}
    </div>
  );
}