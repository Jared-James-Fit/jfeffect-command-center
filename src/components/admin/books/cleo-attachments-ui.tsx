/**
 * Cleo attachments in the chat: the tray above the composer (files being
 * prepared and uploaded, each removable) and the tiles in a sent message
 * (tap to open). See cleo-attachments.ts for what happens to each kind.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, FileText, Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_ATTACHMENTS, attachmentKind, type AttachmentKind, type CleoAttachment } from "@/lib/cleo-attachments";
import { discardAttachment, prepareAttachment } from "@/lib/cleo-attachment-upload";

type TrayItem = {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** Local preview (object URL) for photos and videos. */
  preview?: string;
  status: "working" | "ready" | "error";
  stage?: string;
  error?: string;
  attachment?: CleoAttachment;
};

export function useAttachmentTray() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (id: string, p: Partial<TrayItem>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = useCallback((files: FileList | File[]) => {
    const picked = Array.from(files);
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    if (picked.length > room) toast.message(`Up to ${MAX_ATTACHMENTS} attachments a message.`);
    for (const file of picked.slice(0, Math.max(0, room))) {
      const kind = attachmentKind(file.type, file.name);
      if (!kind) {
        toast.error(`${file.name}: Cleo can read photos, videos, PDFs and text files.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined;
      setItems((list) => [...list, { id, name: file.name || kind, kind, preview, status: "working", stage: "Preparing…" }]);
      prepareAttachment(file, (stage) => patch(id, { stage }))
        .then((attachment) => {
          // Removed while it was uploading: let the file go.
          if (!itemsRef.current.some((x) => x.id === id)) return void discardAttachment(attachment);
          patch(id, { status: "ready", attachment, stage: undefined });
        })
        .catch((e: any) => patch(id, { status: "error", error: e?.message ?? "Couldn't attach that", stage: undefined }));
    }
  }, []);

  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((x) => x.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    if (item?.attachment) void discardAttachment(item.attachment);
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  /** After sending: the files now belong to the message, so only the previews go. */
  const clear = useCallback(() => {
    for (const x of itemsRef.current) if (x.preview) URL.revokeObjectURL(x.preview);
    setItems([]);
  }, []);

  useEffect(() => () => {
    for (const x of itemsRef.current) if (x.preview) URL.revokeObjectURL(x.preview);
  }, []);

  const ready = items.filter((x) => x.status === "ready" && x.attachment).map((x) => x.attachment!);
  return { items, ready, busy: items.some((x) => x.status === "working"), add, remove, clear };
}

/** What Cleo is doing while it answers, for a message with attachments. */
export function workingLabel(atts: CleoAttachment[]): string | null {
  if (atts.some((a) => a.kind === "video")) return "Watching your video…";
  if (atts.some((a) => a.kind === "pdf")) return "Reading your PDF…";
  if (atts.some((a) => a.kind === "image")) return atts.filter((a) => a.kind === "image").length > 1 ? "Looking at your photos…" : "Looking at your photo…";
  if (atts.length) return "Reading your file…";
  return null;
}

export function AttachmentTray({ items, onRemove }: { items: TrayItem[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5" aria-label="Attachments">
      {items.map((x) => (
        <div
          key={x.id}
          className={cn(
            "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-muted",
            x.status === "error" && "border-destructive",
          )}
          title={x.error ?? x.name}
        >
          {x.kind === "image" && x.preview ? (
            <img src={x.preview} alt={x.name} className="h-full w-full object-cover" />
          ) : x.kind === "video" && x.preview ? (
            <>
              <video src={`${x.preview}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <Play className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-white text-white drop-shadow" />
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="w-full truncate text-[9px] text-muted-foreground">{x.name}</span>
            </div>
          )}
          {x.status === "working" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-background/90 text-[9px] font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="px-1 text-center leading-tight">{x.stage}</span>
            </div>
          )}
          {x.status === "error" && (
            <button type="button" className="absolute inset-0 flex items-center justify-center bg-background/90" onClick={() => toast.error(x.error ?? "Couldn't attach that")} aria-label={`Why ${x.name} failed`}>
              <AlertCircle className="h-5 w-5 text-destructive" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(x.id)}
            className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border"
            aria-label={`Remove ${x.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function clock(s?: number) {
  if (!s) return "";
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/** A sent message's attachments: photos and videos as tiles, files as chips. Tap opens it. */
export function MessageAttachments({ attachments }: { attachments: CleoAttachment[] }) {
  if (!attachments.length) return null;
  const open = (url?: string) => {
    if (url) window.open(url, "_blank", "noopener");
  };
  const media = attachments.filter((a) => a.kind === "image" || a.kind === "video");
  const docs = attachments.filter((a) => a.kind === "pdf" || a.kind === "text");
  return (
    <div className="mb-1.5 space-y-1.5">
      {media.length > 0 && (
        <div className={cn("grid gap-1", media.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {media.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => open(a.url ?? a.thumbUrl)}
              className={cn("relative overflow-hidden rounded-xl bg-black/20", media.length === 1 ? "max-h-64 w-56" : "aspect-square w-28")}
              aria-label={`Open ${a.name}`}
            >
              {a.thumbUrl ? (
                <img src={a.thumbUrl} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-24 w-full items-center justify-center text-xs opacity-80">{a.name}</div>
              )}
              {a.kind === "video" && (
                <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Play className="h-2.5 w-2.5 fill-white" /> {clock(a.duration)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {docs.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => open(a.url)}
          className="flex max-w-56 items-center gap-2 rounded-xl bg-black/15 px-2.5 py-2 text-left text-xs"
          aria-label={`Open ${a.name}`}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{a.name}</span>
        </button>
      ))}
    </div>
  );
}
