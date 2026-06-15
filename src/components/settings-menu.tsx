import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, LogOut, Settings as SettingsIcon, UserCog, ImageIcon } from "lucide-react";
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
    </>
  );
}