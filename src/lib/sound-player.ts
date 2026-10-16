// Global single-instance audio player so only one sound plays at a time.
// Never autoplays — playSound() must be called from a user gesture.
//
// A sound someone taps to hear plays through the iPhone's Ring/Silent switch,
// like a video (audio-session.ts holds "playback" while it plays). The page
// sits on "ambient" for the app's own blips, and the app's media watcher only
// hears <audio> in the page, never this detached element: with the switch on
// silent, chat sound effects played without a sound.
import { holdPlaybackSession } from "@/lib/audio-session";

type Listener = (state: { url: string | null; playing: boolean }) => void;

let audio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
const listeners = new Set<Listener>();
let releaseSession: (() => void) | null = null;

function release() {
  releaseSession?.();
  releaseSession = null;
}

function ensureAudio() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      currentUrl = null;
      release();
      emit();
    });
    // Switching sounds fires the old one's pause after the new one started:
    // only let the session go when it really is paused.
    audio.addEventListener("pause", () => {
      if (audio?.paused) release();
      emit();
    });
    audio.addEventListener("error", () => {
      release();
      emit();
    });
    audio.addEventListener("play", () => {
      if (!releaseSession) releaseSession = holdPlaybackSession();
      emit();
    });
  }
  return audio;
}

function emit() {
  const state = { url: currentUrl, playing: !!audio && !audio.paused };
  listeners.forEach((fn) => fn(state));
}

export async function playSound(url: string): Promise<void> {
  const el = ensureAudio();
  if (!el) return;
  if (currentUrl === url && !el.paused) {
    el.pause();
    return;
  }
  if (currentUrl !== url) {
    el.src = url;
    currentUrl = url;
  }
  // before play(): the session has to be "playback" when the sound starts
  if (!releaseSession) releaseSession = holdPlaybackSession();
  try {
    await el.play();
  } catch {
    currentUrl = null;
    release();
    emit();
  }
}

export function stopSound() {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  currentUrl = null;
  release();
  emit();
}

export function subscribeSound(fn: Listener): () => void {
  listeners.add(fn);
  fn({ url: currentUrl, playing: !!audio && !audio.paused });
  return () => { listeners.delete(fn); };
}

export function currentSoundUrl(): string | null {
  return currentUrl;
}