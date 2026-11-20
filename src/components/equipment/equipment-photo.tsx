/**
 * Equipment and setup photos: a thumbnail that signs its own private link, and
 * a picker (the phone's own Take photo / Choose from library) that shrinks the
 * photo on the phone before it uploads into the athlete's folder.
 */
import { useRef, useState } from "react";
import { Camera, ImageOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { uploadEquipmentPhoto, useEquipmentPhotoUrl } from "@/lib/equipment/equipment-queries";

export function EquipmentThumb({
  path,
  className,
  icon,
  alt = "",
}: {
  path: string | null | undefined;
  className?: string;
  /** Shown when there's no photo. */
  icon?: React.ReactNode;
  alt?: string;
}) {
  const url = useEquipmentPhotoUrl(path);
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground", className)}>
      {path && url && !broken ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : path && broken ? (
        <ImageOff className="h-4 w-4" aria-hidden />
      ) : (
        icon ?? null
      )}
    </span>
  );
}

/**
 * A photo slot: "Add a photo" until there's one, then the photo with ✕. It
 * never deletes a file itself: the photo it shows may still be the saved one
 * (a draft can be discarded), so its owner removes a replaced photo once the
 * change is saved and an unsaved upload when it's thrown away.
 */
export function PhotoSlot({
  clientId,
  path,
  onChange,
  label = "Add a photo",
  disabled = false,
  className,
}: {
  clientId: string;
  path: string | null;
  onChange: (path: string | null) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const next = await uploadEquipmentPhoto(clientId, file);
      await onChange(next);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add the photo");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const clear = async () => {
    await onChange(null);
  };
  return (
    <div className={cn("flex items-center gap-3", className)} data-equipment-photo>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {path ? (
        <>
          <EquipmentThumb path={path} className="h-16 w-16" alt="Photo" />
          {!disabled && (
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => input.current?.click()} className="h-9 rounded-lg px-2 text-left text-[13px] font-medium text-foreground active:bg-muted" disabled={busy}>
                {busy ? "Uploading…" : "Change photo"}
              </button>
              <button type="button" onClick={() => void clear()} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-left text-[13px] text-muted-foreground active:bg-muted" disabled={busy}>
                <X className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            </div>
          )}
        </>
      ) : !disabled ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-dashed border-border px-3 text-[13px] font-medium text-muted-foreground active:bg-muted"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
          {busy ? "Uploading…" : label}
        </button>
      ) : null}
    </div>
  );
}
