import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, RotateCcw, Save } from "lucide-react";
import { DEFAULT_FORMAT_PROMPT } from "@/lib/events";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/events/format-guide")({
  component: FormatGuidePage,
});

function FormatGuidePage() {
  const [prompt, setPrompt] = useState(DEFAULT_FORMAT_PROMPT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await (supabase.from("event_format_prompts") as any)
        .select("prompt").eq("user_id", u.user.id).maybeSingle();
      if (data?.prompt) setPrompt(data.prompt);
      setLoading(false);
    })();
  }, []);

  async function save() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await (supabase.from("event_format_prompts") as any)
      .upsert({ user_id: u.user.id, prompt }, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Prompt saved");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Event Formatting Guide"
        subtitle="Paste this prompt into ChatGPT along with a screenshot or event details. ChatGPT returns clean text you can paste into Paste & Parse."
        backTo="/admin/events"
        backLabel="Events"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(prompt).then(() => toast.success("Copied"))}>
              <Copy className="mr-1 h-4 w-4" />Copy
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPrompt(DEFAULT_FORMAT_PROMPT)}>
              <RotateCcw className="mr-1 h-4 w-4" />Reset
            </Button>
            <Button size="sm" onClick={save}><Save className="mr-1 h-4 w-4" />Save</Button>
          </div>
        }
      />
      <Card className="p-3">
        <Textarea
          rows={28}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="font-mono text-xs"
          disabled={loading}
        />
      </Card>
    </div>
  );
}
