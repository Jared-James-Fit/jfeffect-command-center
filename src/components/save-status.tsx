import { Check, CloudOff, Loader2, AlertCircle, Pencil } from "lucide-react";
import type { SaveState } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";

type Props = { state: SaveState; savedAt?: number | null; className?: string; compact?: boolean };

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function SaveStatus({ state, savedAt, className, compact }: Props) {
  const map: Record<SaveState, { icon: any; label: string; tone: string }> = {
    idle: { icon: Pencil, label: "Unsaved changes", tone: "text-muted-foreground" },
    saving: { icon: Loader2, label: "Saving…", tone: "text-muted-foreground" },
    saved: { icon: Check, label: savedAt ? `Saved ${timeAgo(savedAt)}` : "Saved", tone: "text-green-500" },
    error: { icon: AlertCircle, label: "Save failed · retrying", tone: "text-destructive" },
    offline: { icon: CloudOff, label: "Offline — will sync", tone: "text-amber-500" },
  };
  const cfg = map[state];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", cfg.tone, className)}>
      <Icon className={cn("h-3 w-3", state === "saving" && "animate-spin")} />
      {!compact && <span>{cfg.label}</span>}
    </span>
  );
}