import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Camera, Scale, Ruler, ArrowRight, Loader2, Plus, Video, Dumbbell,
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

  // ---------- Stat tiles: days since last video / lift ----------
  const { data: latestVideoAt } = useQuery({
    queryKey: ["progress-latest-video", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_submissions")
        .select("submission_date, created_at")
        .eq("user_id", userId)
        .eq("submission_type", "video")
        .order("submission_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.submission_date ?? data?.created_at ?? null) as string | null;
    },
  });
  const { data: latestLiftAt } = useQuery({
    queryKey: ["progress-latest-lift", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("lift_videos")
        .select("created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.created_at ?? null) as string | null;
    },
  });

  const daysSince = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "—";
    const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
    return days === 0 ? "Today" : `${days}d`;
  };

  const progressTo =
    progressHref.kind === "member" ? "/m/progress" : "/portal/progress";

  const StatTile = ({
    icon: Icon, label, value,
  }: { icon: typeof Video; label: string; value: string }) => (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );

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

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-2">
          <StatTile icon={Video} label="Latest video" value={daysSince(latestVideoAt)} />
          <StatTile icon={Dumbbell} label="Latest lift" value={daysSince(latestLiftAt)} />
        </div>

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

        {/* Inline quick add — progress video */}
        <Link
          to={progressTo}
          search={{ action: "video" }}
          className="block rounded-xl border border-border bg-secondary/30 p-5"
        >
          <span className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              Add progress video
            </span>
            <Plus className="h-5 w-5" />
          </span>
        </Link>

        {/* Inline quick add — lift video */}
        <Link
          to={progressTo}
          search={{ action: "lift" }}
          className="block rounded-xl border border-border bg-secondary/30 p-5"
        >
          <span className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5 text-primary" />
              Upload lift video
            </span>
            <Plus className="h-5 w-5" />
          </span>
        </Link>

        {extraActions ? (
          <div className="pt-1">{extraActions}</div>
        ) : null}

        <ViewCta />
      </div>
    </Card>
  );
}

