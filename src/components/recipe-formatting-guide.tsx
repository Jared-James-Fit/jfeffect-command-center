import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Save, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_RECIPE_PROMPT } from "@/lib/recipe-format";
import { getFormatPrompt, saveFormatPrompt } from "@/lib/recipes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

export function RecipeFormattingGuide() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(DEFAULT_RECIPE_PROMPT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFormatPrompt()
      .then((v) => {
        if (v) setValue(v);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Prompt copied — paste into ChatGPT");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function onSave() {
    try {
      setSaving(true);
      await saveFormatPrompt(value);
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-bold">Recipe Formatting Guide</div>
                <div className="text-xs text-muted-foreground">
                  Copy this prompt into ChatGPT, then paste the result into Recipe Body.
                </div>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={18}
            className="font-mono text-xs"
            disabled={!loaded}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCopy}>
              <Copy className="mr-1 h-4 w-4" /> Copy
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving} className="bg-gradient-primary font-bold">
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}