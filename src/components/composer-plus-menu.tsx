import { useState } from "react";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Plus, Camera, Image as ImageIcon, FileText,
  ClipboardList, FileSignature, UtensilsCrossed, Video, CalendarPlus, ListChecks,
} from "lucide-react";
import { ScheduleSheet } from "@/components/messages/booking-invite";
import type { BookingCard } from "@/lib/booking-cards";
import { BookSessionFromChat, ChatBookingDialog } from "@/components/messages/book-session-from-chat";
import { cn } from "@/lib/utils";
import { preloadVideoEngine } from "@/lib/video-edit/pick";
import { ChatSendMenu, type ChatSendAttachment } from "@/components/chat-send-menu";
import { GifPicker } from "@/components/gif-picker";
import { useServerFn } from "@tanstack/react-start";
import { createMeetLink } from "@/lib/meet.functions";
import { toast } from "sonner";
import type { MediaItem } from "@/lib/media/media";
import type { ChatSound } from "@/lib/chat-sounds";
import { MessengerCheckinRequestDialog } from "@/components/messages/messenger-checkin-request-dialog";

type Tile = {
  key: string;
  /** "attach" = media/files from the device; "send" = coach tools that create something for the client. */
  section: "attach" | "send";
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
  onPickVideo,
  onPickPhotos,
  onPickFiles,
  onPickGif,
  onPickSound,
  onAttach,
  onInsertText,
  clientName,
}: {
  role: "admin" | "client" | "member";
  surface: "dm" | "group";
  clientIds: string[];
  defaultClientId?: string;
  disabled?: boolean;
  canSendGifs?: boolean;
  canSendSounds?: boolean;
  onPickCamera: () => void;
  /** Film a video in the app's own camera (use-film-camera.tsx); no tile without it. */
  onPickVideo?: () => void;
  onPickPhotos: () => void;
  onPickFiles: () => void;
  onPickGif?: (m: MediaItem) => void | Promise<void>;
  onPickSound?: (s: ChatSound) => void | Promise<void>;
  /** Admin/coach-only — undefined hides the request tiles. */
  onAttach?: (att: ChatSendAttachment, body: string) => void | Promise<void>;
  /** Admin/coach-only — receives generated Google Meet URLs to append. */
  onInsertText?: (text: string) => void;
  /** The client's first name (one client), for "Copy for Marc" in the form picker. */
  clientName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [creatingMeet, setCreatingMeet] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookCard, setBookCard] = useState<BookingCard | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const createMeet = useServerFn(createMeetLink);

  const isAdmin = role === "admin";
  const canSendRequests = !!onAttach && (isAdmin || surface === "group");
  const canBook = isAdmin && surface === "dm" && !!defaultClientId;

  const tiles: Tile[] = [
    {
      key: "camera",
      section: "attach",
      label: "Camera",
      icon: <Camera className="h-6 w-6" />,
      onClick: () => { setOpen(false); preloadVideoEngine(); onPickCamera(); },
    },
    {
      // a video filmed in the app's own camera: 1080p with the phone's own mic and no call processing,
      // where the Camera tile's iOS picker records 480 × 360 with squeezed sound
      key: "video",
      section: "attach",
      label: "Video",
      icon: <Video className="h-6 w-6" />,
      onClick: () => { setOpen(false); preloadVideoEngine(); onPickVideo?.(); },
      hidden: !onPickVideo,
    },
    {
      key: "photo",
      section: "attach",
      label: "Photos & Videos",
      icon: <ImageIcon className="h-6 w-6" />,
      onClick: () => { setOpen(false); preloadVideoEngine(); onPickPhotos(); },
    },
    {
      key: "file",
      section: "attach",
      label: "Document",
      icon: <FileText className="h-6 w-6" />,
      onClick: () => { setOpen(false); onPickFiles(); },
    },
    {
      key: "gif",
      section: "attach",
      label: "GIFs & Stickers",
      icon: <span className="rounded-[5px] border-2 border-current px-[3px] text-[11px] font-bold leading-[16px] tracking-tight" aria-hidden>GIF</span>,
      onClick: () => { setOpen(false); setGifOpen(true); },
      hidden: !canSendGifs,
      tone: "accent",
    },
    {
      // One place to get a time on the calendar: send a link they pick from, or book it yourself.
      key: "schedule",
      section: "send",
      label: "Schedule",
      icon: <CalendarPlus className="h-6 w-6" />,
      onClick: () => {
        setOpen(false);
        if (onAttach) setScheduleOpen(true);
        else { setBookCard(null); setBookOpen(true); }
      },
      hidden: !canBook,
      tone: "primary",
    },
    {
      key: "checkin",
      section: "send",
      label: "Request Check-In",
      icon: <ClipboardList className="h-6 w-6" />,
      onClick: () => { setOpen(false); setCheckinOpen(true); },
      hidden: !isAdmin || surface !== "dm" || !defaultClientId,
      tone: "primary",
      disabled: !defaultClientId,
    },
    {
      key: "form",
      section: "send",
      label: "Send Form",
      icon: <ListChecks className="h-6 w-6" />,
      onClick: () => { setOpen(false); setFormOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "sig",
      section: "send",
      label: "Request Signature",
      icon: <FileSignature className="h-6 w-6" />,
      onClick: () => { setOpen(false); setSigOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "recipe",
      section: "send",
      label: "Share Recipe",
      icon: <UtensilsCrossed className="h-6 w-6" />,
      onClick: () => { setOpen(false); setRecipeOpen(true); },
      hidden: !canSendRequests,
      tone: "primary",
      disabled: clientIds.length === 0,
    },
    {
      key: "meet",
      section: "send",
      label: creatingMeet ? "Creating…" : "Meet Link",
      icon: <Video className="h-6 w-6" />,
      onClick: async () => {
        if (!onInsertText || creatingMeet) return;
        setCreatingMeet(true);
        try {
          const { meetUrl } = await createMeet({ data: {} });
          onInsertText(meetUrl);
          setOpen(false);
          toast.success("Google Meet link added");
        } catch (e: any) {
          toast.error(e?.message ?? "Failed to create Meet link");
        } finally {
          setCreatingMeet(false);
        }
      },
      hidden: !isAdmin || !onInsertText,
      tone: "primary",
      disabled: creatingMeet,
    },
  ];

  const visible = tiles.filter((t) => !t.hidden);
  const sections = [
    { key: "attach", label: "Attach", tiles: visible.filter((t) => t.section === "attach") },
    {
      key: "send",
      label: surface === "group" ? "Send to group" : "Send to client",
      tiles: visible.filter((t) => t.section === "send"),
    },
  ].filter((s) => s.tiles.length > 0);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Fetch the booking dialog while the menu is up, so Book Session opens at once.
          if (o && canBook) void ChatBookingDialog.preload().catch(() => {});
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            disabled={disabled}
            className="h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-90"
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
          {sections.map((section, i) => (
            <div key={section.key} className={cn(i > 0 && "mt-3")}>
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {section.tiles.map((t) => (
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
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {canBook && defaultClientId && (
        <BookSessionFromChat clientId={defaultClientId} open={bookOpen} onOpenChange={setBookOpen} initialCard={bookCard} />
      )}

      {isAdmin && surface === "dm" && defaultClientId && (
        <MessengerCheckinRequestDialog
          open={checkinOpen}
          onOpenChange={setCheckinOpen}
          clientId={defaultClientId}
        />
      )}

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

      {/* Signature / Recipe — controlled */}
      {canSendRequests && onAttach && (
        <ChatSendMenu
          hideTrigger
          surface={surface}
          clientIds={clientIds}
          disabled={disabled}
          onAttach={onAttach}
          clientName={clientName}
          externalOpen={{ form: formOpen, sig: sigOpen, recipe: recipeOpen }}
          onExternalOpenChange={(key, v) => {
            if (key === "form") setFormOpen(v);
            else if (key === "sig") setSigOpen(v);
            else if (key === "recipe") setRecipeOpen(v);
          }}
        />
      )}

      {canBook && defaultClientId && onAttach && (
        <ScheduleSheet
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          clientId={defaultClientId}
          onSendInChat={(att, body) => onAttach(att as any, body)}
          onBookYourself={(t) => {
            setBookCard(t as unknown as BookingCard);
            setBookOpen(true);
          }}
        />
      )}
    </>
  );
}