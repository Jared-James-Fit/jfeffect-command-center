import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EditableCard, FieldRow } from "./editable-card";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { calcAge, cmToFtIn, ftInToCm, formatHeight } from "@/lib/basic-info";
import { todayLocalISO } from "@/lib/today";
import { useState, useEffect } from "react";

const COUNTRIES = ["Canada", "United States", "United Kingdom", "Australia", "New Zealand", "Other"];

type Patch = Record<string, any>;
type Save = (patch: Patch) => Promise<void>;

function fmtDob(dob: string | null | undefined) {
  if (!dob) return null;
  const age = calcAge(dob);
  return `${dob}${age != null ? ` · age ${age}` : ""}`;
}

export function IdentityCard({ form, onSave }: { form: any; onSave: Save }) {
  const initial = {
    first_name: form.first_name ?? "",
    last_name: form.last_name ?? "",
    preferred_name: form.preferred_name ?? "",
  };
  return (
    <EditableCard
      title="Identity"
      description="Name as it appears across the app."
      initial={initial}
      onSave={async (d) => {
        await onSave({
          first_name: d.first_name || null,
          last_name: d.last_name || null,
          preferred_name: d.preferred_name || null,
          full_name: [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || form.full_name,
        });
      }}
      view={(v) => (
        <div className="divide-y divide-border/60">
          <FieldRow label="First name" value={v.first_name} />
          <FieldRow label="Last name" value={v.last_name} />
          <FieldRow label="Preferred name" value={v.preferred_name} />
        </div>
      )}
      edit={(d, set) => (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>First name</Label>
            <Input className="min-h-[44px]" value={d.first_name} onChange={(e) => set({ ...d, first_name: e.target.value })} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input className="min-h-[44px]" value={d.last_name} onChange={(e) => set({ ...d, last_name: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Preferred name</Label>
            <Input className="min-h-[44px]" value={d.preferred_name} onChange={(e) => set({ ...d, preferred_name: e.target.value })} placeholder="What should we call you?" />
          </div>
        </div>
      )}
    />
  );
}

export function ContactCard({ form, onSave }: { form: any; onSave: Save }) {
  const initial = { email: form.email ?? "", phone: form.phone ?? "" };
  return (
    <EditableCard
      title="Contact Information"
      description="Primary email and phone for this client."
      initial={initial}
      onSave={async (d) => {
        await onSave({ email: d.email || null, phone: d.phone || null });
      }}
      view={(v) => (
        <div className="divide-y divide-border/60">
          <FieldRow label="Email" value={v.email} />
          <FieldRow label="Phone" value={v.phone} />
        </div>
      )}
      edit={(d, set) => (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Email</Label>
            <Input
              className="min-h-[44px]"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={d.email}
              onChange={(e) => set({ ...d, email: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Phone</Label>
            <Input
              className="min-h-[44px]"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={d.phone}
              onChange={(e) => set({ ...d, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
      )}
    />
  );
}

export function PersonalDetailsCard({ form, onSave }: { form: any; onSave: Save }) {
  const initial = {
    date_of_birth: form.date_of_birth ?? "",
    height_cm: form.height_cm ?? null,
    preferred_height_unit: (form.preferred_height_unit ?? "imperial") as "imperial" | "metric",
    timezone: form.timezone ?? "America/Winnipeg",
  };
  return (
    <EditableCard
      title="Personal Details"
      description="Date of birth, height & time zone."
      initial={initial}
      onSave={async (d) => {
        await onSave({
          date_of_birth: d.date_of_birth || null,
          height_cm: d.height_cm ?? null,
          preferred_height_unit: d.preferred_height_unit,
          timezone: d.timezone,
        });
      }}
      view={(v) => (
        <div className="divide-y divide-border/60">
          <FieldRow label="Date of birth" value={fmtDob(v.date_of_birth)} />
          <FieldRow label="Height" value={v.height_cm != null ? formatHeight(v.height_cm, v.preferred_height_unit) : null} />
          <FieldRow label="Time zone" value={v.timezone} />
        </div>
      )}
      edit={(d, set) => <PersonalDetailsEdit draft={d} setDraft={set} />}
    />
  );
}

function PersonalDetailsEdit({
  draft,
  setDraft,
}: {
  draft: { date_of_birth: string; height_cm: number | null; preferred_height_unit: "imperial" | "metric"; timezone: string };
  setDraft: (d: any) => void;
}) {
  const unit = draft.preferred_height_unit;
  const ftIn = cmToFtIn(draft.height_cm ?? null);
  const [ft, setFt] = useState(ftIn ? String(ftIn.ft) : "");
  const [inch, setInch] = useState(ftIn ? String(ftIn.inch) : "");
  const [cm, setCm] = useState(draft.height_cm != null ? String(Math.round(Number(draft.height_cm))) : "");
  useEffect(() => {
    const v = cmToFtIn(draft.height_cm ?? null);
    setFt(v ? String(v.ft) : "");
    setInch(v ? String(v.inch) : "");
    setCm(draft.height_cm != null ? String(Math.round(Number(draft.height_cm))) : "");
  }, [draft.height_cm]);
  const age = calcAge(draft.date_of_birth);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <Label>Date of birth</Label>
        <Input className="min-h-[44px]" type="date" value={draft.date_of_birth} max={todayLocalISO()} onChange={(e) => setDraft({ ...draft, date_of_birth: e.target.value })} />
        <p className="mt-1 text-[11px] text-muted-foreground">Age: {age != null ? age : "—"}</p>
      </div>
      <div>
        <div className="flex items-end justify-between">
          <Label>Height</Label>
          <ToggleGroup
            type="single"
            value={unit}
            onValueChange={(v) => v && setDraft({ ...draft, preferred_height_unit: v as "imperial" | "metric" })}
            size="sm"
            className="border border-border rounded-md"
          >
            <ToggleGroupItem value="imperial" className="text-xs h-7 px-2">ft / in</ToggleGroupItem>
            <ToggleGroupItem value="metric" className="text-xs h-7 px-2">cm</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {unit === "imperial" ? (
          <div className="flex gap-2">
            <Input className="min-h-[44px]" type="number" inputMode="numeric" min={0} max={8} value={ft} onChange={(e) => { setFt(e.target.value); const f = Number(e.target.value) || 0; const i = Number(inch) || 0; setDraft({ ...draft, height_cm: f || i ? ftInToCm(f, i) : null }); }} placeholder="ft" />
            <Input className="min-h-[44px]" type="number" inputMode="numeric" min={0} max={11} value={inch} onChange={(e) => { setInch(e.target.value); const f = Number(ft) || 0; const i = Number(e.target.value) || 0; setDraft({ ...draft, height_cm: f || i ? ftInToCm(f, i) : null }); }} placeholder="in" />
          </div>
        ) : (
          <Input className="min-h-[44px]" type="number" inputMode="numeric" min={50} max={250} value={cm} onChange={(e) => { setCm(e.target.value); const n = Number(e.target.value); setDraft({ ...draft, height_cm: n > 0 ? n : null }); }} placeholder="cm" />
        )}
      </div>
      <div className="md:col-span-2">
        <Label>Time zone</Label>
        <Select value={draft.timezone} onValueChange={(v) => setDraft({ ...draft, timezone: v })}>
          <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
          <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function AddressCard({ form, onSave }: { form: any; onSave: Save }) {
  const initial = {
    address: form.address ?? "",
    city: form.city ?? "",
    province: form.province ?? "",
    postal_code: form.postal_code ?? "",
    country: form.country ?? "",
  };
  return (
    <EditableCard
      title="Address"
      description="Mailing address."
      initial={initial}
      onSave={async (d) => {
        await onSave({
          address: d.address || null,
          city: d.city || null,
          province: d.province || null,
          postal_code: d.postal_code || null,
          country: d.country || null,
        });
      }}
      view={(v) => (
        <div className="divide-y divide-border/60">
          <FieldRow label="Street" value={v.address} />
          <FieldRow label="City" value={v.city} />
          <FieldRow label="Province / State" value={v.province} />
          <FieldRow label="Postal / ZIP" value={v.postal_code} />
          <FieldRow label="Country" value={v.country} />
        </div>
      )}
      edit={(d, set) => (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Street address</Label>
            <Input className="min-h-[44px]" value={d.address} onChange={(e) => set({ ...d, address: e.target.value })} />
          </div>
          <div>
            <Label>City</Label>
            <Input className="min-h-[44px]" value={d.city} onChange={(e) => set({ ...d, city: e.target.value })} />
          </div>
          <div>
            <Label>Province / State</Label>
            <Input className="min-h-[44px]" value={d.province} onChange={(e) => set({ ...d, province: e.target.value })} />
          </div>
          <div>
            <Label>Postal / ZIP</Label>
            <Input className="min-h-[44px]" value={d.postal_code} onChange={(e) => set({ ...d, postal_code: e.target.value })} />
          </div>
          <div>
            <Label>Country</Label>
            <Select value={d.country} onValueChange={(v) => set({ ...d, country: v })}>
              <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}
    />
  );
}

export function EmergencyContactCard({ form, onSave }: { form: any; onSave: Save }) {
  const initial = {
    emergency_contact_name: form.emergency_contact_name ?? "",
    emergency_contact_phone: form.emergency_contact_phone ?? "",
  };
  return (
    <EditableCard
      title="Emergency Contact"
      description="Someone we can reach if anything urgent happens during training."
      initial={initial}
      onSave={async (d) => {
        await onSave({
          emergency_contact_name: d.emergency_contact_name || null,
          emergency_contact_phone: d.emergency_contact_phone || null,
        });
      }}
      view={(v) => (
        <div className="divide-y divide-border/60">
          <FieldRow label="Contact name" value={v.emergency_contact_name} />
          <FieldRow label="Contact phone" value={v.emergency_contact_phone} />
        </div>
      )}
      edit={(d, set) => (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Contact name</Label>
            <Input className="min-h-[44px]" value={d.emergency_contact_name} onChange={(e) => set({ ...d, emergency_contact_name: e.target.value })} />
          </div>
          <div>
            <Label>Contact phone</Label>
            <Input className="min-h-[44px]" type="tel" inputMode="tel" value={d.emergency_contact_phone} onChange={(e) => set({ ...d, emergency_contact_phone: e.target.value })} placeholder="(555) 123-4567" />
          </div>
        </div>
      )}
    />
  );
}