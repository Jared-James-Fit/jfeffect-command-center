import { useEffect } from "react";
import { holdPlaybackSession } from "@/lib/audio-session";

/**
 * While `active`, the page plays sound like a video app (through the iOS
 * silent switch). For embedded players (Vimeo / YouTube iframes) the page
 * can't see play events from, so it holds for as long as the player is up.
 */
export function usePlaybackSession(active = true) {
  useEffect(() => (active ? holdPlaybackSession() : undefined), [active]);
}
