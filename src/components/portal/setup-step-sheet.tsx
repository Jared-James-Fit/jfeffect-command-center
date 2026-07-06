import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BasicInfoForm } from "@/components/basic-info-form";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { SOCIAL_FIELDS } from "@/lib/social-handles";
import { isBasicInfoComplete } from "@/lib/basic-info";

export type SetupStepKey = "profile_picture" | "basic_info" | "training_schedule";

type Props = {
  step: SetupStepKey | null;
  clientId: string;
  userId: string;
  client: any;
  onOpenChange: (open: boolean) => void;
};

/**
 * Bottom sheet that renders one setup step inline, so clients can finish
 * their onboarding without ever leaving the Home screen. Replaces the old
 * behaviour where every checklist row deep-linked to /portal/account.
 */
export function SetupStepSheet({ step, clientId, userId, client, onOpenChange }: Props) {
  const open = step !== null;
  const title =
    step === "profile_picture"
      ? "Add a profile photo"
      : step === "basic_info"
        ? "Confirm your basic info"
        : step === "training_schedule"
          ? "Set your training schedule"
          : "";
  const description =
    step === "profile_picture"
      ? "A clear headshot helps your coach personalise your feedback."
      : step === "basic_info"
        ? "Fill in the required fields — we save automatically as you type."
        : step === "training_schedule"
          ? "Pick how many days you'll train and which days work best."
          : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-2xl p-0"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pt-5 pb-3 backdrop-blur">
          <SheetHeader className="text-left">
            <SheetTitle className="text-lg font-black">{title}</SheetTitle>
            <SheetDescription className="text-xs">{description}</SheetDescription>
          </SheetHeader>
        </div>
        <div className="px-4 pb-8 pt-4">
          {step === "profile_picture" && (
            <ProfilePictureStep
              userId={userId}
              clientId={clientId}
              currentUrl={client?.profile_picture_url ?? null}
              onDone={() => onOpenChange(false)}
            />
          )}
          {step === "basic_info" && (
            <BasicInfoStep client={client} clientId={clientId} onDone={() => onOpenChange(false)} />
          )}
          {step === "training_schedule" && (
            <TrainingScheduleStep client={client} onDone={() => onOpenChange(false)} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfilePictureStep({
  userId,
  clientId,
  currentUrl,
  onDone,
}: {
  userId: string;
  clientId: string;
  currentUrl: string | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const handleUploaded = async (path: string) => {
    setSaving(true);
    const { error } = await supabase
      .from("clients")
      .update({
        profile_picture_url: path,
        profile_picture_updated_at: new Date().toISOString(),
        profile_picture_updated_by: "client",
        profile_picture_source: "camera",
        profile_picture_needs_update: false,
        profile_picture_needs_update_at: null,
        profile_picture_needs_update_reason: null,
      })
      .eq("id", clientId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["setup-banner-client", userId] });
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    toast.success("Profile photo saved");
    onDone();
  };
  return (
    <div className="space-y-4">
      <ProfilePictureCapture
        mode="client"
        userId={userId}
        currentUrl={currentUrl}
        onUploaded={handleUploaded}
      />
      <Button variant="outline" className="w-full" onClick={onDone} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Done
      </Button>
    </div>
  );
}

const BASIC_FIELDS = [
  "first_name", "last_name", "preferred_name", "phone", "address", "city",
  "province", "postal_code", "country", "timezone", "date_of_birth",
  "height_cm", "preferred_height_unit", "emergency_contact_name",
  "emergency_contact_phone",
  "intake_lifts_known", "intake_lift_unit",
  "intake_squat_1rm", "intake_bench_1rm", "intake_deadlift_1rm",
  "intake_squat_5rm", "intake_bench_5rm", "intake_deadlift_5rm",
  "intake_training_experience", "intake_followed_program",
  ...SOCIAL_FIELDS,
] as const;

function BasicInfoStep({ client, clientId, onDone }: { client: any; clientId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(client ?? null);
  const [saving, setSaving] = useState(false);
  // Only hydrate from server data once, so a background refetch or an
  // activity-heartbeat update to the parent's `client` query doesn't wipe
  // what the user is currently typing.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!client) return;
    setForm(client);
    hydratedRef.current = true;
  }, [client]);

  const remaining = useMemo(() => (form ? missingBasicFields(form) : []), [form]);

  const save = async (closeAfter: boolean) => {
    // Defence in depth: fall back to the clientId prop so a save never
    // silently no-ops just because the parent's `client` query hadn't
    // loaded when the user opened the sheet.
    const targetId = form?.id ?? clientId;
    if (!targetId) {
      toast.error("Couldn't identify your account — please close and reopen this step.");
      return;
    }
    setSaving(true);
    const patch: any = {};
    for (const f of BASIC_FIELDS) patch[f] = form?.[f] ?? null;
    // preferred_height_unit has a NOT NULL constraint — default to "imperial" if not set
    if (patch.preferred_height_unit == null) patch.preferred_height_unit = "imperial";
    // intake_lift_unit defaults to "lb" in the UI but is only persisted when the
    // user actively toggles it. If lifts are known and the unit is still null,
    // default to "lb" so completion checks (which require kg|lb) pass.
    if (patch.intake_lifts_known !== false && patch.intake_lift_unit !== "kg" && patch.intake_lift_unit !== "lb") {
      patch.intake_lift_unit = "lb";
    }
    patch.full_name =
      [form?.first_name, form?.last_name].filter(Boolean).join(" ").trim() ||
      form?.full_name ||
      null;
    patch.info_last_updated_at = new Date().toISOString();
    patch.info_last_updated_by = "client";
    patch.info_update_requested = false;
    const { data: updated, error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", targetId)
      .select("id");
    setSaving(false);
    if (error) {
      console.error("[BasicInfoStep] save failed", error);
      toast.error(error.message ?? "Couldn't save your info. Please try again.");
      return;
    }
    if (!updated || updated.length === 0) {
      // Row wasn't updated — almost always an RLS mismatch (session belongs
      // to a different user than the client row). Surface this instead of
      // silently pretending it saved.
      console.error("[BasicInfoStep] save updated 0 rows for id", targetId);
      toast.error("We couldn't save to your account. Please sign out and back in, then try again.");
      return;
    }
    qc.invalidateQueries({ queryKey: ["setup-banner-client"] });
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    toast.success(closeAfter ? "Saved" : "Progress saved");
    if (closeAfter) onDone();
  };

  if (!form) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      {remaining.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <div className="font-bold text-amber-700 dark:text-amber-300">
            Still needed ({remaining.length})
          </div>
          <div className="mt-1 text-amber-700/80 dark:text-amber-300/80">
            {remaining.join(" · ")}
          </div>
        </div>
      )}
      <BasicInfoForm
        values={form}
        onChange={(p) => setForm({ ...form, ...p })}
      />
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button variant="outline" className="flex-1" onClick={() => onDone()} disabled={saving}>
          Close
        </Button>
        <Button className="flex-1" onClick={() => save(true)} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Finish
        </Button>
      </div>
    </div>
  );
}

function missingBasicFields(c: any): string[] {
  const m: string[] = [];
  const filled = (v: any) => v !== null && v !== undefined && String(v).trim() !== "";
  const pos = (v: any) => Number(v) > 0;
  if (!filled(c.first_name)) m.push("First name");
  if (!filled(c.last_name)) m.push("Last name");
  if (!filled(c.phone)) m.push("Phone");
  if (!filled(c.date_of_birth)) m.push("DOB");
  if (!filled(c.height_cm)) m.push("Height");
  if (!filled(c.address)) m.push("Address");
  if (!filled(c.city)) m.push("City");
  if (!filled(c.country)) m.push("Country");
  if (!filled(c.emergency_contact_name)) m.push("Emergency contact");
  if (!filled(c.emergency_contact_phone)) m.push("Emergency phone");
  if (c.intake_lifts_known === false) {
    if (!pos(c.intake_squat_5rm)) m.push("Squat × 5");
    if (!pos(c.intake_bench_5rm)) m.push("Bench × 5");
    if (!pos(c.intake_deadlift_5rm)) m.push("Deadlift × 5");
  } else {
    if (c.intake_lift_unit !== "kg" && c.intake_lift_unit !== "lb") m.push("Lift units");
    if (!pos(c.intake_squat_1rm)) m.push("Squat 1RM");
    if (!pos(c.intake_bench_1rm)) m.push("Bench 1RM");
    if (!pos(c.intake_deadlift_1rm)) m.push("Deadlift 1RM");
  }
  return m;
}

function TrainingScheduleStep({ client, onDone }: { client: any; onDone: () => void }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (client?.training_schedule_completed) {
      qc.invalidateQueries({ queryKey: ["setup-banner-client"] });
    }
  }, [client?.training_schedule_completed, qc]);
  return (
    <div className="space-y-4">
      <TrainingScheduleCard client={client} editable defaultEditing />
      <Button variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

// re-export for callers that want to compute completion locally
export { isBasicInfoComplete };