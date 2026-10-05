import { File as FileIcon, Mic, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDraftProgress, type DraftProgressStore, type DraftUpload,
} from "@/hooks/use-draft-uploads";

/** Composer tray: thumbnails of picked media with live upload progress. */
export function DraftUploadChips<A>({
  drafts, store, onRemove,
}: {
  drafts: DraftUpload<A>[];
  store: DraftProgressStore;
  onRemove: (id: string) => void;
}) {
  if (!drafts.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {drafts.map((d) => (
        <DraftChip key={d.id} draft={d} store={store} onRemove={() => onRemove(d.id)} />
      ))}
    </div>
  );
}

function DraftChip<A>({
  draft, store, onRemove,
}: {
  draft: DraftUpload<A>;
  store: DraftProgressStore;
  onRemove: () => void;
}) {
  const pct = useDraftProgress(store, [draft.id]);
  const uploading = pct < 100;
  const media = draft.kind === "image" || draft.kind === "video";
  const Icon = draft.kind === "video" ? Video : draft.kind === "audio" ? Mic : FileIcon;
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl border border-border bg-secondary/40",
        media ? "h-16 w-16" : "flex h-16 w-40 items-center gap-2 px-2.5",
      )}
      title={draft.name}
    >
      {draft.kind === "image" && draft.previewUrl && (
        <img src={draft.previewUrl} alt="" className="h-full w-full object-cover" />
      )}
      {draft.kind === "video" && draft.previewUrl && (
        // #t=0.1 makes iOS paint the first frame instead of a black box.
        <video src={`${draft.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      )}
      {draft.kind === "video" && (
        <Video className="absolute bottom-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />
      )}
      {!media && (
        <>
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{draft.name}</span>
        </>
      )}
      {uploading && (
        <div className={cn("absolute inset-x-0 bottom-0 h-1 bg-black/30", !media && "inset-x-2 bottom-1.5 rounded-full")}>
          <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
      {uploading && media && (
        <span className="absolute inset-0 grid place-items-center bg-black/35 text-[11px] font-bold tabular-nums text-white">
          {pct}%
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${draft.name}`}
        className="absolute right-0.5 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Inline "Uploading 42%" bar for a sent message whose media is still uploading. Inherits text color. */
export function DraftUploadStatus({
  store, ids, className,
}: {
  store: DraftProgressStore;
  ids: string[];
  className?: string;
}) {
  const pct = useDraftProgress(store, ids);
  if (pct >= 100) return null;
  return (
    <div className={cn("mt-1.5 flex items-center gap-2 text-[11px] font-medium", className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-current/25">
        <div className="h-full rounded-full bg-current transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 tabular-nums">Uploading {pct}%</span>
    </div>
  );
}
