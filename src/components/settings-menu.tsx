import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, LogOut, Settings as SettingsIcon, UserCog, ImageIcon, Mail } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { requestEmailChange } from "@/lib/account-email.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { NavItem } from "@/components/app-shell";
import { toast } from "sonner";

/**
 * Settings dropdown — opened from the gear icon (or any trigger) in the
 * top bar and sidebar. Contains profile picture preview/edit, every
 * settings/account nav item, and sign-out.
 */
export function SettingsMenu({
  items,
  meName,
  mePic,
  onSignOut,
  trigger,
  align = "end",
}: {
  items: NavItem[];
  meName: string;
  mePic: string | null;
  onSignOut: () => void;
  trigger: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [picOpen, setPicOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  // Settings/account-style items — Account group, account/settings routes,
  // plus billing/purchases so clients & members can reach payment info from
  // the gear icon.
  const settingItems = items.filter(
    (i) =>
      i.group === "Account" ||
      i.to.endsWith("/account") ||
      i.to.endsWith("/account-settings") ||
      i.to.endsWith("/settings") ||
      i.to.endsWith("/billing") ||
      i.to.endsWith("/purchases"),
  );

  const { data: signedPic } = useQuery({
    queryKey: ["settings-menu-avatar", mePic],
    enabled: !!mePic,
    queryFn: async () => {
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(mePic!, 60 * 60);
      return data?.signedUrl ?? null;
    },
  });

  const handleUploaded = async (path: string) => {
    if (!user?.id) return;
    const stamp = new Date().toISOString();
    try {
      // Update whichever profile rows exist for this user.
      const [{ data: cli }, { data: co }] = await Promise.all([
        supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle(),
        supabase.from("coaches").select("id").eq("user_id", user.id).maybeSingle(),
      ]);
      await Promise.all([
        Promise.resolve(supabase.from("profiles").update({ avatar_url: path } as any).eq("id", user.id)),
        cli?.id
          ? Promise.resolve(supabase.from("clients").update({
              profile_picture_url: path,
              profile_picture_updated_at: stamp,
            } as any).eq("id", cli.id))
          : Promise.resolve(),
        co?.id
          ? Promise.resolve(supabase.from("coaches").update({
              profile_picture_url: path,
            } as any).eq("id", co.id))
          : Promise.resolve(),
      ]);
      await qc.invalidateQueries({ queryKey: ["app-shell-me"] });
      await qc.invalidateQueries({ queryKey: ["my-client-account"] });
      setPicOpen(false);
      toast.success("Profile picture updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save picture");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-64">
          <div className="flex items-center gap-3 p-2">
            <button
              type="button"
              onClick={() => {
                if (signedPic) setViewOpen(true);
                else setPicOpen(true);
              }}
              className="shrink-0"
              aria-label="View profile picture"
            >
              <UserAvatar src={mePic} name={meName} size={40} ring expandable={false} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{meName || user?.email}</div>
              <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Profile Picture
          </DropdownMenuLabel>
          {signedPic && (
            <DropdownMenuItem onSelect={() => setViewOpen(true)}>
              <ImageIcon className="mr-2 h-4 w-4" /> View photo
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPicOpen(true)}>
            <Camera className="mr-2 h-4 w-4" /> {mePic ? "Change photo" : "Add photo"}
          </DropdownMenuItem>

          {settingItems.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Settings
              </DropdownMenuLabel>
              {settingItems.map((item) => {
                const Icon = item.icon ?? UserCog;
                return (
                  <DropdownMenuItem
                    key={item.to}
                    onSelect={(e) => {
                      e.preventDefault();
                      navigate({ to: item.to });
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4" /> {item.label}
                  </DropdownMenuItem>
                );
              })}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Account
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setEmailOpen(true); }}>
            <Mail className="mr-2 h-4 w-4" /> Change email
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onSignOut}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={picOpen} onOpenChange={setPicOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" /> Profile picture
            </DialogTitle>
            <DialogDescription>
              Take a new picture or upload one from your device.
            </DialogDescription>
          </DialogHeader>
          {user?.id ? (
            <ProfilePictureCapture
              mode="admin"
              allowFileUpload
              userId={user.id}
              currentUrl={mePic ?? undefined}
              onUploaded={handleUploaded}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your profile picture</DialogTitle>
          </DialogHeader>
          {signedPic ? (
            <img
              src={signedPic}
              alt="Profile"
              className="mx-auto aspect-square w-full max-w-sm rounded-xl object-cover"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No photo yet.</p>
          )}
        </DialogContent>
      </Dialog>

      <ChangeEmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        currentEmail={user?.email ?? ""}
      />
    </>
  );
}

function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentEmail: string;
}) {
  const submit = useServerFn(requestEmailChange);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setConfirm("");
      setSent(null);
      setBusy(false);
    }
  }, [open]);

  const onSubmit = async () => {
    const next = email.trim().toLowerCase();
    if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (next !== confirm.trim().toLowerCase()) {
      toast.error("Emails don't match");
      return;
    }
    if (next === currentEmail.toLowerCase()) {
      toast.error("That's already your email address");
      return;
    }
    setBusy(true);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      await submit({ data: { newEmail: next, redirectTo } });
      setSent(next);
      toast.success("Confirmation link sent");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not request email change");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Change account email
          </DialogTitle>
          <DialogDescription>
            We'll send a confirmation link to your new address. Your email won't change until you click that link. If you have SMS notifications on, you'll also get a text confirming the request.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="font-semibold">Check your inbox</div>
              <div className="mt-1 text-muted-foreground">
                We sent a confirmation link to <span className="font-medium text-foreground">{sent}</span>. Open it on this device to finish switching your account email.
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Didn't get it? Check spam, or try again in a few minutes.
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Current email</Label>
              <div className="mt-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                {currentEmail || "—"}
              </div>
            </div>
            <div>
              <Label htmlFor="new-email">New email</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@newdomain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="confirm-email">Confirm new email</Label>
              <Input
                id="confirm-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@newdomain.com"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={busy || !email || !confirm}>
                {busy ? "Sending…" : "Send confirmation"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}