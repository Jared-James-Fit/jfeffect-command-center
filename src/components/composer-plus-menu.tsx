import { useState } from "react";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Plus, Camera, Image as ImageIcon, File as FileIcon, Sparkles,
  ClipboardList, FileSignature, UtensilsCrossed, ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatSendMenu, type ChatSendAttachment } from "@/components/chat-send-menu";
import { GifPicker } from "@/components/gif-picker";
import type { ChatGif } from "@/lib/chat-gifs";
import type { ChatSound } from "@/lib/chat-sounds";

type Tile = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "warning" | "accent";
  hidden?: boolean;
};

export function ComposerPlusMenu({
  role,
  surface,
  clientIds,
  defaultClientId,
  disabled,
  canSendGifs,
  canSendSounds,
  onPickCamera,
  onPickPhotos,
  onPickFiles,
  onPickGif,
  onPickSound,
  onAttach,
}: {
  role: "admin" | "client" | "member";
  surface: "dm" | "group";
  clientIds: string[];
  defaultClientId?: string;
  disabled?: boolean;
  canSendGifs?: boolean;
  canSendSounds?: boolean;
  onPickCamera: () => void;
  onPickPhotos: () => void;
  onPickFiles: () => void;
  onPickGif?: (g: ChatGif) => void | Promise<void>;
  onPickSound?: (s: ChatSound) => void | Promise<void>;
  /** Admin/coach-only — undefined hides the request tiles. */
  onAttach?: (att: ChatSendAttachment, body: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);

  const isAdmin = role === "admin";
  const canSendRequests = !!onAttach && (isAdmin || surface === "group");

  const tiles: Tile[] = [
    {
      key: "camera",
      label: "Camera",
      icon: <Camera className="h-6 w-6" />,
      onClick: () => { setOpen(false); onPickCamera(); },
    },
    {
      key: "photo",
      label: "Photo / Video",
      icon: <ImageIcon className="h-6 w-6" />,
      onClick: () => { setOpen(false); onPickPhotos(); },
    },
    {
      key: "file",
      label: "File",
      icon: <FileIcon className="h-6 w-6" />,
      onClick: () => { setOpen(false); onPickFiles(); },
    },
    {
      key: "gif",
      label: "GIFs & Sounds",
      icon: <Sparkles className="h-6 w-6" />,
      onClick: () => { setOpen(false); setGifOpen(true); },
      hidden: !canSendGifs,
      tone: "accent",
    },
    {
      key: "form",
      label: "Form / Check-in",
      icon: <ClipboardList className="h-6 w-6" />,
      onClick: () => { setOpen(false); setFormOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "sig",
      label: "Signature",
      icon: <FileSignature className="h-6 w-6" />,
      onClick: () => { setOpen(false); setSigOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "recipe",
      label: "Recipe",
      icon: <UtensilsCrossed className="h-6 w-6" />,
      onClick: () => { setOpen(false); setRecipeOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "action",
      label: "Action Request",
      icon: <ZapIcon className="h-6 w-6" />,
      onClick: () => { setOpen(false); setActionOpen(true); },
      hidden: !canSendRequests || surface !== "dm" || !defaultClientId,
      tone: "warning",
    },
  ];

  const visible = tiles.filter((t) => !t.hidden);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            disabled={disabled}
            className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-90"
            title="Attach or send"
          >
            <Plus className={cn("h-5 w-5 transition-transform", open && "rotate-45")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-[min(94vw,360px)] p-3"
        >
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {surface === "group" ? "Send to group" : isAdmin ? "Send to client" : "Send"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {visible.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={t.onClick}
                disabled={t.disabled}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 px-2 py-3 text-center text-[11px] font-medium leading-tight transition active:scale-95",
                  "hover:bg-secondary disabled:opacity-50 disabled:pointer-events-none",
                  t.tone === "primary" && "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10",
                  t.tone === "warning" && "border-warning/30 bg-warning/5 text-warning hover:bg-warning/10",
                  t.tone === "accent" && "border-accent/30 bg-accent/30 hover:bg-accent/50",
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-sm">
                  {t.icon}
                </span>
                <span className="line-clamp-2">{t.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* GIF/Sound picker — opened from grid */}
      {canSendGifs && onPickGif && (
        <GifPicker
          asDialog
          hideTrigger
          showSounds
          controlledOpen={gifOpen}
          onControlledOpenChange={setGifOpen}
          onPick={async (g) => { setGifOpen(false); await onPickGif(g); }}
          onPickSound={!canSendSounds || !onPickSound ? undefined : async (s) => { setGifOpen(false); await onPickSound(s); }}
        />
      )}

      {/* Forms / Signature / Recipe / Action — controlled */}
      {canSendRequests && onAttach && (
        <ChatSendMenu
          hideTrigger
          surface={surface}
          clientIds={clientIds}
          defaultClientId={defaultClientId}
          disabled={disabled}
          onAttach={onAttach}
          externalOpen={{ form: formOpen, sig: sigOpen, recipe: recipeOpen, action: actionOpen }}
          onExternalOpenChange={(key, v) => {
            if (key === "form") setFormOpen(v);
            else if (key === "sig") setSigOpen(v);
            else if (key === "recipe") setRecipeOpen(v);
            else if (key === "action") setActionOpen(v);
          }}
        />
      )}
    </>
  );
}