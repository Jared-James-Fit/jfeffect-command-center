/**
 * Program Intelligence's first section: the coach tells Cleo what they want,
 * typed or spoken. The words are the next program's direction (the setup's
 * coach notes: the strategy follows each one and says how it used it), kept
 * on this device until a run uses them. Send starts the run that uses them
 * (direction-send.ts: the strategy, or a new one when what's waiting was written
 * before these words). A change to the program the athlete is on now goes to
 * Adjust program instead (previewed, applied only when the coach says so).
 */
import { useEffect, useRef } from "react";
import { ArrowUp, Loader2, SlidersHorizontal } from "lucide-react";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { NOTE_IDEAS } from "@/components/program-intel/generator/setup";
import { useCoachVoice, VoiceButton, VoiceStatus } from "@/components/program-ai/coach-voice";
import type { GeneratorIntel } from "@/lib/program-intel/intelligence";
import type { DirectionSend } from "@/lib/program-intel/direction-send";

const draftKey = (clientId: string) => `jf-program-direction:${clientId}`;
export function readDirectionDraft(clientId: string): string {
  try {
    return window.localStorage.getItem(draftKey(clientId)) ?? "";
  } catch {
    return "";
  }
}
export function clearDirectionDraft(clientId: string) {
  try {
    window.localStorage.removeItem(draftKey(clientId));
  } catch {
    // nothing kept
  }
}

export function CoachDirectionCard({ intel, clientId, value, onChange, onAdjustCurrent, send, sending, onSend }: {
  intel: GeneratorIntel;
  clientId: string;
  value: string;
  onChange: (v: string) => void;
  /** The program they're on now: change it with Adjust program. */
  onAdjustCurrent?: (text: string) => void;
  /** What Send does right now (direction-send.ts); null with an empty box. */
  send?: DirectionSend | null;
  sending?: boolean;
  onSend?: () => void;
}) {
  const cleo = useCleoAccess();
  const valueRef = useRef(value);
  valueRef.current = value;
  const voice = useCoachVoice((words) => {
    const t = valueRef.current.trim();
    onChange((t ? `${t}\n${words}` : words).slice(0, 2000));
  }, "program_notes");
  // what's typed stays on this phone until the program is generated
  useEffect(() => {
    try {
      if (value.trim()) window.localStorage.setItem(draftKey(clientId), value);
      else window.localStorage.removeItem(draftKey(clientId));
    } catch {
      // a private window: the box still works
    }
  }, [value, clientId]);
  const add = (idea: string) => {
    const t = value.trim();
    if (t.toLowerCase().includes(idea.toLowerCase())) return;
    onChange(t ? `${t}\n${idea}` : idea);
  };
  const canSend = !!send?.action && !!onSend && !sending && !voice.recording;
  const submit = () => {
    if (canSend) onSend!();
  };
  const setupSaid = intel.ctx.goals.notes;
  const ideas = NOTE_IDEAS.filter((idea) => !value.toLowerCase().includes(idea.toLowerCase())).slice(0, 6);
  return (
    <Card className="space-y-3 p-4" data-testid="gen-notes" data-workflow-section="direction">
      <div className="flex items-start gap-3">
        {cleo ? <CleoAvatar size="sm" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{cleo ? "Tell Cleo what you want" : "Your instructions"}</h2>
          <p className="text-[13px] text-muted-foreground">
            Goals, observations, what to keep or change. {intel.firstProgram ? "Nothing's logged yet, so these and their setup are what the first program is built from." : "The next program follows each line and says how it used it."}
          </p>
        </div>
      </div>
      {setupSaid && <p className="rounded-lg bg-muted px-3 py-2 text-[13px]"><span className="font-medium">They said at setup:</span> "{setupSaid}"</p>}
      <div className="relative">
        <AutoGrowTextarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 2000))}
          rows={3}
          maxHeight={260}
          placeholder={intel.firstProgram ? "e.g. Upper / lower with a glute day. Nervous about barbells: start on machines and teach the squat with a goblet squat." : "e.g. Bench is the priority. Deadlift once a week, heavy on Thursday. Keep sessions under 60 minutes. Left shoulder is cranky on overhead work."}
          aria-label="Instructions for the next program"
          className="min-h-[96px] w-full resize-none rounded-xl pr-14 text-base leading-relaxed md:text-[15px]"
          onKeyDown={(e) => {
            // ⌘ / Ctrl + Enter sends; Enter alone is a new line (instructions run to several)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          data-direction-input
        />
        <div className="absolute bottom-2 right-2">
          <VoiceButton voice={voice} className="h-10 w-10 rounded-full" />
        </div>
      </div>
      <VoiceStatus voice={voice} />
      {ideas.length > 0 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden" data-direction-ideas>
          {ideas.map((idea) => (
            <button key={idea} type="button" onClick={() => add(idea)} className="min-h-8 shrink-0 whitespace-nowrap rounded-full bg-secondary px-3 text-xs font-medium text-foreground hover:bg-muted">+ {idea}</button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground" data-direction-hint>
          {send?.hint ?? (value.trim() ? "Used when you generate the next program below." : "Optional: the recommended setup works without it.")} <span className="tabular-nums">{value.length}/2000</span>
        </p>
        {(send?.action || (onAdjustCurrent && value.trim())) && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {onAdjustCurrent && value.trim() && (
              <Button size="sm" variant="ghost" className="h-10 text-muted-foreground sm:mr-auto" onClick={() => onAdjustCurrent(value.trim())} data-direction-adjust-current>
                <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Change the current program instead
              </Button>
            )}
            {send?.action && onSend && (
              <Button className="h-11 w-full sm:w-auto" disabled={!canSend} onClick={submit} data-direction-send={send.action}>
                {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowUp className="mr-1.5 h-4 w-4" />} {send.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
