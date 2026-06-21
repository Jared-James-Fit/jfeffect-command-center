import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { TARGET_STATUSES, estimateCalorieRange, formatCalorieTarget } from "@/lib/nutrition-cardio";
import { Calculator, X, ChevronDown, ChevronUp } from "lucide-react";
import { todayLocalISO } from "@/lib/today";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string;
  clients?: Array<{ id: string; full_name: string }>;
  initial?: any;
  defaultDayType?: string;
};

const DAY_TYPE_OPTIONS = [
  { label: "Training Day", value: "Training Day" },
  { label: "Rest Day", value: "Rest Day" },
  { label: "Any Day", value: "General" },
];

const CARDIO_TYPE_OPTIONS = [
  { label: "Incline Walking", value: "Incline Walking" },
  { label: "Bike", value: "Bike" },
  { label: "Stairs", value: "Stairmaster" },
  { label: "Outdoor Walk", value: "Outdoor Walking" },
  { label: "Custom", value: "Custom" },
];

const GOAL_OPTIONS = ["Fat Loss", "Recovery", "Conditioning", "Steps", "Custom"];

const INTENSITY_OPTIONS = [
  { label: "Zone 2", value: "Zone 2" },
  { label: "Easy", value: "Easy" },
  { label: "Moderate", value: "Moderate" },
  { label: "Hard", value: "Hard" },
  { label: "Custom", value: "Custom" },
];

function TapGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[] | string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const normalized = options.map((o) => (typeof o === "string" ? { label: o, value: o } : o));
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {normalized.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              value === opt.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 text-foreground hover:bg-secondary",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CardioTargetDialog({ open, onOpenChange, clientId, clients = [], initial, defaultDayType }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdminNotes, setShowAdminNotes] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = todayLocalISO();
    setForm(
      initial
        ? { ...initial }
        : {
            client_id: clientId ?? "",
            goal: "",
            cardio_type: "Incline Walking",
            custom_type: "",
            day_type: defaultDayType ?? "General",
            custom_day_type: "",
            enabled: true,
            frequency_per_week: 3,
            duration_minutes: 30,
            intensity: "Zone 2",
            heart_rate_zone: "",
            step_target: null,
            machine_preference: "",
            start_date: today,
            end_date: "",
            status: "Active",
            ending_soon_days: 7,
            client_notes: "",
            admin_notes: "",
            visible_to_client: true,
            calorie_target_min: null,
            calorie_target_max: null,
            show_calories_to_client: true,
          },
    );
    setShowAdvanced(false);
    setShowAdminNotes(!!initial?.admin_notes);
  }, [open, initial, clientId, defaultDayType]);

  if (!form) return null;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const save = async () => {
    if (!form.client_id) return toast.error("Pick a client first");
    setSaving(true);
    const payload: any = {
      client_id: form.client_id,
      goal: form.goal || null,
      cardio_type: form.cardio_type,
      custom_type: form.cardio_type === "Custom" ? form.custom_type : null,
      day_type: form.day_type ?? "General",
      custom_day_type: form.day_type === "Custom" ? (form.custom_day_type || null) : null,
      enabled: form.enabled !== false,
      frequency_per_week: form.frequency_per_week ? Number(form.frequency_per_week) : null,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      intensity: form.intensity || null,
      heart_rate_zone: form.heart_rate_zone || null,
      step_target: form.step_target ? Number(form.step_target) : null,
      machine_preference: form.machine_preference || null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      ending_soon_days: Number(form.ending_soon_days) || 7,
      client_notes: form.client_notes,
      admin_notes: form.admin_notes,
      visible_to_client: form.visible_to_client,
      calorie_target_min: form.calorie_target_min ? Number(form.calorie_target_min) : null,
      calorie_target_max: form.calorie_target_max ? Number(form.calorie_target_max) : null,
      show_calories_to_client: form.show_calories_to_client !== false,
      last_updated_at: new Date().toISOString(),
    };
    const { error } = form.id
      ? await supabase.from("cardio_targets").update(payload).eq("id", form.id)
      : await supabase.from("cardio_targets").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Updated" : "Created");
    qc.invalidateQueries({ queryKey: ["cardio-targets"] });
    qc.invalidateQueries({ queryKey: ["cardio-targets", form.client_id] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit Cardio Target" : "Create Cardio Target"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Client selector */}
          {!clientId && (
            <div className="md:col-span-2">
              <Label>Client</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Essential fields */}
          <div className="md:col-span-2">
            <TapGroup
              label="Day type"
              options={DAY_TYPE_OPTIONS}
              value={form.day_type ?? "General"}
              onChange={(v) => set("day_type", v)}
            />
          </div>
          <div className="md:col-span-2">
            <TapGroup
              label="Cardio type"
              options={CARDIO_TYPE_OPTIONS}
              value={form.cardio_type}
              onChange={(v) => set("cardio_type", v)}
            />
            {form.cardio_type === "Custom" && (
              <div className="mt-2">
                <Input
                  value={form.custom_type ?? ""}
                  onChange={(e) => set("custom_type", e.target.value)}
                  placeholder="Enter custom cardio type"
                />
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <TapGroup label="Goal" options={GOAL_OPTIONS} value={form.goal ?? ""} onChange={(v) => set("goal", v)} />
          </div>
          <div>
            <Label>Frequency / week</Label>
            <Input
              type="number"
              min={1}
              max={7}
              value={form.frequency_per_week ?? ""}
              onChange={(e) => set("frequency_per_week", e.target.value)}
            />
          </div>
          <div>
            <Label>Duration / session (min)</Label>
            <Input
              type="number"
              value={form.duration_minutes ?? ""}
              onChange={(e) => set("duration_minutes", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <TapGroup
              label="Intensity"
              options={INTENSITY_OPTIONS}
              value={form.intensity ?? ""}
              onChange={(v) => set("intensity", v)}
            />
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Visible to client</Label>
            <Switch checked={form.visible_to_client} onCheckedChange={(v) => set("visible_to_client", v)} />
          </div>
          <div className="md:col-span-2">
            <Label>Coach notes (visible to client)</Label>
            <Textarea
              rows={2}
              value={form.client_notes ?? ""}
              onChange={(e) => set("client_notes", e.target.value)}
              placeholder="Optional notes the client will see"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => setShowAdminNotes((s) => !s)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showAdminNotes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Private admin notes
            </button>
            {showAdminNotes && (
              <Textarea
                className="mt-2"
                rows={2}
                value={form.admin_notes ?? ""}
                onChange={(e) => set("admin_notes", e.target.value)}
                placeholder="Optional internal notes"
              />
            )}
          </div>

          {/* Advanced options toggle */}
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Show advanced options
            </button>
          </div>

          {/* Advanced fields */}
          {showAdvanced && (
            <>
              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
                <Label className="text-xs">Enabled</Label>
                <Switch checked={form.enabled !== false} onCheckedChange={(v) => set("enabled", v)} />
              </div>
              {form.day_type === "Custom" && (
                <div className="md:col-span-2">
                  <Label>Custom day type</Label>
                  <Input
                    value={form.custom_day_type ?? ""}
                    onChange={(e) => set("custom_day_type", e.target.value)}
                    placeholder="e.g. Refeed Day"
                  />
                </div>
              )}
              <div>
                <Label>Machine preference</Label>
                <Input value={form.machine_preference ?? ""} onChange={(e) => set("machine_preference", e.target.value)} />
              </div>
              <div>
                <Label>Heart rate zone</Label>
                <Input value={form.heart_rate_zone ?? ""} onChange={(e) => set("heart_rate_zone", e.target.value)} />
              </div>
              <div>
                <Label>Step target</Label>
                <Input type="number" value={form.step_target ?? ""} onChange={(e) => set("step_target", e.target.value)} />
              </div>
              <div>
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </div>
              <div>
                <Label>End date</Label>
                <Input type="date" value={form.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} />
              </div>
              <div>
                <Label>Calories min</Label>
                <Input type="number" value={form.calorie_target_min ?? ""} onChange={(e) => set("calorie_target_min", e.target.value)} />
              </div>
              <div>
                <Label>Calories max</Label>
                <Input type="number" value={form.calorie_target_max ?? ""} onChange={(e) => set("calorie_target_max", e.target.value)} />
              </div>
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border bg-secondary/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {formatCalorieTarget(
                    form.calorie_target_min ? Number(form.calorie_target_min) : null,
                    form.calorie_target_max ? Number(form.calorie_target_max) : null,
                  ) ?? "Optional calorie target"}
                </span>
                <div className="flex gap-1">
                  <ActionButton
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const est = estimateCalorieRange(Number(form.duration_minutes), form.intensity);
                      if (!est) return toast.error("Add duration + intensity first");
                      setForm({ ...form, calorie_target_min: est.min, calorie_target_max: est.max, show_calories_to_client: true });
                    }}
                  >
                    <Calculator className="mr-1 h-4 w-4" /> Estimate
                  </ActionButton>
                  {(form.calorie_target_min || form.calorie_target_max) && (
                    <ActionButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setForm({ ...form, calorie_target_min: null, calorie_target_max: null, show_calories_to_client: false })}
                    >
                      <X className="h-4 w-4" />
                    </ActionButton>
                  )}
                </div>
              </div>
              <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
                <Label className="text-xs">Show calorie target to client</Label>
                <Switch checked={form.show_calories_to_client !== false} onCheckedChange={(v) => set("show_calories_to_client", v)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ending soon (days)</Label>
                <Input type="number" value={form.ending_soon_days} onChange={(e) => set("ending_soon_days", e.target.value)} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </ActionButton>
          <ActionButton onClick={save} jobLabel="Saving cardio target" className="bg-gradient-primary font-bold uppercase">
            Save
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}