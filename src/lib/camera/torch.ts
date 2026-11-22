/**
 * The camera's light (Nov 22 2026), for the story camera's flash: a back
 * camera whose track says it has a torch (Chrome on Android, and iPhones
 * whose Safari lists it), switched with `applyConstraints`. A camera without
 * one never offers a flash it can't fire; the front camera's flash is the
 * screen itself (share-studio.tsx).
 */
type TorchCaps = { torch?: boolean | boolean[] };

/** Whether this camera can switch its light on. */
export function torchSupported(track: MediaStreamTrack | null | undefined): boolean {
  let caps: TorchCaps | undefined;
  try {
    caps = (track?.getCapabilities?.() as TorchCaps | undefined) ?? undefined;
  } catch {
    return false;
  }
  const t = caps?.torch;
  return Array.isArray(t) ? t.includes(true) : t === true;
}

/** The light on or off; false when the camera refused (it's left as it was). */
export async function switchTorch(track: MediaStreamTrack | null | undefined, on: boolean): Promise<boolean> {
  if (!track || track.readyState !== "live") return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** How long the light is on before a photo is taken (the camera's exposure settles to it). */
export const TORCH_SETTLE_MS = 320;
/** How long the screen is white before a selfie is taken. */
export const SCREEN_FLASH_MS = 260;
