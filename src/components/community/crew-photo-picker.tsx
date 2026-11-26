/**
 * The Crew profile picture: any picture at all (a pet, a meme, a logo, a gym
 * shot, a group photo, you or not). Take one with the camera or pick one from
 * the library, frame it in "Move and scale", and it's saved small and sharp
 * (uploadCommunityAvatar: 512 px for every face, a full-size copy for the
 * viewer). No face checks, no rules beyond the crew's own. Never the account
 * headshot, which is private to the coach and never shown here.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Image as ImageIcon, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AvatarCropper } from "@/components/avatar-cropper";
import { useFilmCamera } from "@/components/camera/use-film-camera";
import { useSetCommunityAvatar } from "@/lib/community.queries";
import { feedback } from "@/lib/feedback";

export function useCrewPhotoPicker(userId: string | null, opts: { hasPhoto?: boolean; onSaved?: () => void } = {}) {
  const [menu, setMenu] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const setAvatar = useSetCommunityAvatar(userId);
  useEffect(() => () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
  }, [cropSrc]);

  const take = (f: File) => setCropSrc(URL.createObjectURL(f));
  const camera = useFilmCamera({ purpose: "profile", onClip: take, onLibrary: () => fileRef.current?.click() });

  const pickLibrary = () => {
    setMenu(false);
    fileRef.current?.click();
  };
  const pickCamera = () => {
    setMenu(false);
    // the app's camera where a page can film, else the phone's own (the same input, asking for the camera)
    if (!camera.start()) {
      const input = fileRef.current;
      if (!input) return;
      input.setAttribute("capture", "user");
      input.click();
      window.setTimeout(() => input.removeAttribute("capture"), 0);
    }
  };
  const remove = () => {
    setMenu(false);
    setAvatar.mutate(null, { onSuccess: () => toast.success("Picture removed"), onError: (e: any) => toast.error(e?.message ?? "Couldn't remove it") });
  };

  const element = (
    <>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="bottom" swipeToClose className="rounded-t-[24px] px-2 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 sm:mx-auto sm:max-w-[520px]" data-crew-photo-menu>
          <SheetHeader className="px-3 pb-2 text-left">
            <SheetTitle className="text-[16px]">Crew profile picture</SheetTitle>
            <SheetDescription className="text-[13px]">Any picture you like. It doesn't have to be you.</SheetDescription>
          </SheetHeader>
          <MenuRow icon={Camera} label="Take a photo" onClick={pickCamera} data="camera" />
          <MenuRow icon={ImageIcon} label="Choose from library" onClick={pickLibrary} data="library" />
          {opts.hasPhoto && <MenuRow icon={Trash2} label="Remove picture" onClick={remove} data="remove" destructive />}
        </SheetContent>
      </Sheet>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.type && !f.type.startsWith("image/")) return void toast.error("Pick a photo");
          take(f);
        }}
        data-crew-photo-input
      />
      {camera.element}
      <AvatarCropper
        src={cropSrc}
        open={!!cropSrc}
        onCancel={() => setCropSrc(null)}
        onDone={(blob) => {
          setCropSrc(null);
          const file = new File([blob], "community-photo.jpg", { type: "image/jpeg" });
          setAvatar.mutate(file, {
            onSuccess: () => {
              feedback("success");
              toast.success("Picture updated");
              opts.onSaved?.();
            },
            onError: (err: any) => toast.error(err?.message ?? "Couldn't upload that picture"),
          });
        }}
      />
    </>
  );
  return { open: () => setMenu(true), pending: setAvatar.isPending, element };
}

function MenuRow({ icon: Icon, label, onClick, data, destructive }: { icon: typeof Camera; label: string; onClick: () => void; data: string; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold active:bg-muted ${destructive ? "text-destructive" : ""}`}
      data-crew-photo-option={data}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
