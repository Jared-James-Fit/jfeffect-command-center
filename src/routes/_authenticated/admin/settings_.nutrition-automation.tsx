import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getNutritionAutomationSettingsFn, updateNutritionAutomationSettingsFn } from "@/lib/nutrition-updates.functions";

export const Route = createFileRoute("/_authenticated/admin/settings_/nutrition-automation")({
  component: NutritionAutomation,
});

function NutritionAutomation() {
  const qc = useQueryClient();
  const get = useServerFn(getNutritionAutomationSettingsFn);
  const update = useServerFn(updateNutritionAutomationSettingsFn);

  const { data, isLoading } = useQuery({ queryKey: ["nas"], queryFn: () => get() });
  const [state, setState] = useState<any>(null);
  useEffect(() => { if (data && !state) setState(data); }, [data, state]);

  const m = useMutation({
    mutationFn: (v: any) => update({ data: v }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["nas"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (isLoading || !state) {
    return <div className="p-6"><PageHeader title="Nutrition Automation" /></div>;
  }

  const set = (k: string, v: any) => setState((s: any) => ({ ...s, [k]: v }));

  return (
    <>
      <PageHeader title="Nutrition Automation" subtitle="Cadence defaults, reminder timing, and notification channels."
        actions={<Button size="sm" variant="outline" asChild><Link to="/admin/nutrition-dashboard"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link></Button>}
      />
      <div className="p-4 md:p-6 max-w-2xl space-y-4 pb-24">
        <Card className="p-4 space-y-3">
          <h3 className="font-bold">Cadence</h3>
          <div>
            <Label>Default cadence</Label>
            <Select value={state.default_cadence} onValueChange={(v) => set("default_cadence", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="custom">Custom interval</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state.default_cadence === "custom" ? (
            <div>
              <Label>Interval (days)</Label>
              <Input type="number" min={1} max={365} value={state.cadence_interval_days ?? 7} onChange={(e) => set("cadence_interval_days", Number(e.target.value))} />
            </div>
          ) : null}
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="font-bold">Reminder timing</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lead time (days before due)</Label>
              <Input type="number" min={0} max={30} value={state.reminder_lead_days} onChange={(e) => set("reminder_lead_days", Number(e.target.value))} />
            </div>
            <div>
              <Label>Overdue reminder every (days)</Label>
              <Input type="number" min={0} max={30} value={state.overdue_reminder_days} onChange={(e) => set("overdue_reminder_days", Number(e.target.value))} />
            </div>
            <div className="col-span-2">
              <Label>Coach review SLA (hours)</Label>
              <Input type="number" min={1} max={168} value={state.coach_review_sla_hours} onChange={(e) => set("coach_review_sla_hours", Number(e.target.value))} />
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="font-bold">Notifications</h3>
          <Toggle label="Client reminders" v={state.client_reminders_enabled} on={(v) => set("client_reminders_enabled", v)} />
          <Toggle label="Coach reminders" v={state.coach_reminders_enabled} on={(v) => set("coach_reminders_enabled", v)} />
          <div className="h-px bg-border my-2" />
          <Toggle label="In-app push" v={state.push_enabled} on={(v) => set("push_enabled", v)} />
          <Toggle label="Email" v={state.email_enabled} on={(v) => set("email_enabled", v)} />
          <Toggle label="SMS" v={state.sms_enabled} on={(v) => set("sms_enabled", v)} />
        </Card>

        <Button className="w-full font-bold" onClick={() => m.mutate({
          default_cadence: state.default_cadence,
          cadence_interval_days: state.cadence_interval_days,
          reminder_lead_days: state.reminder_lead_days,
          overdue_reminder_days: state.overdue_reminder_days,
          coach_review_sla_hours: state.coach_review_sla_hours,
          client_reminders_enabled: state.client_reminders_enabled,
          coach_reminders_enabled: state.coach_reminders_enabled,
          sms_enabled: state.sms_enabled,
          email_enabled: state.email_enabled,
          push_enabled: state.push_enabled,
        })}>{m.isPending ? "Saving…" : "Save settings"}</Button>
      </div>
    </>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}