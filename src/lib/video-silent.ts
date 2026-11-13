/**
 * Whether a clip has no sound track, read from the player itself (a clip
 * posted with no sound has none, and neither does a screen recording without
 * the mic): true / false, or null while this browser can't tell.
 *
 * Never a guess: Safari (and the iPhone app's web view) lists its audio
 * tracks, Firefox says so; Chrome only counts the sound it decoded, and only
 * an unmuted clip a second in counts as silent there (a muted one may not
 * decode its sound at all), so a clip that might have sound keeps its speaker.
 */
export type SilentProbe = {
  muted: boolean;
  currentTime: number;
  readyState: number;
  audioTracks?: { length: number } | null;
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
};

export function clipIsSilent(v: SilentProbe): boolean | null {
  if (v.readyState < 1) return null;
  if (v.audioTracks && typeof v.audioTracks.length === "number") return v.audioTracks.length === 0;
  if (typeof v.mozHasAudio === "boolean") return !v.mozHasAudio;
  const bytes = v.webkitAudioDecodedByteCount;
  if (typeof bytes === "number") {
    if (bytes > 0) return false;
    if (!v.muted && v.currentTime > 1) return true;
  }
  return null;
}
