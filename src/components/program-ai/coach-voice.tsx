/**
 * Speak instead of typing (coaches): tap the mic, say it, tap again; the words
 * land in the box to read and change before anything is sent. Recorded with
 * the app's one recorder (useVoiceDictation: the live waveform, two minutes at
 * most, the screen kept awake), turned into words by transcribeCoachVoiceFn
 * (OpenAI). A take that couldn't be turned into words is kept in memory with
 * Try again, never lost and never stored. Where a phone can't record (no mic,
 * a browser without MediaRecorder) the mic simply isn't shown: typing always
 * works.
 */
import { useServerFn } from "@tanstack/react-start";
import { transcribeCoachVoiceFn } from "@/lib/program-ai/voice.functions";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { VoiceMicButton, VoiceStatusLine } from "@/components/voice/voice-recorder";

export function useCoachVoice(onText: (text: string) => void, feature: "program_edit" | "program_notes" | "client_context" = "program_edit") {
  const hearFn = useServerFn(transcribeCoachVoiceFn);
  const voice = useVoiceDictation({
    maxMs: 120_000,
    onText,
    transcribe: async (audio, mime) => {
      const r = await hearFn({ data: { audio, mime, feature } });
      return r.ok ? { ok: true, text: r.text } : { ok: false, reason: r.reason };
    },
  });
  return {
    ...voice,
    /** Listening (or the mic opening): sending what's in the box waits. */
    recording: voice.state === "recording" || voice.state === "requesting",
    hearing: voice.state === "processing" || voice.state === "transcribing",
  };
}

export type CoachVoice = ReturnType<typeof useCoachVoice>;

export function VoiceButton({ voice, className, disabled }: { voice: CoachVoice; className?: string; disabled?: boolean }) {
  if (!voice.supported) return null;
  return <VoiceMicButton state={voice.state} onClick={voice.toggle} disabled={disabled} className={className} />;
}

/** One line under the box: the live waveform and time, turning it into words, added, or why it didn't work. */
export function VoiceStatus({ voice, className }: { voice: CoachVoice; className?: string }) {
  return <VoiceStatusLine voice={voice} className={className} />;
}
