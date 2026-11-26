/**
 * A specialist's first screen after their password and two-step sign-in:
 * the name they go by, their phone, their time zone, a clear headshot, and
 * their promise to keep athletes' information private. Nothing about any
 * athlete shows until it's done (getSpecialistHome).
 */
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSpecialistProfile, type SpecialistMe } from "@/lib/team-access/specialist.functions";
import { CONFIDENTIALITY_TEXT } from "@/lib/team-access/presets";

function zones(): string[] {
  try {
    const list = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
    if (list?.length) return list;
  } catch {
    /* older browsers: the common ones */
  }
  return [
    "America/Winnipeg",
    "America/Toronto",
    "America/Edmonton",
    "America/Vancouver",
    "America/Regina",
    "America/Halifax",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "UTC",
  ];
}

/** A photo shrunk to 1024 px on its long side, as a JPEG. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a photo we can read."));
      i.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't read the photo."))),
        "image/jpeg",
        0.85,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SpecialistSetup({ me, onDone }: { me: SpecialistMe; onDone: () => unknown }) {
  const save = useServerFn(saveSpecialistProfile);
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Winnipeg";
    } catch {
      return "America/Winnipeg";
    }
  }, []);
  const zoneList = useMemo(() => zones(), []);
  const [name, setName] = useState(me.displayName ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [zone, setZone] = useState(me.timeZone ?? detected);
  const [agree, setAgree] = useState(!me.needs.includes("confidentiality"));
  const [photo, setPhoto] = useState<{ path: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const needsPhoto = me.needs.includes("headshot") && !photo;

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await shrink(file);
      const path = `${me.userId}/team-headshot-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("Couldn't upload the photo. Try again.");
      setPhoto({ path, preview: URL.createObjectURL(blob) });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't upload the photo");
    } finally {
      setUploading(false);
    }
  }

  const ready =
    name.trim().length > 0 &&
    phone.trim().length >= 7 &&
    !!zone &&
    agree &&
    !needsPhoto &&
    !uploading;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      await save({
        data: {
          displayName: name.trim(),
          phone: phone.trim(),
          timeZone: zone,
          headshotPath: photo?.path ?? null,
          agree,
        },
      });
      toast.success("You're set up");
      await onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mx-auto max-w-md space-y-5 pb-12 pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">{me.title}</div>
        <h1 className="text-2xl font-semibold">Finish your profile</h1>
        <p className="text-sm text-muted-foreground">
          So the athletes and Jared know who's watching. It takes a minute.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted"
          aria-label="Add a headshot"
        >
          {photo || me.headshotUrl ? (
            <img
              src={photo?.preview ?? me.headshotUrl ?? ""}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Camera className="h-6 w-6 text-muted-foreground" />
          )}
        </button>
        <div className="text-sm">
          <div className="font-medium">A clear headshot</div>
          <div className="text-muted-foreground">Your face, well lit, nobody else in it.</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {photo || me.headshotUrl ? "Change photo" : "Add photo"}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sp-name">Name people see</Label>
        <Input
          id="sp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sp-phone">Phone</Label>
        <Input
          id="sp-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="204 555 0123"
          autoComplete="tel"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Time zone</Label>
        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zoneList.map((z) => (
              <SelectItem key={z} value={z}>
                {z.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {me.needs.includes("confidentiality") && (
        <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
          <Checkbox
            checked={agree}
            onCheckedChange={(v) => setAgree(v === true)}
            className="mt-0.5"
          />
          <span>{CONFIDENTIALITY_TEXT}</span>
        </label>
      )}

      <Button type="submit" className="w-full" disabled={!ready || busy} loading={busy}>
        Done
      </Button>
    </form>
  );
}
