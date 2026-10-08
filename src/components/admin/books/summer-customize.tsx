import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { saveSummerSettings } from "@/lib/business-books.functions";
import {
  DEFAULT_SUMMER_TONE, SUMMER_INSTRUCTION_IDEAS, SUMMER_INSTRUCTIONS_MAX, SUMMER_TONES, summerTone, type SummerTone,
} from "@/lib/summer-persona";

export type SummerPersona = { tone?: string | null; instructions?: string | null };

/** Customize Summer: pick her vibe and write your own instructions. */
export function SummerCustomizeDialog({
  open,
  onClose,
  persona,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  persona: SummerPersona;
  onSaved: () => void;
}) {
  const save = useServerFn(saveSummerSettings);
  const [tone, setTone] = useState<SummerTone>(summerTone(persona.tone).value);
  const [instructions, setInstructions] = useState(persona.instructions ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTone(summerTone(persona.tone).value);
    setInstructions(persona.instructions ?? "");
  }, [open, persona.tone, persona.instructions]);

  const addIdea = (idea: string) => {
    setInstructions((cur) => {
      if (cur.includes(idea)) return cur;
      const next = cur.trim() ? `${cur.trim()}\n${idea}` : idea;
      return next.slice(0, SUMMER_INSTRUCTIONS_MAX);
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { tone, instructions: instructions.trim() || null } });
      toast.success("Summer's updated ✨ Ask her something to hear the new vibe.");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize Summer</DialogTitle>
          <DialogDescription>
            Change how she talks any time. She always uses your real numbers, whatever the vibe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Her vibe</Label>
          <div className="grid gap-2" role="radiogroup" aria-label="Summer's vibe">
            {SUMMER_TONES.map((t) => {
              const active = t.value === tone;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTone(t.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                  )}
                >
                  <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.label}{t.value === DEFAULT_SUMMER_TONE ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">default</span> : null}</span>
                    <span className="block text-xs text-muted-foreground">{t.description}</span>
                    {active && <span className="mt-1.5 block text-xs italic text-muted-foreground">"{t.greeting}"</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="summer-instructions">Your instructions for her</Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">{instructions.length}/{SUMMER_INSTRUCTIONS_MAX}</span>
          </div>
          <Textarea
            id="summer-instructions"
            rows={5}
            maxLength={SUMMER_INSTRUCTIONS_MAX}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Anything about how she should talk to you, what to focus on, or how long her answers should be."
          />
          <div className="flex flex-wrap gap-1.5">
            {SUMMER_INSTRUCTION_IDEAS.filter((i) => !instructions.includes(i)).map((idea) => (
              <button key={idea} type="button" onClick={() => addIdea(idea)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="h-3 w-3" /> {idea}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => { setTone(DEFAULT_SUMMER_TONE); setInstructions(""); }}
          >
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
