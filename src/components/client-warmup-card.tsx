import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flame } from "lucide-react";
import { toast } from "sonner";
import { WarmupPicker, WARMUP_PRIORITY_NOTE, type WarmupMode } from "@/components/warmup-picker";

const sb = supabase as any;

export function ClientWarmupCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data: client } = useQuery({
    queryKey: ["client-warmup", clientId],
    queryFn: async () =>
      (await sb.from("clients").select("warmup_protocol_id").eq("id", clientId).maybeSingle()).data,
  });

  const [mode, setMode] = useState<WarmupMode>("default");
  const [protocolId, setProtocolId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) return;
    if (client.warmup_protocol_id) {
      setMode("custom");
      setProtocolId(client.warmup_protocol_id);
    } else {
      setMode("default");
      setProtocolId(null);
    }
  }, [client?.warmup_protocol_id]);

  const save = async () => {
    setSaving(true);
    // Currently we only persist a client-level custom override via warmup_protocol_id.
    // "default" clears it. Forced general/powerlifting/none at client level isn't a single column today
    // — those are best set at block or day level.
    const patch: any = { warmup_protocol_id: mode === "custom" ? protocolId : null };
    const { error } = await sb.from("clients").update(patch).eq("id", clientId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Warm-up saved");
      qc.invalidateQueries({ queryKey: ["client-warmup", clientId] });
    }
  };

  return (
    <Card className="border-border bg-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <h3 className="font-bold">Warm-Up Protocol</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Client-level warm-up overrides block, day, and exercise defaults for this client.
      </p>
      <WarmupPicker
        mode={mode}
        protocolId={protocolId}
        onChange={({ mode: m, protocolId: pid }) => {
          setMode(m);
          setProtocolId(pid);
        }}
      />
      <p className="text-[11px] text-muted-foreground">{WARMUP_PRIORITY_NOTE}</p>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving || (mode === "custom" && !protocolId)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}