import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, IdCard } from "lucide-react";
import { toast } from "sonner";
import { BasicInfoForm, type BasicInfoValues } from "@/components/basic-info-form";
import { isBasicInfoComplete, REQUIRED_BASIC_INFO_FIELDS } from "@/lib/basic-info";

/**
 * Blocks the client portal until required Basic Information fields are filled.
 * Admin impersonating a client bypasses this gate.
 */
export function ClientBasicInfoGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const [form, setForm] = useState<BasicInfoValues | null>(null);
  const [saving, setSaving] = useState(false);

  if (isImpersonating) return <>{children}</>;

  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client-basic-info-gate", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, user_id, full_name, first_name, last_name, preferred_name, email, phone, date_of_birth, height_cm, preferred_height_unit, address, city, province, postal_code, country, timezone, emergency_contact_name, emergency_contact_phone, basic_info_completed_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!client) return;
    const [first, ...rest] = (client.full_name ?? "").split(" ");
    setForm({
      first_name: client.first_name ?? first ?? "",
      last_name: client.last_name ?? rest.join(" ") ?? "",
      preferred_name: client.preferred_name ?? "",
      phone: client.phone ?? "",
      date_of_birth: client.date_of_birth ?? "",
      height_cm: client.height_cm ?? null,
      preferred_height_unit: (client.preferred_height_unit as "imperial" | "metric") ?? "imperial",
      address: client.address ?? "",
      city: client.city ?? "",
      province: client.province ?? "",
      postal_code: client.postal_code ?? "",
      country: client.country ?? "",
      timezone: client.timezone ?? "America/Winnipeg",
      emergency_contact_name: client.emergency_contact_name ?? "",
      emergency_contact_phone: client.emergency_contact_phone ?? "",
    });
  }, [client]);

  // Admin/coach viewing portal w/o client record, or still loading
  if (!user || isLoading || !client) return <>{children}</>;
  if (isBasicInfoComplete(client)) return <>{children}</>;
  if (!form) return <>{children}</>;

  const missing = REQUIRED_BASIC_INFO_FIELDS.filter(
    (f) => !((form as any)[f] !== null && (form as any)[f] !== undefined && String((form as any)[f]).trim() !== ""),
  );

  const save = async () => {
    if (missing.length) {
      toast.error("Please complete all required fields.");
      return;
    }
    setSaving(true);
    const patch: any = {
      first_name: form.first_name?.trim() || null,
      last_name: form.last_name?.trim() || null,
      full_name: [form.first_name, form.last_name].filter(Boolean).join(" ").trim() || client.full_name,
      preferred_name: form.preferred_name?.trim() || null,
      phone: form.phone || null,
      date_of_birth: form.date_of_birth || null,
      height_cm: form.height_cm,
      preferred_height_unit: form.preferred_height_unit ?? "imperial",
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      postal_code: form.postal_code || null,
      country: form.country || null,
      timezone: form.timezone || "America/Winnipeg",
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      basic_info_completed_at: new Date().toISOString(),
      info_last_updated_at: new Date().toISOString(),
      info_last_updated_by: "client",
      timezone_confirmed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("clients").update(patch).eq("id", client.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome aboard — your profile is set up.");
    qc.invalidateQueries({ queryKey: ["my-client-basic-info-gate"] });
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
  };

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4 md:p-6">
      <Card className="w-full max-w-2xl border-border bg-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
            <IdCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">Let's set up your profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Just a few quick details so Coach Jared can build your plan properly. Takes about a minute.
            </p>
          </div>
        </div>

        <BasicInfoForm
          values={form}
          onChange={(p) => setForm({ ...form, ...p })}
          emailReadOnly={client.email ?? user.email ?? ""}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {missing.length === 0
              ? "All required fields complete."
              : `${missing.length} required field${missing.length === 1 ? "" : "s"} remaining.`}
          </p>
          <Button
            size="lg"
            disabled={saving || missing.length > 0}
            onClick={save}
            className="bg-gradient-primary uppercase font-bold"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Finish setup"}
          </Button>
        </div>
      </Card>
    </div>
  );
}