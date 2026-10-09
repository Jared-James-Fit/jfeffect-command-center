import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Globe, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WeeklyHoursEditor } from "@/components/booking/weekly-hours-editor";
import { CARD_ACCENTS } from "@/lib/booking-cards";
import { SESSION_TYPES, COMMON_TIMEZONES } from "@/lib/pt-sessions";
import {
  hmToMin,
  normalizeHours,
  slugify,
  summarizeHours,
  type HoursWindow,
} from "@/lib/booking-slots";
import {
  ADVANCE_CHOICES,
  BUFFER_CHOICES,
  DURATION_CHOICES,
  LOCATION_MODES,
  NOTICE_CHOICES,
  bookedLocation,
  creditDefaultFor,
  isTrainingSessionType,
  publicOrigin,
  type BookingType,
  type LocationMode,
} from "@/lib/booking-types";
import { cn } from "@/lib/utils";

export const DEFAULT_GYM = "800 Vaughan Ave Unit 404, Selkirk, Manitoba R1A 4R4, Canada";

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Winnipeg";
  } catch {
    return "America/Winnipeg";
  }
}

function tzLabel(tz: string): string {
  return tz.split("/").pop()!.replace(/_/g, " ");
}

type Form = Omit<BookingType, "id" | "sort_order" | "hours"> & { hours: HoursWindow[] };

function blank(): Form {
  return {
    name: "",
    session_type: "Personal Training Session",
    custom_type: null,
    duration_minutes: 60,
    location: DEFAULT_GYM,
    default_notes: null,
    visible_to_client: true,
    client_visible_notes: true,
    reminders_enabled: true,
    send_confirmation_email: true,
    uses_credit: true,
    color: "gold",
    is_active: true,
    slug: null,
    online_enabled: true,
    show_in_app: true,
    location_mode: "in_person",
    description: null,
    timezone: deviceTz(),
    min_notice_hours: 12,
    max_advance_days: 60,
    buffer_minutes: 0,
    max_per_day: null,
    collect_phone: true,
    collect_notes: true,
    hours: [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: "09:00", end_time: "17:00" })),
  };
}

function fromType(t: BookingType, hours: HoursWindow[]): Form {
  const { id: _id, sort_order: _s, hours: _h, ...rest } = t;
  return { ...blank(), ...rest, hours, timezone: t.timezone || deviceTz() };
}

/** Pill-style single choice; big enough to tap. */
function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            "h-9 rounded-full border px-3 text-xs font-bold transition",
            o.value === value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {hint && (
          <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/**
 * Create or edit a booking type: what it is, how long, where, whether it uses
 * a session, and (optionally) online booking with weekly hours and a link.
 */
export function BookingTypeEditor({
  open,
  onOpenChange,
  initial,
  prefill,
  nextSortOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: BookingType | null;
  prefill?: Partial<BookingType> | null;
  nextSortOrder?: number;
  onSaved?: (t: BookingType) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [creditTouched, setCreditTouched] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial?.id;

  // Hours aren't on the row; load them when editing from somewhere that didn't.
  const { data: loadedHours } = useQuery<HoursWindow[]>({
    queryKey: ["booking-type-hours", initial?.id],
    enabled: open && isEdit && !initial?.hours,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("booking_card_hours")
        .select("day_of_week, start_time, end_time")
        .eq("booking_card_id", initial!.id);
      return ((data ?? []) as any[]).map((h) => ({
        day_of_week: h.day_of_week,
        start_time: String(h.start_time).slice(0, 5),
        end_time: String(h.end_time).slice(0, 5),
      }));
    },
  });

  useEffect(() => {
    if (!open) return;
    setCreditTouched(isEdit);
    setRulesOpen(false);
    setMoreOpen(false);
    if (initial) {
      setForm(fromType(initial, initial.hours ?? loadedHours ?? []));
    } else {
      const base = { ...blank(), ...(prefill ?? {}) } as Form;
      if (base.location_mode !== "in_person") base.location = bookedLocation(base);
      setForm(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, prefill]);

  useEffect(() => {
    if (open && isEdit && !initial?.hours && loadedHours)
      setForm((f) => ({ ...f, hours: loadedHours }));
  }, [loadedHours, open, isEdit, initial?.hours]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const training = isTrainingSessionType(form.session_type);
  const hoursBad = form.hours.some((w) => hmToMin(w.end_time) <= hmToMin(w.start_time));
  const otherTz = form.timezone !== deviceTz();
  const origin = publicOrigin();

  const setKind = (kind: "training" | "call") => {
    const sessionType = kind === "training" ? "Personal Training Session" : "Consultation";
    setForm((f) => ({
      ...f,
      session_type: sessionType,
      uses_credit: creditTouched ? f.uses_credit : creditDefaultFor(sessionType),
      location_mode:
        kind === "training"
          ? "in_person"
          : f.location_mode === "in_person"
            ? "video"
            : f.location_mode,
      location:
        kind === "training"
          ? f.location_mode === "in_person"
            ? f.location
            : DEFAULT_GYM
          : f.location,
    }));
  };
  const setMode = (mode: LocationMode) =>
    setForm((f) => ({
      ...f,
      location_mode: mode,
      location:
        mode === "in_person"
          ? f.location_mode === "in_person"
            ? f.location
            : DEFAULT_GYM
          : bookedLocation({ location_mode: mode, location: null }),
    }));

  const turnOnline = async (on: boolean) => {
    set("online_enabled", on);
    if (on && !form.slug) set("slug", await freeSlug(slugify(form.name || "book"), initial?.id));
    if (on && !form.hours.length) set("hours", blank().hours);
  };

  const rulesSummary = useMemo(() => {
    const notice =
      NOTICE_CHOICES.find((c) => c.hours === form.min_notice_hours)?.label ??
      `${form.min_notice_hours} h`;
    const ahead =
      ADVANCE_CHOICES.find((c) => c.days === form.max_advance_days)?.label ??
      `${form.max_advance_days} days`;
    return [
      `${notice} notice`,
      `up to ${ahead} ahead`,
      form.buffer_minutes ? `${form.buffer_minutes} min gap` : null,
      form.max_per_day ? `max ${form.max_per_day}/day` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [form.min_notice_hours, form.max_advance_days, form.buffer_minutes, form.max_per_day]);

  const save = async () => {
    const name = form.name.trim();
    if (!name) return toast.error('Give it a name, like "1:1 Training".');
    if (form.location_mode === "in_person" && !form.location?.trim())
      return toast.error("Add the address.");
    const hours = normalizeHours(form.hours);
    if (form.online_enabled) {
      if (hoursBad) return toast.error("One of the hours ends before it starts.");
      if (!hours.length)
        return toast.error("Add at least one day of hours, or turn online booking off.");
    }
    setSaving(true);
    try {
      // Every online type needs a link; a type keeps its link when paused.
      let slug = form.slug?.trim() ? slugify(form.slug) : null;
      if (form.online_enabled && !slug) slug = await freeSlug(slugify(name), initial?.id);
      const payload: any = {
        name,
        session_type: form.session_type,
        custom_type:
          form.session_type === "Custom Session" ? form.custom_type?.trim() || null : null,
        duration_minutes: form.duration_minutes,
        location:
          form.location_mode === "in_person" ? form.location?.trim() || null : bookedLocation(form),
        default_notes: form.default_notes?.trim() || null,
        visible_to_client: form.visible_to_client,
        client_visible_notes: form.client_visible_notes,
        reminders_enabled: form.reminders_enabled,
        send_confirmation_email: form.send_confirmation_email,
        uses_credit: form.uses_credit,
        color: form.color,
        is_active: form.is_active,
        slug,
        online_enabled: form.online_enabled,
        show_in_app: form.show_in_app,
        location_mode: form.location_mode,
        description: form.description?.trim() || null,
        timezone: form.timezone,
        min_notice_hours: form.min_notice_hours,
        max_advance_days: form.max_advance_days,
        buffer_minutes: form.buffer_minutes,
        max_per_day: form.max_per_day || null,
        collect_phone: form.collect_phone,
        collect_notes: form.collect_notes,
      };
      const q = isEdit
        ? (supabase as any)
            .from("booking_cards")
            .update(payload)
            .eq("id", initial!.id)
            .select("*")
            .single()
        : (supabase as any)
            .from("booking_cards")
            .insert({ ...payload, sort_order: nextSortOrder ?? 0 })
            .select("*")
            .single();
      const { data: row, error } = await q;
      if (error) {
        if (error.code === "23505")
          throw new Error(
            "That link is already used by another booking type. Pick a different one.",
          );
        throw error;
      }
      const { error: delErr } = await (supabase as any)
        .from("booking_card_hours")
        .delete()
        .eq("booking_card_id", row.id);
      if (delErr) throw delErr;
      if (hours.length) {
        const { error: insErr } = await (supabase as any)
          .from("booking_card_hours")
          .insert(hours.map((h) => ({ booking_card_id: row.id, ...h })));
        if (insErr) throw insErr;
      }
      qc.invalidateQueries({ queryKey: ["booking-cards"] });
      qc.invalidateQueries({ queryKey: ["booking-types-admin"] });
      qc.invalidateQueries({ queryKey: ["booking-type-hours", row.id] });
      toast.success(
        isEdit
          ? "Saved"
          : form.online_enabled
            ? "Created. Your booking link is ready to share."
            : "Created",
      );
      onSaved?.({ ...row, hours });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${initial?.name}` : "New booking type"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="bt-name">Name</Label>
            <Input
              id="bt-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. 1:1 Training"
            />
          </div>

          <div className="space-y-1.5">
            <Label>What is it?</Label>
            <Choice
              value={training ? "training" : "call"}
              options={[
                { value: "training", label: "Training session" },
                { value: "call", label: "Call or meeting" },
              ]}
              onChange={(v) => setKind(v as "training" | "call")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>How long?</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Choice
                value={
                  DURATION_CHOICES.includes(form.duration_minutes) ? form.duration_minutes : -1
                }
                options={DURATION_CHOICES.map((m) => ({
                  value: m,
                  label: m < 60 ? `${m} min` : m === 60 ? "1 hr" : `${m / 60} hr`,
                }))}
                onChange={(v) => set("duration_minutes", v)}
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  step={5}
                  value={form.duration_minutes}
                  onChange={(e) =>
                    set(
                      "duration_minutes",
                      Math.max(5, Math.min(480, parseInt(e.target.value || "0", 10) || 5)),
                    )
                  }
                  className="h-9 w-20"
                  aria-label="Minutes"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Where?</Label>
            <Choice
              value={form.location_mode}
              options={LOCATION_MODES.map((m) => ({ value: m.id, label: m.label }))}
              onChange={setMode}
            />
            {form.location_mode === "in_person" ? (
              <Input
                value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Address"
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {LOCATION_MODES.find((m) => m.id === form.location_mode)?.hint}
              </p>
            )}
          </div>

          <Row
            title="Uses a session credit"
            hint={
              form.uses_credit
                ? "Booking holds 1 session from their package. Marking it done uses it, cancelling gives it back."
                : "Free. Doesn't touch their package."
            }
            checked={form.uses_credit}
            onChange={(v) => {
              setCreditTouched(true);
              set("uses_credit", v);
            }}
          />

          {/* Online booking */}
          <section
            className={cn(
              "space-y-3 rounded-xl border p-3",
              form.online_enabled ? "border-primary/40 bg-primary/5" : "border-border",
            )}
          >
            <Row
              title="Online booking"
              hint={
                form.online_enabled
                  ? "People pick a time from your hours. Busy times in the app and Google are never offered."
                  : "Off: only you can book this, from the app."
              }
              checked={form.online_enabled}
              onChange={turnOnline}
            />
            {form.online_enabled && (
              <>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Link
                  </Label>
                  <div className="flex items-center overflow-hidden rounded-md border border-input bg-background">
                    <span className="shrink-0 truncate pl-2.5 text-xs text-muted-foreground">
                      {origin.replace(/^https?:\/\//, "")}/book/
                    </span>
                    <input
                      value={form.slug ?? ""}
                      onChange={(e) =>
                        set(
                          "slug",
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]/g, "-")
                            .replace(/-{2,}/g, "-"),
                        )
                      }
                      onBlur={() => set("slug", form.slug?.trim() ? slugify(form.slug) : null)}
                      placeholder={slugify(form.name || "your-link")}
                      className="h-10 min-w-0 flex-1 bg-transparent pr-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
                      aria-label="Link name"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label>Your hours</Label>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {summarizeHours(form.hours)}
                    </span>
                  </div>
                  <WeeklyHoursEditor value={form.hours} onChange={(h) => set("hours", h)} />
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-[11px]",
                      otherTz ? "text-amber-500" : "text-muted-foreground",
                    )}
                  >
                    {otherTz ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <Globe className="h-3.5 w-3.5" />
                    )}
                    <span>
                      Hours are in {tzLabel(form.timezone)} time
                      {otherTz ? `, not ${tzLabel(deviceTz())}` : ""}.
                    </span>
                    {otherTz ? (
                      <button
                        type="button"
                        className="font-bold underline"
                        onClick={() => set("timezone", deviceTz())}
                      >
                        Use {tzLabel(deviceTz())}
                      </button>
                    ) : null}
                  </div>
                </div>

                <Row
                  title="Clients can book it in their app"
                  hint={
                    form.location_mode === "in_person"
                      ? "Shows under Schedule → Book for clients who train with you in person."
                      : "Shows under Schedule → Book for every client."
                  }
                  checked={form.show_in_app}
                  onChange={(v) => set("show_in_app", v)}
                />

                <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">Booking rules</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {rulesSummary}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform",
                          rulesOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 px-1 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Can't book closer than</Label>
                      <Choice
                        value={form.min_notice_hours}
                        options={NOTICE_CHOICES.map((c) => ({ value: c.hours, label: c.label }))}
                        onChange={(v) => set("min_notice_hours", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Can book up to</Label>
                      <Choice
                        value={form.max_advance_days}
                        options={ADVANCE_CHOICES.map((c) => ({ value: c.days, label: c.label }))}
                        onChange={(v) => set("max_advance_days", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Gap before and after other bookings</Label>
                      <Choice
                        value={form.buffer_minutes}
                        options={BUFFER_CHOICES.map((m) => ({
                          value: m,
                          label: m ? `${m} min` : "None",
                        }))}
                        onChange={(v) => set("buffer_minutes", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs" htmlFor="bt-max">
                        Most bookings of this per day
                      </Label>
                      <Input
                        id="bt-max"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={50}
                        placeholder="No limit"
                        value={form.max_per_day ?? ""}
                        onChange={(e) =>
                          set(
                            "max_per_day",
                            e.target.value
                              ? Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1))
                              : null,
                          )
                        }
                        className="h-9 w-24"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Row
                        title="Ask for a phone number"
                        checked={form.collect_phone || form.location_mode === "phone"}
                        onChange={(v) => set("collect_phone", v)}
                      />
                      <Row
                        title="Ask for a note"
                        checked={form.collect_notes}
                        onChange={(v) => set("collect_notes", v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Time zone</Label>
                      <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(new Set([form.timezone, ...COMMON_TIMEZONES])).map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="bt-desc">
                    Shown on the booking page (optional)
                  </Label>
                  <Textarea
                    id="bt-desc"
                    rows={2}
                    value={form.description ?? ""}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="What to expect, what to bring."
                  />
                </div>
              </>
            )}
          </section>

          <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-between text-muted-foreground"
              >
                More options
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Session type</Label>
                  <Select
                    value={form.session_type}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        session_type: v,
                        uses_credit: creditTouched ? f.uses_credit : creditDefaultFor(v),
                      }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SESSION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.session_type === "Custom Session" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custom type</Label>
                    <Input
                      className="h-9"
                      value={form.custom_type ?? ""}
                      onChange={(e) => set("custom_type", e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex flex-wrap gap-2">
                  {CARD_ACCENTS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.label}
                      aria-label={c.label}
                      onClick={() => set("color", c.id)}
                      className={cn(
                        "h-8 w-8 rounded-full transition",
                        c.swatch,
                        form.color === c.id
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                          : "opacity-50 hover:opacity-100",
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes added to each booking (optional)</Label>
                <Textarea
                  rows={2}
                  value={form.default_notes ?? ""}
                  onChange={(e) => set("default_notes", e.target.value)}
                />
              </div>
              <Row
                title="Show notes to the client"
                checked={form.client_visible_notes}
                onChange={(v) => set("client_visible_notes", v)}
              />
              <Row
                title="Text a reminder the evening before"
                checked={form.reminders_enabled}
                onChange={(v) => set("reminders_enabled", v)}
              />
              <Row
                title="Active"
                hint="Off hides it from booking everywhere."
                checked={form.is_active}
                onChange={(v) => set("is_active", v)}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold">
            {saving ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** First free link for a type ("1-1-training", then "-2", "-3"…). */
export async function freeSlug(base: string, selfId?: string | null): Promise<string> {
  const root = base || "book";
  const { data } = await (supabase as any)
    .from("booking_cards")
    .select("id, slug")
    .like("slug", `${root}%`);
  const taken = new Set(((data ?? []) as any[]).filter((r) => r.id !== selfId).map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 100; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}
