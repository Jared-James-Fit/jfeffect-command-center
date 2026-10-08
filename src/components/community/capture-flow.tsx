import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ShareCamera, type CameraCard, type CameraMode } from "@/components/community/share-camera";
import { PhotoDecorator } from "@/components/community/photo-decorator";

/**
 * Camera → text & stickers → back to the caller with the finished photo.
 * Back from the editor returns to the camera. Videos skip the editor.
 */
export function CaptureFlow({
  open,
  onClose,
  onDone,
  onSkip,
  skipLabel,
  workoutTitle,
  modes,
  mode,
  onMode,
  hint,
  chip,
  card,
  canShoot,
  accept,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (file: File, live: boolean) => void;
  onSkip?: () => void;
  skipLabel?: string;
  workoutTitle?: string | null;
  modes?: CameraMode[];
  mode?: string;
  onMode?: (key: string) => void;
  hint?: string | null;
  chip?: ReactNode;
  card?: CameraCard | null;
  canShoot?: boolean;
  accept?: string;
}) {
  const [shot, setShot] = useState<{ file: File; live: boolean } | null>(null);
  useEffect(() => {
    if (!open) setShot(null);
  }, [open]);

  // The time sticker is the athlete's own clock, whatever time zone they're in.
  const context = useMemo(() => {
    const now = new Date();
    return { time: format(now, "h:mm a"), date: format(now, "EEE, MMM d"), workoutTitle: workoutTitle ?? null };
    // re-read the clock each time the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutTitle, shot]);

  return (
    <>
      <ShareCamera
        open={open && !shot}
        onClose={onClose}
        onPhoto={(file, live) => {
          if (file.type.startsWith("video/")) onDone(file, live);
          else setShot({ file, live });
        }}
        onSkip={onSkip}
        skipLabel={skipLabel}
        modes={modes}
        mode={mode}
        onMode={onMode}
        hint={hint}
        chip={chip}
        card={card}
        canShoot={canShoot}
        accept={accept}
      />
      <PhotoDecorator
        file={open ? shot?.file ?? null : null}
        context={context}
        onBack={() => setShot(null)}
        onDone={(file) => {
          const live = !!shot?.live;
          setShot(null);
          onDone(file, live);
        }}
      />
    </>
  );
}
