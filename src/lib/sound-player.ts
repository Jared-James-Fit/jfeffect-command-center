// Global single-instance audio player so only one sound plays at a time.
// Never autoplays — playSound() must be called from a user gesture.

type Listener = (state: { url: string | null; playing: boolean }) => void;

let audio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
const listeners = new Set<Listener>();

function ensureAudio() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      currentUrl = null;
      emit();
    });
    audio.addEventListener("pause", () => emit());
    audio.addEventListener("play", () => emit());
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
  try {
    await el.play();
  } catch {
    currentUrl = null;
    emit();
  }
}

export function stopSound() {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  currentUrl = null;
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