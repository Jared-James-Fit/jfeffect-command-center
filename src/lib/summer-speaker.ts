/**
 * Cleo's voice in the browser. Plays the server voice (calm, natural
 * English) when a provider is available, otherwise the device's best voice. Browser
 * only; every storage and speech call is guarded.
 *
 * Autoplay: phones only allow audio that starts from a tap. unlock() runs on
 * the tap that starts a voice turn and primes both the audio element and
 * speech synthesis, so the reply can play by itself a few seconds later.
 */
import { speechFromReply } from "@/lib/summer-voice-text";
import { setAudioSessionType } from "@/lib/audio-session";

export type SummerVoicePrefs = {
  /** Speak replies to voice questions automatically. */
  autoplay: boolean;
  /** "summer" = her own voice from the server; otherwise a device voiceURI. */
  voice: string;
  rate: number;
};

export const DEFAULT_VOICE_PREFS: SummerVoicePrefs = { autoplay: true, voice: "summer", rate: 1 };
const PREFS_KEY = "summer.voice.v1";

export function loadVoicePrefs(): SummerVoicePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_VOICE_PREFS;
    const p = JSON.parse(raw);
    return {
      autoplay: typeof p.autoplay === "boolean" ? p.autoplay : DEFAULT_VOICE_PREFS.autoplay,
      voice: typeof p.voice === "string" && p.voice ? p.voice : DEFAULT_VOICE_PREFS.voice,
      rate: typeof p.rate === "number" && p.rate >= 0.7 && p.rate <= 1.4 ? p.rate : 1,
    };
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
}

export function saveVoicePrefs(p: SummerVoicePrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // private mode: prefs just don't stick
  }
}

const FEMALE = /samantha|ava\b|allison|susan|zoe|nicky|karen|moira|tessa|serena|victoria|zira|aria|jenny|michelle|emma|libby|sonia|natasha|female|google us english|google uk english female/i;
/** Neural / downloaded voices: the ones that sound like an assistant, not a robot. */
const NATURAL = /siri|premium|enhanced|natural|neural|online/i;
/** Novelty and legacy voices nobody wants reading their books. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|fred|junior|ralph|kathy)\b/i;

export function hasDeviceSpeech(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function deviceVoices(): SpeechSynthesisVoice[] {
  if (!hasDeviceSpeech()) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const lang = v.lang?.toLowerCase() ?? "";
  let score = lang.startsWith("en-us") ? 0 : lang.startsWith("en") ? 1 : 4;
  if (!NATURAL.test(v.name)) score += 2;
  if (!FEMALE.test(v.name)) score += 1;
  if (NOVELTY.test(v.name)) score += 10;
  return score;
}

/** Device voices for the picker: natural-sounding English feminine voices first. */
export function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => voiceScore(a) - voiceScore(b) || a.name.localeCompare(b.name));
}

/** Fallback when her own voice isn't available: the most natural English voice on the device. */
function fallbackVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return rankVoices(voices)[0];
}

/**
 * Sentences grouped into chunks of up to ~maxChars. Fewer, longer utterances
 * flow like speech; one per sentence leaves an audible gap between each.
 * Kept short enough that Chrome doesn't cut a long utterance off mid-way.
 */
export function speechChunks(text: string, maxChars = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + sentence.length <= maxChars) chunks[last] += ` ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

type ServerVoice = (text: string) => Promise<{ ok: true; audio: string; mime: string } | { ok: false; reason?: string }>;

// 0.1s of silence; playing it on a tap unlocks the element for later replies.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

class SummerSpeaker {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private serverVoiceOff = false;
  private stopCurrent: (() => void) | null = null;
  private listeners = new Set<(speaking: boolean) => void>();
  speaking = false;

  onChange(fn: (speaking: boolean) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(speaking: boolean) {
    this.speaking = speaking;
    this.listeners.forEach((fn) => fn(speaking));
  }

  /** Call from a tap. */
  unlock() {
    try {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.setAttribute("playsinline", "true");
      }
      this.audio.src = SILENT_WAV;
      void this.audio.play().catch(() => {});
    } catch {
      // no audio element support
    }
    if (hasDeviceSpeech()) {
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch {
        // ignore
      }
    }
  }

  /** True once the server said it has no voice this session. */
  get usingDeviceVoice() {
    return this.serverVoiceOff;
  }

  stop() {
    this.stopCurrent?.();
    this.stopCurrent = null;
    try {
      this.audio?.pause();
    } catch {
      // ignore
    }
    if (hasDeviceSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.set(false);
  }

  /** Speak a reply. Resolves when finished or stopped. */
  async speak(reply: string, prefs: SummerVoicePrefs, serverVoice: ServerVoice): Promise<void> {
    this.stop();
    const text = speechFromReply(reply);
    if (!text) return;
    this.set(true);
    // iOS: speak through the loudspeaker like normal media, then go back to
    // whatever the app had (ambient for UI sounds).
    const prevSession = setAudioSessionType("playback");
    try {
      if (prefs.voice === "summer" && !this.serverVoiceOff) {
        const r = await serverVoice(text).catch(() => ({ ok: false as const }));
        if (r.ok) {
          await this.playAudio(r.audio, r.mime, prefs.rate);
          return;
        }
        this.serverVoiceOff = true;
      }
      await this.speakDevice(text, prefs);
    } finally {
      if (prevSession && prevSession !== "playback") setAudioSessionType(prevSession);
      this.set(false);
    }
  }

  private playAudio(b64: string, mime: string, rate: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audio) this.audio = new Audio();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const el = this.audio;
      const done = () => {
        el.onended = null;
        el.onerror = null;
        this.stopCurrent = null;
        resolve();
      };
      this.stopCurrent = done;
      el.onended = done;
      el.onerror = done;
      el.src = this.objectUrl;
      el.playbackRate = rate;
      void el.play().catch(done);
    });
  }

  private speakDevice(text: string, prefs: SummerVoicePrefs): Promise<void> {
    if (!hasDeviceSpeech()) return Promise.resolve();
    const voices = deviceVoices();
    const voice = voices.find((v) => v.voiceURI === prefs.voice) ?? fallbackVoice(voices);
    const parts = speechChunks(text);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        this.stopCurrent = null;
        resolve();
      };
      this.stopCurrent = done;
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        }
        u.rate = prefs.rate;
        u.pitch = 1;
        if (i === parts.length - 1) {
          u.onend = done;
          u.onerror = done;
        }
        window.speechSynthesis.speak(u);
      });
    });
  }
}

let instance: SummerSpeaker | null = null;
export function summerSpeaker(): SummerSpeaker {
  if (!instance) instance = new SummerSpeaker();
  return instance;
}
