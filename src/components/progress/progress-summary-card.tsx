import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Camera, Scale, Ruler, TrendingDown, TrendingUp, Minus, ArrowRight,
  Check, Loader2, Plus,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { toast } from "sonner";
import {
  listBodyweight, listSubmissions, listMeasurements,
  logBodyweight, logMeasurement,
  createSubmission, createMedia, uploadProgressFile,
  MEASUREMENT_FIELDS,
} from "@/lib/progress";
import { todayLocalISO } from "@/lib/today";

/**
 * Progress Snapshot card for client + member home dashboards.
 * Shows current bodyweight, 7-day change, latest progress photo date,
 * and latest measurement date — with one CTA to the Progress page.
 * Keeps Home focused; all logging happens on the Progress page itself.
 */
export type ProgressSummaryAction = "photo" | "weight" | "measure" | "history";

export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress Snapshot",
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
}) {
  void currentUserId; void viewerRole;
  const qc = useQueryClient();
  const ownerType: "client" | "member" =
    progressHref.kind === "member" ? "member" : "client";

  const { data: bw = [] } = useQuery({
    queryKey: ["progress-bw", userId],
    enabled: !!userId,
    queryFn: () => listBodyweight(userId),
    staleTime: 30_000,
  });
  const { data: photos = [] } = useQuery({
    queryKey: ["progress-subs-photo", userId],
    enabled: !!userId,
    queryFn: () => listSubmissions({ userId, type: "photo" }),
    staleTime: 30_000,
  });
  const { data: meas = [] } = useQuery({
    queryKey: ["progress-meas", userId],
    enabled: !!userId,
    queryFn: () => listMeasurements(userId),
    staleTime: 30_000,
  });

  // Most recent weight & 7-day delta (in the latest entry's unit).
  const sorted = [...bw].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
  const latest = sorted[sorted.length - 1] ?? null;
  const unit = latest?.weight_unit ?? "lb";
  const currentWeight = latest ? `${latest.weight_value} ${unit}` : "—";
  const weekChange = (() => {
    if (!latest || sorted.length < 2) return null;
    const target = new Date(latest.logged_date);
    target.setDate(target.getDate() - 7);
    let prev: typeof sorted[number] | null = null;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (new Date(sorted[i].logged_date) <= target) { prev = sorted[i]; break; }
      prev = sorted[i];
    }
    if (!prev) return null;
    const toLatest = prev.weight_unit === unit
      ? Number(prev.weight_value)
      : prev.weight_unit === "kg"
        ? Number(prev.weight_value) * 2.20462
        : Number(prev.weight_value) / 2.20462;
    return +(Number(latest.weight_value) - toLatest).toFixed(1);
  })();

  const latestPhoto = photos[0]?.submission_date ?? null;
  const latestMeas = meas[0]?.measured_date ?? null;

  const fmtAgo = (d: string | null) => {
    if (!d) return "Not yet";
    try {
      const days = differenceInDays(new Date(), parseISO(d));
      if (days <= 0) return "Today";
      if (days === 1) return "Yesterday";
      if (days < 30) return `${days}d ago`;
      return format(parseISO(d), "MMM d");
    } catch { return d; }
  };

  const TrendIcon = weekChange == null ? Minus : weekChange < 0 ? TrendingDown : weekChange > 0 ? TrendingUp : Minus;
  const trendTone = weekChange == null ? "text-muted-foreground" : weekChange <= 0 ? "text-emerald-500" : "text-amber-500";

  const ctaClass = "mt-3 h-10 w-full text-xs font-bold uppercase tracking-wide";
  const cta = (
    <Button variant="outline" className={ctaClass}>
      View Full Progress <ArrowRight className="ml-1.5 h-4 w-4" />
    </Button>
  );

  const ViewCta = () => {
    if (progressHref.kind === "portal") return <Link to="/portal/progress">{cta}</Link>;
    if (progressHref.kind === "member") return <Link to="/m/progress">{cta}</Link>;
    return (
      <Link to="/admin/clients/$id/progress" params={{ id: progressHref.clientId }}>{cta}</Link>
    );
  };

  // ---------- Inline quick-add: bodyweight ----------
  const [bwValue, setBwValue] = useState("");
  const [bwUnit, setBwUnit] = useState<"kg" | "lb">((unit as "kg" | "lb") || "lb");
  const [bwSaving, setBwSaving] = useState(false);
  const [bwSaved, setBwSaved] = useState(false);

  const saveBodyweight = async () => {
    const v = Number(bwValue);
    if (!bwValue || Number.isNaN(v) || v <= 0) {
      toast.error("Enter a valid weight.");
      return;
    }
    try {
      setBwSaving(true);
      await logBodyweight({
        user_id: userId,
        weight_value: v,
        weight_unit: bwUnit,
        logged_date: todayLocalISO(),
      });
      setBwValue("");
      setBwSaved(true);
      window.setTimeout(() => setBwSaved(false), 1400);
      toast.success(`Logged ${v} ${bwUnit}`);
      qc.invalidateQueries({ queryKey: ["progress-bw", userId] });
      qc.invalidateQueries({ queryKey: ["progress-metrics"] });
      qc.invalidateQueries({ queryKey: ["bodyweight"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save weight.");
    } finally {
      setBwSaving(false);
    }
  };

  // ---------- Inline quick-add: measurement ----------
  const [measOpen, setMeasOpen] = useState(false);
  const [measField, setMeasField] = useState<string>(MEASUREMENT_FIELDS[0].key);
  const [measValue, setMeasValue] = useState("");
  const [measUnit, setMeasUnit] = useState<"cm" | "in">("in");
  const [measSaving, setMeasSaving] = useState(false);

  const saveMeasurement = async () => {
    const v = Number(measValue);
    if (!measValue || Number.isNaN(v) || v <= 0) {
      toast.error("Enter a valid measurement.");
      return;
    }
    try {
      setMeasSaving(true);
      await logMeasurement({
        user_id: userId,
        unit: measUnit,
        fields: { [measField]: v },
        measured_date: todayLocalISO(),
      });
      setMeasValue("");
      toast.success("Measurement saved");
      qc.invalidateQueries({ queryKey: ["progress-meas", userId] });
      setMeasOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save measurement.");
    } finally {
      setMeasSaving(false);
    }
  };

  // ---------- Inline quick-add: photo ----------
  const photoRef = useRef<HTMLInputElement | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const uploadPhoto = async (file: File) => {
    try {
      setPhotoUploading(true);
      const sub = await createSubmission({
        user_id: userId,
        owner_type: ownerType,
        submission_type: "photo",
        review_status: ownerType === "client" ? "draft" : "self_tracking",
      });
      const uploaded = await uploadProgressFile({ file, userId });
      await createMedia({
        submission_id: sub.id,
        user_id: userId,
        media_type: "photo",
        angle: "all",
        original_filename: file.name,
        file_size_bytes: uploaded.sizeBytes,
        mime_type: uploaded.mimeType,
        storage_path: uploaded.path,
        upload_status: "uploaded",
      });
      toast.success("Photo added");
      qc.invalidateQueries({ queryKey: ["progress-subs-photo", userId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={Scale} label="Current weight" value={currentWeight} />
          <Stat
            icon={TrendIcon}
            label="7-day change"
            value={weekChange == null
              ? "—"
              : `${weekChange > 0 ? "+" : ""}${weekChange} ${unit}`}
            tone={trendTone}
          />
          <Stat icon={Camera} label="Latest photo" value={fmtAgo(latestPhoto)} />
          <Stat icon={Ruler} label="Latest measurement" value={fmtAgo(latestMeas)} />
        </div>

        {/* Inline quick log — weight */}
        <div className={`rounded-xl border bg-secondary/30 p-3 transition ${bwSaved ? "border-primary/60 ring-1 ring-primary/40" : "border-border"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Scale className="h-3.5 w-3.5 text-primary" /> Log weight
          </div>
          <div className="grid grid-cols-[1fr_72px_auto] gap-2">
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder={`e.g. ${unit === "kg" ? "82.4" : "182.4"}`}
              value={bwValue}
              onChange={(e) => setBwValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveBodyweight(); }}
              className="h-10"
            />
            <Select value={bwUnit} onValueChange={(v) => setBwUnit(v as "kg" | "lb")}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="kg">kg</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => void saveBodyweight()}
              disabled={bwSaving || !bwValue}
              className="h-10 px-3 font-bold uppercase"
            >
              {bwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : bwSaved ? <Check className="h-4 w-4" /> : "Save"}
            </Button>
          </div>
        </div>

        {/* Inline quick log — measurement */}
        <div className="rounded-xl border border-border bg-secondary/30 p-3">
          <button
            type="button"
            onClick={() => setMeasOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5 text-primary" /> Add measurement
            </span>
            <Plus className={`h-3.5 w-3.5 transition ${measOpen ? "rotate-45" : ""}`} />
          </button>
          {measOpen && (
            <div className="mt-2 grid grid-cols-[1fr_1fr_72px_auto] gap-2">
              <Select value={measField} onValueChange={setMeasField}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_FIELDS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.1"
                inputMode="decimal"
                placeholder={measUnit === "cm" ? "e.g. 86" : "e.g. 34"}
                value={measValue}
                onChange={(e) => setMeasValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveMeasurement(); }}
                className="h-10"
              />
              <Select value={measUnit} onValueChange={(v) => setMeasUnit(v as "cm" | "in")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">in</SelectItem>
                  <SelectItem value="cm">cm</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => void saveMeasurement()}
                disabled={measSaving || !measValue}
                className="h-10 px-3 font-bold uppercase"
              >
                {measSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          )}
        </div>

        {/* Inline quick add — photo */}
        <div className="rounded-xl border border-border bg-secondary/30 p-3">
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPhoto(f);
            }}
          />
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            disabled={photoUploading}
            className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 text-primary" />
              {photoUploading ? "Uploading…" : "Add progress photo"}
            </span>
            {photoUploading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        <ViewCta />
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone ?? ""}`} />
        {label}
      </div>
      <div className={`mt-1 text-base font-bold leading-tight ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

