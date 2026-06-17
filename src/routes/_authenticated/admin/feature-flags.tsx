import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Flag, Save } from "lucide-react";
import { parseFlag } from "@/hooks/use-unified-workouts-flag";

export const Route = createFileRoute("/_authenticated/admin/feature-flags")({
  head: () => ({ meta: [{ title: "Feature Flags" }] }),
  component: FeatureFlagsPage,
});

function FeatureFlagsPage() {
  return (
    <div className="space-y-5 px-3 sm:px-6 py-4 max-w-3xl mx-auto">
      <PageHeader
        title="Feature Flags"
        subtitle="Phased rollout switches. Toggle a feature on for the whole app or just a pilot list of users."
      />
      <UnifiedWorkoutsFlagCard />
    </div>
  );
}

function UnifiedWorkoutsFlagCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "unified_workouts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "unified_workouts")
        .maybeSingle();
      return parseFlag(data?.value);
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [pilotText, setPilotText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setPilotText(data.pilot_user_ids.join("\n"));
  }, [data]);

  const onSave = async () => {
    setSaving(true);
    try {
      const pilot_user_ids = pilotText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const value = JSON.stringify({ enabled, pilot_user_ids });
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "unified_workouts", value }, { onConflict: "key" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["app-settings", "unified_workouts"] });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Flag className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold">Unified workout experience</h3>
            <Badge variant="outline">Phase 1</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            When on, membership users see the same workout pages coaching clients use
            today (shared components, separate data). Leave off and add specific user IDs
            to the pilot list to test on a small group first. Existing logs are never
            modified — the switch only changes which UI loads.
          </p>

          {isLoading ? (
            <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="flex items-center justify-between rounded-lg border bg-card/40 p-3">
                <div>
                  <Label htmlFor="uw-enabled" className="text-sm font-semibold">
                    Enabled for all members
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    Turn this on after the pilot looks clean.
                  </div>
                </div>
                <Switch id="uw-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="uw-pilot" className="text-sm font-semibold">
                  Pilot user IDs
                </Label>
                <div className="text-xs text-muted-foreground">
                  Auth user IDs (one per line, or comma-separated). These users see the
                  unified UI even when the global switch is off.
                </div>
                <Textarea
                  id="uw-pilot"
                  rows={5}
                  value={pilotText}
                  onChange={(e) => setPilotText(e.target.value)}
                  placeholder="3a548c6a-…&#10;b1f02d9e-…"
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={onSave} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}