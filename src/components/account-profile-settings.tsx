import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { Camera, Trash2, X, Phone as PhoneIcon, AlertTriangle } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SavedIndicator } from "@/components/saved-indicator";

/**
 * Self-serve profile card for admin and coach accounts.
 * - Lets the signed-in user upload / replace / remove their profile picture.
 * - Lets them update their display name (and the coaches row if they're a coach).
 * - Mirrors the picture into `coaches.profile_picture_url` when the user has a coach row,
 *   so it shows in the rest of the app.
 */
export function AccountProfileSettings({
  title = "Your Profile",
  roleLabel,
}: {
  title?: string;
  roleLabel?: string;
}) {
  const { user } = useAuth();
  const [path, setPath] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [phone, setPhone] = useState("");
  const [originalPhone, setOriginalPhone] = useState("");
  const [coachId, setCoachId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const refresh = async () => {
    if (!user) return;
    const [{ data: profile }, { data: coach }] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase.from("coaches").select("id, profile_picture_url, full_name, phone").eq("user_id", user.id).maybeSingle(),
    ]);
    const pic = coach?.profile_picture_url ?? null;
    const name = coach?.full_name || profile?.full_name || user.email || "";
    const ph = (coach?.phone ?? (profile as any)?.phone ?? "") as string;
    setPath(pic);
    setFullName(name);
    setOriginalName(name);
    setPhone(ph);
    setOriginalPhone(ph);
    setCoachId(coach?.id ?? null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const persistPicture = async (storagePath: string | null) => {
    if (!user) return;
    // Always save to profiles for app-wide use
    await supabase
      .from("profiles")
      .update({ avatar_url: storagePath })
      .eq("id", user.id);
    // Mirror to coaches row when the user has one
    if (coachId) {
      await supabase
        .from("coaches")
        .update({ profile_picture_url: storagePath })
        .eq("id", coachId);
    }
    setPath(storagePath);
  };

  const onUploaded = async (storagePath: string) => {
    await persistPicture(storagePath);
    setEditing(false);
    toast.success("Profile picture updated");
  };

  const onRemove = async () => {
    if (!path) return;
    if (!confirm("Remove your profile picture? Initials will be shown instead.")) return;
    setRemoving(true);
    try {
      await persistPicture(null);
      // Best-effort cleanup of the storage object (RLS allows owner delete).
      await supabase.storage.from("avatars").remove([path]).catch(() => {});
      toast.success("Profile picture removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove picture");
    } finally {
      setRemoving(false);
    }
  };

  const { state: nameSaveState } = useAutosave({
    key: user ? `acct-name-${user.id}` : null,
    value: fullName,
    enabled: !!user && fullName.trim().length > 0 && fullName.trim() !== originalName.trim(),
    onSave: async (next) => {
      if (!user) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      await supabase.from("profiles").update({ full_name: trimmed }).eq("id", user.id);
      if (coachId) {
        await supabase.from("coaches").update({ full_name: trimmed }).eq("id", coachId);
      }
      setOriginalName(trimmed);
    },
  });

  const phoneValid = (v: string) => /^\+?[1-9]\d{7,14}$/.test(v.replace(/[\s\-()]/g, ""));
  const { state: phoneSaveState } = useAutosave({
    key: user ? `acct-phone-${user.id}` : null,
    value: phone,
    enabled: !!user && phone.trim() !== originalPhone.trim() && phoneValid(phone.trim()),
    onSave: async (next) => {
      if (!user) return;
      const trimmed = next.trim();
      await supabase.from("profiles").update({ phone: trimmed } as any).eq("id", user.id);
      if (coachId) {
        await supabase.from("coaches").update({ phone: trimmed } as any).eq("id", coachId);
      } else {
        // Create a coach row so call routing works (only if user is a coach/admin viewing this card)
        try {
          await supabase.from("coaches").insert({
            user_id: user.id,
            email: (user.email ?? "").toLowerCase(),
            full_name: fullName || user.email || "Coach",
            phone: trimmed,
            status: "Active",
          } as any);
          const { data } = await supabase.from("coaches").select("id").eq("user_id", user.id).maybeSingle();
          if (data?.id) setCoachId(data.id);
        } catch { /* non-coach users — profile phone is enough */ }
      }
      setOriginalPhone(trimmed);
    },
  });

  if (!user) return null;

  return (
    <Card className="border-border bg-card p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
          {roleLabel && <div className="mt-1 text-xs text-primary font-semibold">{roleLabel}</div>}
        </div>
      </div>

      {!editing ? (
        <div className="flex items-center gap-4">
          <UserAvatar src={path} name={fullName} size={72} ring />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold">{fullName || user.email}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Camera className="mr-2 h-3.5 w-3.5" />
                {path ? "Replace photo" : "Upload photo"}
              </Button>
              {path && (
                <Button size="sm" variant="ghost" onClick={onRemove} disabled={removing} className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Update profile picture</div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ProfilePictureCapture
            userId={user.id}
            currentUrl={path}
            onUploaded={onUploaded}
            allowFileUpload
            mode="admin"
            hidePreviewThumbnail
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="acct-name">Display name</Label>
          <SavedIndicator state={nameSaveState} />
        </div>
        <Input
          id="acct-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your name"
        />
        <p className="text-[11px] text-muted-foreground">
          Saves automatically. Shown in messages, feedback, reviews and account areas.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="acct-phone" className="flex items-center gap-1.5">
            <PhoneIcon className="h-3.5 w-3.5" />
            Phone number <span className="text-destructive">*</span>
          </Label>
          <SavedIndicator state={phoneSaveState} />
        </div>
        <Input
          id="acct-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+12042907443"
          aria-invalid={!phone.trim() || !phoneValid(phone.trim())}
        />
        {!phone.trim() ? (
          <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Required. Clients tap "Call coach" and this is the number they reach.</span>
          </div>
        ) : !phoneValid(phone.trim()) ? (
          <p className="text-[11px] text-destructive">Use E.164 format, e.g. +12042907443</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Saves automatically. Synced to your coach profile and Call Access.
          </p>
        )}
      </div>
    </Card>
  );
}
