import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Camera, Scale, Ruler, ArrowRight, Loader2, Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  logMeasurement,
  createSubmission, createMedia, uploadProgressFile,
  MEASUREMENT_FIELDS,
} from "@/lib/progress";
import { todayLocalISO } from "@/lib/today";

/**
 * Progress Snapshot card for client + member home dashboards.
 * Quick-add measurement and photo with one CTA to the Progress page.
 */
export type ProgressSummaryAction = "photo" | "weight" | "measure" | "history";

export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress Snapshot",
  extraActions,
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
  /**
   * Optional quick-action tiles rendered inside the same card, just above the
   * "View Full Progress" CTA. Used by the client + member home dashboards to
   * combine the Progress Snapshot with primary quick actions in one section,
   * so we never duplicate items that already live in the bottom tab bar.
   */
  extraActions?: ReactNode;
}) {
  void currentUserId; void viewerRole;
  const qc = useQueryClient();
  const ownerType: "client" | "member" =
    progressHref.kind === "member" ? "member" : "client";

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
        upload_status: "ready",
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

        {/* Inline quick log — measurement */}
        <div className="rounded-xl border border-border bg-secondary/30 p-5">
          <button
            type="button"
            onClick={() => setMeasOpen((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <Ruler className="h-5 w-5 text-primary" /> Add measurement
            </span>
            <Plus className={`h-5 w-5 transition ${measOpen ? "rotate-45" : ""}`} />
          </button>
          {measOpen && (
            <div className="mt-3 grid grid-cols-[1fr_1fr_72px_auto] gap-2">
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
        <div className="rounded-xl border border-border bg-secondary/30 p-5">
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
            className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {photoUploading ? "Uploading…" : "Add progress photo"}
            </span>
            {photoUploading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Plus className="h-5 w-5" />}
          </button>
        </div>

        {extraActions ? (
          <div className="pt-1">{extraActions}</div>
        ) : null}

        <ViewCta />
      </div>
    </Card>
  );
}

